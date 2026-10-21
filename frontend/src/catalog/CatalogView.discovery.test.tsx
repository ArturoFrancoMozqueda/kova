import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { listCategories, listModifierGroups, listProducts } from "./api";
import CatalogView from "./CatalogView";

const auth = vi.hoisted(() => ({ state: {
  status: "authenticated", tenantId: "tenant-discovery", tenantName: "Mi negocio",
  sessionMode: "online", user: { id: "user-discovery", email: "owner@example.com", role: "owner" },
} }));
vi.mock("@/auth/useAuth", () => ({ useAuth: () => auth, useOptionalAuth: () => auth }));
vi.mock("@/auth/AuthContext", () => ({ useAuthContext: () => auth }));
vi.mock("./api", async (importOriginal) => ({
  ...await importOriginal<typeof import("./api")>(),
  listCategories: vi.fn(async () => []),
  listProducts: vi.fn(async () => []),
  listModifierGroups: vi.fn(async () => []),
}));

function host() {
  render(<MemoryRouter initialEntries={["/catalog"]}><ToastProvider><Routes>
    <Route path="/catalog" element={<CatalogView />} />
    <Route path="/settings/public-catalog" element={<h1>Publicador existente</h1>} />
  </Routes></ToastProvider></MemoryRouter>);
}
beforeEach(() => {
  vi.clearAllMocks();
  auth.state.user.role = "owner";
});

describe("catalog publication discovery", () => {
  it.each(["owner", "manager"])("links %s to publication without extra data requests", async (role) => {
    auth.state.user.role = role;
    host();
    const share = await screen.findByRole("link", { name: "Compartir catálogo" });
    expect(share).toHaveAttribute("href", "/settings/public-catalog");
    expect(share).toHaveClass("border-kova-border");
    expect(share.parentElement).toHaveClass("flex-wrap");
    expect(listProducts).toHaveBeenCalledTimes(1);
    expect(listCategories).toHaveBeenCalledTimes(1);
    expect(listModifierGroups).toHaveBeenCalledTimes(1);
    fireEvent.click(share);
    expect(await screen.findByRole("heading", { name: "Publicador existente" })).toBeInTheDocument();
  });

  it("preserves the primary product creation action and its form", async () => {
    host();
    await screen.findByRole("link", { name: "Compartir catálogo" });
    const create = screen.getAllByRole("button", { name: "Nuevo producto" })[0];
    expect(create).toHaveClass("bg-kova-ink");
    fireEvent.click(create);
    const dialog = await screen.findByRole("dialog", { name: "Nuevo producto" });
    await waitFor(() => expect(dialog).toHaveFocus());
    expect(screen.getByLabelText("Nombre del producto")).toBeInTheDocument();
  });

  it.each(["cashier", "staff"])("does not expose publication or creation to %s", async (role) => {
    auth.state.user.role = role;
    host();
    await screen.findByRole("heading", { name: "Catálogo" });
    await waitFor(() => expect(listProducts).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("link", { name: "Compartir catálogo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nuevo producto" })).not.toBeInTheDocument();
  });
});
