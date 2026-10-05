import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { BranchesSettings } from "./BranchesSettings";
import { listBranches, saveBranch } from "./api";
vi.mock("./api", () => ({ listBranches: vi.fn(), saveBranch: vi.fn() }));
const principal = {
  id: "principal",
  name: "Sucursal principal",
  address: null,
  created_at: "2026-10-04",
};
beforeEach(() => {
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
