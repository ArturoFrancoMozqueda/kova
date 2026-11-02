import type { CommercialAccess } from "@/auth/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { BranchesSettings } from "./BranchesSettings";
import { listBranches, saveBranch } from "./api";
// Child flows have their own API/auth tests; this suite isolates branch editing.
vi.mock("./EmployeeBranchAccess", () => ({ EmployeeBranchAccess: () => null }));
vi.mock("./InventoryTransfers", () => ({ InventoryTransfers: () => null }));
vi.mock("./api", () => ({ listBranches: vi.fn(), saveBranch: vi.fn() }));
const authPlan = vi.hoisted(() => ({ access: undefined as CommercialAccess | undefined }));
vi.mock("@/auth/useAuth", () => ({ useOptionalAuth: () => ({ state: { status: "authenticated", commercialAccess: authPlan.access } }) }));
const principal = {
  id: "principal",
  name: "Sucursal principal",
  address: null,
  created_at: "2026-10-04",
};
beforeEach(() => {
  authPlan.access = undefined;
  vi.clearAllMocks();
  vi.mocked(listBranches).mockResolvedValue([principal]);
});

it("creates a location and makes it discoverable by the operating selector", async () => {
  const update = vi.fn();
  window.addEventListener("kova-branches-updated", update);
  vi.mocked(saveBranch).mockResolvedValue({
    ...principal,
    id: "centro",
    name: "Centro",
  });
  render(<BranchesSettings />);
  await screen.findByText("Sucursal principal");
  fireEvent.change(screen.getByLabelText("Nombre de la sucursal"), {
    target: { value: "Centro" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Crear sucursal" }));
  expect(await screen.findByText("Centro")).toBeVisible();
  expect(saveBranch).toHaveBeenCalledWith("Centro", "", undefined);
  expect(update).toHaveBeenCalledOnce();
  window.removeEventListener("kova-branches-updated", update);
});

it("preserves the entered name after a rejection and allows renaming an existing branch", async () => {
  vi.mocked(saveBranch).mockRejectedValueOnce(
    new Error("Ya existe una sucursal con ese nombre"),
  );
  vi.mocked(saveBranch).mockResolvedValueOnce({ ...principal, name: "Matriz" });
  render(<BranchesSettings />);
  await screen.findByText("Sucursal principal");
  fireEvent.change(screen.getByLabelText("Nombre de la sucursal"), {
    target: { value: "Centro" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Crear sucursal" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe");
  expect(screen.getByLabelText("Nombre de la sucursal")).toHaveValue("Centro");
  fireEvent.click(
    screen.getByRole("button", { name: "Editar Sucursal principal" }),
  );
  fireEvent.change(screen.getByLabelText("Nombre de la sucursal"), {
    target: { value: "Matriz" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() =>
    expect(saveBranch).toHaveBeenLastCalledWith("Matriz", "", "principal"),
  );
  expect(await screen.findByText("Matriz")).toBeVisible();
});


it("preserves existing branch editing when the plan branch limit is reached", async () => {
  authPlan.access = { allowed: true, reason: "active", valid_until: null, plan_code: "esencial", features: ["pos"], limits: { product_image_bytes: 250_000_000, branches: 1 } };
  render(<BranchesSettings />);
  await screen.findByText("Sucursal principal");
  expect(screen.queryByRole("button", { name: "Crear sucursal" })).not.toBeInTheDocument();
  expect(screen.getByText(/Tu plan incluye 1 sucursal/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Editar Sucursal principal" }));
  expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeEnabled();
});
