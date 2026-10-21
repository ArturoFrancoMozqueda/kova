import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ state: {
  status: "authenticated", tenantId: "tenant-a", tenantName: "Mi negocio", tenantLogoUrl: null,
  sessionMode: "online", user: { id: "user-a", email: "owner@example.com", role: "owner" },
}, logout: vi.fn() }));
const features = vi.hoisted(() => ({ customer_orders: false, margin_reports: false }));
vi.mock("@/auth/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/auth/AuthContext", () => ({ useAuthContext: () => auth }));
vi.mock("@/auth/useFeature", () => ({ useFeature: (name: keyof typeof features) => features[name] }));
vi.mock("@/branches/BranchSelector", () => ({ BranchSelector: () => null }));
vi.mock("@/assistant/AssistantCompanion", () => ({ AssistantCompanion: () => null }));
vi.mock("@/offline/OfflineIndicator", () => ({ OfflineIndicator: () => null }));
vi.mock("@/billing/BillingBanner", () => ({ BillingBanner: () => null }));
vi.mock("@/billing/TrialChip", () => ({ TrialChip: () => null }));
vi.mock("@/auth/EmailVerificationBanner", () => ({ EmailVerificationBanner: () => null }));
vi.mock("@/onboarding/FirstUseTour", () => ({ FirstUseTour: () => null }));
vi.mock("@/support/SupportDialog", () => ({ SupportDialog: () => null }));
vi.mock("@/telemetry/funnel", () => ({ flushFunnelEvents: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import AppShell from "./AppShell";

function host(path = "/register") {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route element={<AppShell />}>
    <Route path="*" element={<Link to="/quotes">Abrir cotizaciones desde el contenido</Link>} />
  </Route></Routes></MemoryRouter>);
}
function navigation() { return within(document.querySelector("aside nav") as HTMLElement); }

beforeEach(() => {
  window.localStorage.clear();
  auth.state.user.role = "owner";
  auth.state.sessionMode = "online";
  features.customer_orders = false;
  features.margin_reports = false;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true,
    addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: false }))));
});
afterEach(() => vi.unstubAllGlobals());

describe("daily links and secondary navigation groups", () => {
  it("shows five daily links and three closed groups instead of twenty peer links", async () => {
    host(); const nav = navigation();
    expect(nav.getAllByRole("link").map(link => link.textContent)).toEqual(["Caja", "Panel", "Clientes", "Ventas", "Turnos"]);
    expect(nav.getAllByRole("button").map(button => button.getAttribute("aria-label"))).toEqual([
      "Productos e inventario", "Ventas y atención", "Gestión y ajustes",
    ]);
    for (const button of nav.getAllByRole("button")) {
      expect(button).toHaveAttribute("aria-expanded", "false");
      expect(document.getElementById(button.getAttribute("aria-controls") ?? "")).toHaveAttribute("hidden");
    }
    expect(nav.queryByRole("link", { name: "Compras y proveedores" })).toBeNull();
    await act(async () => {});
  });
  it("retains complete labels and every existing secondary destination", async () => {
    features.margin_reports = true; features.customer_orders = true; host();
    const nav = navigation();
    for (const name of ["Productos e inventario", "Ventas y atención", "Gestión y ajustes"]) fireEvent.click(nav.getByRole("button", { name }));
    for (const [name, href] of [["Compras y proveedores", "/purchasing"], ["Facturación e integraciones", "/settings/integrations"], ["Postventa y seguimiento", "/followups"], ["Solicitudes del catálogo", "/commercial-requests"]]) {
      expect(nav.getByRole("link", { name })).toHaveAttribute("href", href);
    }
    expect(nav.getByRole("link", { name: "Compras y proveedores" }).querySelector("span[aria-hidden]")).not.toHaveClass("truncate");
    const paths = nav.getAllByRole("link").map(link => link.getAttribute("href"));
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toHaveLength(28);
    await act(async () => {});
  });
  it("opens the active deep-link group, permits closing it, then opens the next active group", async () => {
    host("/purchasing/orders/123"); const nav = navigation();
    expect(nav.getByRole("button", { name: "Productos e inventario" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(nav.getByRole("button", { name: "Productos e inventario" }));
    expect(nav.getByRole("button", { name: "Productos e inventario" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("link", { name: "Abrir cotizaciones desde el contenido" }));
    expect(nav.getByRole("button", { name: "Ventas y atención" })).toHaveAttribute("aria-expanded", "true");
    expect(nav.getByRole("link", { name: "Cotizaciones" })).toHaveAttribute("aria-current", "page");
    await act(async () => {});
  });
  it("stores only boolean UI preferences and restores the chosen groups", async () => {
    const view = host(); fireEvent.click(navigation().getByRole("button", { name: "Productos e inventario" }));
    expect(JSON.parse(window.localStorage.getItem("kova-sidebar-groups-v1") ?? "null")).toEqual({ products: true, commercial: false, management: false });
    view.unmount(); host();
    expect(navigation().getByRole("button", { name: "Productos e inventario" })).toHaveAttribute("aria-expanded", "true");
    await act(async () => {});
  });
  it("expands the compact desktop rail when a group is selected", async () => {
    window.localStorage.setItem("kova-sidebar-collapsed", "1"); host();
    expect(screen.getByRole("button", { name: "Expandir menú" })).toBeInTheDocument();
    fireEvent.click(navigation().getByRole("button", { name: "Productos e inventario" }));
    expect(screen.getByRole("button", { name: "Contraer menú" })).toBeInTheDocument();
    expect(navigation().getByRole("link", { name: "Catálogo" })).toBeVisible();
    await act(async () => {});
  });
  it("preserves feature flags, role permissions and offline restrictions", async () => {
    const view = host(); fireEvent.click(navigation().getByRole("button", { name: "Gestión y ajustes" }));
    expect(navigation().queryByRole("link", { name: "Gastos" })).toBeNull();
    expect(navigation().queryByRole("link", { name: "Pedidos" })).toBeNull();
    view.unmount(); auth.state.user.role = "manager"; const manager = host("/settings");
    expect(navigation().queryByRole("link", { name: "Suscripción" })).toBeNull();
    manager.unmount(); auth.state.user.role = "cashier"; const cashier = host();
    expect(navigation().getAllByRole("link").map(link => link.textContent)).toEqual(["Caja", "Clientes", "Ventas", "Turnos"]);
    expect(navigation().queryByRole("button", { name: "Gestión y ajustes" })).toBeNull();
    cashier.unmount(); auth.state.sessionMode = "offline"; host();
    expect(navigation().getAllByRole("link").map(link => link.textContent)).toEqual(["Caja"]);
    expect(navigation().queryAllByRole("button")).toHaveLength(0);
    await act(async () => {});
  });
});
