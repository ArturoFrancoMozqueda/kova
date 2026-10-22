import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { BranchSelector } from "./BranchSelector";
import { listBranches } from "./api";
import { saveActiveBranchId } from "./activeBranch";
const identity = vi.hoisted(() => ({ offline: false }));
vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({
    state: {
      status: "authenticated",
      tenantId: "principal",
      user: { id: "user-a" },
      sessionMode: identity.offline ? "offline" : "online",
    },
  }),
}));
vi.mock("./activeBranch", () => ({
  getActiveBranchId: () => "principal",
  saveActiveBranchId: vi.fn(),
}));
vi.mock("./api", () => ({ listBranches: vi.fn() }));
beforeEach(() => {
  identity.offline = false;
  vi.clearAllMocks();
  vi.mocked(listBranches).mockResolvedValue([
    {
      id: "principal",
      name: "Matriz",
      address: null,
      created_at: "2026-10-04",
    },
    { id: "centro", name: "Centro", address: null, created_at: "2026-10-04" },
  ]);
});

it("requires confirmation before discarding a draft when switching branches", async () => {
  render(<BranchSelector />);
  await screen.findByText("Centro");
  fireEvent.change(screen.getByLabelText("Sucursal activa"), {
    target: { value: "centro" },
  });
  expect(screen.getByRole("dialog")).toHaveTextContent("Se vaciará el carrito");
  expect(saveActiveBranchId).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Sucursal activa")).toHaveValue("principal");
});

it("keeps offline sales in the prepared branch by disabling location changes", () => {
  identity.offline = true;
  render(<BranchSelector />);
  expect(screen.getByLabelText("Sucursal activa")).toBeDisabled();
  expect(listBranches).not.toHaveBeenCalled();
});

it("exposes branch selection as a named landmark outside the page content", async () => {
  render(<BranchSelector />);
  await screen.findByText("Centro");
  const region = screen.getByRole("region", { name: "Selección de sucursal" });
  expect(within(region).getByRole("combobox", { name: "Sucursal activa" })).toHaveValue("principal");
});
