import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import CatalogView from "@/catalog/CatalogView";
import { listProducts } from "@/catalog/api";
import { FirstUseTour } from "./FirstUseTour";

const auth = vi.hoisted(() => ({ state: {
  status: "authenticated", tenantId: "tenant-tour", tenantName: "Mi negocio",
  sessionMode: "online", user: { id: "owner-tour", email: "owner@example.com", role: "owner" },
} }));
vi.mock("@/auth/useAuth", () => ({ useAuth: () => auth, useOptionalAuth: () => auth }));
vi.mock("@/auth/AuthContext", () => ({ useAuthContext: () => auth }));
vi.mock("@/telemetry/funnel", () => ({ trackFunnelEvent: vi.fn() }));
vi.mock("@/catalog/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/catalog/api")>(),
  listCategories: vi.fn(async () => []),
  listProducts: vi.fn(async () => []),
  listModifierGroups: vi.fn(async () => []),
}));

function Location() {
  const location = useLocation();
  return <output aria-label="Ruta actual">{location.pathname}{location.search}{location.hash}</output>;
}
function host(path = "/catalog", catalog = true) {
  return render(<MemoryRouter initialEntries={[path]}><ToastProvider>
    <Location />
    {catalog && <CatalogView />}
    <FirstUseTour />
  </ToastProvider></MemoryRouter>);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  auth.state.user.role = "owner";
});

describe("first-use tour continuation", () => {
  it("opens the existing product form from the catalog CTA, focuses its dialog and preserves the current query", async () => {
    host("/catalog?category=bebidas#productos");
    const button = await screen.findByRole("button", { name: "Crear productos" });
    button.focus();
    fireEvent.click(button);

    const dialog = await screen.findByRole("dialog", { name: "Nuevo producto" });
    await waitFor(() => expect(dialog).toHaveFocus());
    expect(screen.getByLabelText("Nombre del producto")).toBeInTheDocument();
    // Creation is consumed once; the existing filter and anchor remain.
    expect(screen.getByLabelText("Ruta actual")).toHaveTextContent("/catalog?category=bebidas#productos");
    expect(window.localStorage.getItem("kova:tour:tenant-tour:catalog")).toBe("1");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Crear productos" })).not.toBeInTheDocument());
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    for (const createButton of screen.getAllByRole("button", { name: "Nuevo producto" })) {
      expect(createButton).toBeEnabled();
    }
  });

  it("dismisses without opening product creation", async () => {
    host();
    fireEvent.click(await screen.findByRole("button", { name: "Omitir" }));
    expect(screen.getByLabelText("Ruta actual")).toHaveTextContent("/catalog");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the register acknowledgement on the current route", async () => {
    host("/register?draft=actual", false);
    fireEvent.click(await screen.findByRole("button", { name: "Entendido" }));
    expect(screen.getByLabelText("Ruta actual")).toHaveTextContent("/register?draft=actual");
    expect(window.localStorage.getItem("kova:tour:tenant-tour:register")).toBe("1");
    expect(listProducts).not.toHaveBeenCalled();
  });

  it("does not invite a cashier to create products or request the catalog for the tour", async () => {
    auth.state.user.role = "cashier";
    host("/catalog", false);
    await waitFor(() => expect(screen.getByLabelText("Ruta actual")).toHaveTextContent("/catalog"));
    expect(screen.queryByTestId("first-use-tour")).not.toBeInTheDocument();
    expect(listProducts).not.toHaveBeenCalled();
  });
});
