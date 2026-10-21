import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ state: {
  status: "authenticated", tenantId: "tenant-a", tenantName: "Mi negocio", tenantLogoUrl: null,
  sessionMode: "online", user: { id: "user-a", email: "owner@example.com", role: "owner" },
}, logout: vi.fn() }));
const deniedPermissions = vi.hoisted(() => new Set<string>());
vi.mock("@/auth/permissions", async importOriginal => {
  const actual = await importOriginal<typeof import("@/auth/permissions")>();
  return { ...actual, usePermission: (permission: string) => deniedPermissions.has(permission) ? false : actual.usePermission(permission) };
});
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

function CurrentRoute() {
  const location = useLocation();
  return <output aria-label="Ruta actual">{location.pathname}{location.search}</output>;
}
function host(path = "/register") {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route element={<AppShell />}>
    <Route path="*" element={<><Link to="/quotes">Abrir cotizaciones desde el contenido</Link><CurrentRoute /></>} />
  </Route></Routes></MemoryRouter>);
}
function navigation() { return within(document.querySelector("aside nav") as HTMLElement); }

beforeEach(() => {
  window.localStorage.clear();
  auth.state.user.role = "owner";
  auth.state.sessionMode = "online";
  deniedPermissions.clear();
  features.customer_orders = false;
  features.margin_reports = false;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true,
    addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: false }))));
});
afterEach(() => vi.unstubAllGlobals());

describe("daily links and secondary navigation groups", () => {
  it("finds an owner's task across closed groups without more requests or changing disclosure preferences", async () => {
    host();
    const search = screen.getByRole("searchbox", { name: "Buscar sección" });
    fireEvent.change(search, { target: { value: "compartir productos" } });
    const result = navigation().getByRole("link", { name: "Catálogo público" });
    expect(result).toHaveAttribute("href", "/settings/public-catalog");
    expect(result).toHaveAccessibleDescription("Comparte productos con fotos y recibe solicitudes.");
    expect(navigation().getAllByRole("link")).toHaveLength(1);
    expect(navigation().getByRole("status")).toHaveTextContent("1 resultado encontrado");
    fireEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda de secciones" }));
    expect(search).toHaveFocus();
    expect(navigation().getByRole("button", { name: "Ventas y atención" })).toHaveAttribute("aria-expanded", "false");
    await act(async () => {});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("kova-sidebar-groups-v1")).toBeNull();
  });

  it.each([
    ["crear pedido", "Pedidos", "/pedidos"],
    ["nuevo pedido", "Pedidos", "/pedidos"],
    ["crear cotización", "Cotizaciones", "/quotes"],
    ["nuevo cliente", "Clientes", "/customers"],
  ])("finds the existing section for intent '%s'", async (query, label, href) => {
    features.customer_orders = true; host();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar sección" }), { target: { value: query } });
    expect(navigation().getByRole("link", { name: label })).toHaveAttribute("href", href);
    if (href === "/pedidos") {
      expect(navigation().getAllByRole("link")[0]).toHaveAttribute("href", "/pedidos/nuevo");
    } else {
      expect(navigation().getAllByRole("link")[0]).toHaveAttribute("href", href);
    }
    await act(async () => {});
  });

  it("does not expose order creation search results when the order feature is disabled", async () => {
    host();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar sección" }), { target: { value: "crear pedido" } });
    expect(navigation().queryAllByRole("link")).toHaveLength(0);
    await act(async () => {});
  });

  it("matches accents and task descriptions, and Escape clears an empty-result search", async () => {
    host(); const search = screen.getByRole("searchbox", { name: "Buscar sección" });
    fireEvent.change(search, { target: { value: "FACTURACIÓN" } });
    expect(navigation().getByRole("link", { name: "Facturación e integraciones" })).toHaveAttribute("href", "/settings/integrations");
    fireEvent.change(search, { target: { value: "¿Qué vendo?" } });
    expect(navigation().getByRole("link", { name: "Análisis" })).toHaveAttribute("href", "/reports");
    fireEvent.change(search, { target: { value: "inexistente" } });
    expect(navigation().queryAllByRole("link")).toHaveLength(0);
    expect(navigation().getByRole("status")).toHaveTextContent("No encontramos esa acción o sección");
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
    expect(navigation().getByRole("link", { name: "Caja" })).toBeVisible();
    await act(async () => {});
  });

  it("clears search after navigation and places the public catalog in the commercial journey", async () => {
    host(); const search = screen.getByRole("searchbox", { name: "Buscar sección" });
    fireEvent.change(search, { target: { value: "compartir productos" } });
    fireEvent.click(navigation().getByRole("link", { name: "Catálogo público" }));
    expect(search).toHaveValue("");
    expect(navigation().getByRole("button", { name: "Ventas y atención" })).toHaveAttribute("aria-expanded", "true");
    expect(navigation().getByRole("button", { name: "Gestión y ajustes" })).toHaveAttribute("aria-expanded", "false");
    expect(navigation().getByRole("link", { name: "Catálogo público" })).toHaveAttribute("aria-current", "page");
    await act(async () => {});
  });

  it("expands the compact rail and focuses section search without leaving the current page", async () => {
    window.localStorage.setItem("kova-sidebar-collapsed", "1"); host();
    fireEvent.click(screen.getByRole("button", { name: "Buscar sección" }));
    expect(screen.getByRole("searchbox", { name: "Buscar sección" })).toHaveFocus();
    expect(navigation().getByRole("link", { name: "Caja" })).toHaveAttribute("aria-current", "page");
    expect(window.localStorage.getItem("kova-sidebar-collapsed")).toBe("0");
    await act(async () => {});
  });

  it("never discovers destinations excluded by permissions, capabilities, feature flags or offline mode", async () => {
    const view = host(); const search = screen.getByRole("searchbox", { name: "Buscar sección" });
    for (const query of ["gastos", "asistente"]) {
      fireEvent.change(search, { target: { value: query } });
      expect(navigation().queryAllByRole("link")).toHaveLength(0);
    }
    view.unmount(); auth.state.user.role = "manager"; const manager = host();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar sección" }), { target: { value: "suscripción" } });
    expect(navigation().queryAllByRole("link")).toHaveLength(0);
    manager.unmount(); auth.state.user.role = "cashier"; const cashier = host();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar sección" }), { target: { value: "compartir productos" } });
    expect(navigation().queryAllByRole("link")).toHaveLength(0);
    cashier.unmount(); auth.state.sessionMode = "offline"; host();
    expect(screen.queryByRole("searchbox", { name: "Buscar sección" })).not.toBeInTheDocument();
    expect(navigation().getAllByRole("link")).toHaveLength(1);
    await act(async () => {});
  });

  it("shows five daily links and three closed groups instead of twenty peer links", async () => {
    host(); const nav = navigation();
    expect(nav.getAllByRole("link").map(link => link.textContent)).toEqual(["Caja", "Panel", "Pendientes", "Ventas", "Turnos"]);
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
    const paths = new Set(nav.getAllByRole("link").map(link => link.getAttribute("href")));
    for (const name of ["Productos e inventario", "Ventas y atención", "Gestión y ajustes"]) {
      const trigger = nav.getByRole("button", { name });
      trigger.focus();
      fireEvent.click(trigger);
      expect(trigger).toHaveFocus();
      expect(nav.getAllByRole("button").filter(button => button.getAttribute("aria-expanded") === "true")).toEqual([trigger]);
      for (const link of nav.getAllByRole("link")) paths.add(link.getAttribute("href"));
    }
    expect([...paths]).toEqual(expect.arrayContaining(["/purchasing", "/settings/integrations", "/followups", "/commercial-requests", "/customers"]));
    const allPaths = nav.getAllByRole("link", { hidden: true }).map(link => link.getAttribute("href"));
    expect(new Set(allPaths).size).toBe(allPaths.length);
    expect(paths.size).toBe(28);
    fireEvent.click(nav.getByRole("button", { name: "Productos e inventario" }));
    expect(nav.getByRole("link", { name: "Compras y proveedores" }).querySelector("span[aria-hidden]")).not.toHaveClass("truncate");
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
  it("normalizes old multi-open preferences, lets the deep link win and preserves unrelated settings", async () => {
    window.localStorage.setItem("kova-sidebar-groups-v1", JSON.stringify({ products: true, commercial: true, management: true }));
    window.localStorage.setItem("other-ui-preference", "preserve");
    const view = host("/quotes");
    expect(navigation().getAllByRole("button").filter(button => button.getAttribute("aria-expanded") === "true").map(button => button.getAttribute("aria-label"))).toEqual(["Ventas y atención"]);
    view.unmount(); host();
    expect(navigation().getAllByRole("button").filter(button => button.getAttribute("aria-expanded") === "true").map(button => button.getAttribute("aria-label"))).toEqual(["Productos e inventario"]);
    fireEvent.click(navigation().getByRole("button", { name: "Gestión y ajustes" }));
    expect(window.localStorage.getItem("other-ui-preference")).toBe("preserve");
    await act(async () => {});
  });

  it("keeps the mobile drawer usable with one open group and closes it after choosing daily pending work", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    host();
    const trigger = screen.getAllByRole("button", { name: "Abrir menú de navegación" })[0];
    fireEvent.click(trigger);
    const drawer = screen.getByRole("dialog", { name: "Navegación de la cuenta" });
    expect(drawer).toHaveFocus();
    const firstControl = drawer.querySelector<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])')!;
    const logout = within(drawer).getByRole("button", { name: "Cerrar sesión" });
    logout.focus(); fireEvent.keyDown(document, { key: "Tab" });
    expect(firstControl).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(logout).toHaveFocus();
    fireEvent.click(within(drawer).getByRole("button", { name: "Productos e inventario" }));
    fireEvent.click(within(drawer).getByRole("button", { name: "Ventas y atención" }));
    expect(within(drawer).getByRole("button", { name: "Productos e inventario" })).toHaveAttribute("aria-expanded", "false");
    expect(within(drawer).getByRole("link", { name: "Clientes" })).toHaveAttribute("href", "/customers");
    fireEvent.click(within(drawer).getByRole("link", { name: "Pendientes" }));
    expect(screen.queryByRole("dialog", { name: "Navegación de la cuenta" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await act(async () => {});
  });

  it("shares permissions and feature filtering with contextual actions and keeps them out of offline or cashier sessions", async () => {
    const view = host("/quotes");
    const context = () => screen.queryByRole("navigation", { name: "Continúa tu operación" });
    const content = screen.getByRole("link", { name: "Abrir cotizaciones desde el contenido" });
    expect(content.compareDocumentPosition(context()!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(within(context()!).queryByRole("link", { name: "Revisar pedidos" })).toBeNull();
    expect(within(context()!).getByRole("link", { name: "Gestionar clientes" })).toHaveAttribute("href", "/customers");
    features.customer_orders = true; view.unmount();
    const enabled = host("/quotes");
    expect(within(context()!).getByRole("link", { name: "Crear pedido" })).toHaveAttribute("href", "/pedidos/nuevo");
    enabled.unmount(); auth.state.user.role = "manager";
    const manager = host("/quotes"); expect(context()).toBeInTheDocument();
    manager.unmount(); auth.state.user.role = "cashier";
    const cashier = host("/quotes"); expect(context()).not.toBeInTheDocument();
    cashier.unmount(); auth.state.user.role = "owner"; auth.state.sessionMode = "offline";
    host("/quotes"); expect(context()).not.toBeInTheDocument();
    await act(async () => {});
  });

  it("opens and focuses existing section search from the mobile header, clears then closes with Escape", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    host();
    const trigger = screen.getByRole("button", { name: "Buscar tareas del negocio" });
    fireEvent.click(trigger);
    const search = screen.getByRole("searchbox", { name: "Buscar sección" });
    expect(search).toHaveFocus();
    expect(search).toHaveAttribute("placeholder", "¿Qué quieres hacer?");
    fireEvent.change(search, { target: { value: "crear producto" } });
    expect(navigation().getAllByRole("link")[0]).toHaveAttribute("href", "/catalog?new=product");
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue(""); expect(search).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "Navegación de la cuenta" })).toBeInTheDocument();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Navegación de la cuenta" })).toBeNull();
    expect(trigger).toHaveFocus();
    await act(async () => {});
  });

  it("uses the header search from expanded or compact desktop navigation without a new dialog", async () => {
    window.localStorage.setItem("kova-sidebar-collapsed", "1");
    host();
    const trigger = screen.getByRole("button", { name: "Buscar tareas del negocio" });
    fireEvent.click(trigger);
    const search = screen.getByRole("searchbox", { name: "Buscar sección" });
    expect(search).toHaveFocus();
    expect(window.localStorage.getItem("kova-sidebar-collapsed")).toBe("0");
    trigger.focus(); fireEvent.click(trigger); expect(search).toHaveFocus();
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => {});
  });

  it("navigates straight to supported creation tasks and settings without opening extra groups", async () => {
    features.customer_orders = true; host();
    const search = screen.getByRole("searchbox", { name: "Buscar sección" });
    for (const [query, name, href] of [
      ["crear pedido", "Crear pedido", "/pedidos/nuevo"],
      ["crear producto", "Crear producto", "/catalog?new=product"],
      ["recibo", "Personalizar recibo", "/settings/receipt"],
      ["empleados", "Empleados y accesos", "/settings/employees"],
      ["equipo", "Empleados y accesos", "/settings/employees"],
      ["perfil", "Perfil del negocio", "/settings/business-profile"],
      ["sucursales", "Sucursales", "/settings/branches"],
    ]) {
      fireEvent.change(search, { target: { value: query } });
      expect(navigation().getAllByRole("link")[0]).toHaveAttribute("href", href);
      fireEvent.click(navigation().getByRole("link", { name }));
      expect(search).toHaveValue("");
      expect(screen.getByLabelText("Ruta actual")).toHaveTextContent(href);
    }
    await act(async () => {});
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("never offers creation without both parent access and create permission, or owner-only employee settings to managers", async () => {
    features.customer_orders = true;
    deniedPermissions.add("customer_orders.create"); deniedPermissions.add("catalog.create");
    const view = host();
    const search = () => screen.getByRole("searchbox", { name: "Buscar sección" });
    fireEvent.change(search(), { target: { value: "crear pedido" } });
    expect(navigation().queryByRole("link", { name: "Crear pedido" })).toBeNull();
    expect(navigation().getByRole("link", { name: "Pedidos" })).toHaveAttribute("href", "/pedidos");
    fireEvent.change(search(), { target: { value: "crear producto" } });
    expect(navigation().queryByRole("link", { name: "Crear producto" })).toBeNull();
    view.unmount(); deniedPermissions.clear(); deniedPermissions.add("customer_orders.view");
    const noParent = host(); fireEvent.change(search(), { target: { value: "crear pedido" } });
    expect(navigation().queryAllByRole("link")).toHaveLength(0);
    noParent.unmount(); deniedPermissions.clear(); auth.state.user.role = "manager";
    host(); fireEvent.change(search(), { target: { value: "empleados" } });
    expect(navigation().queryByRole("link", { name: "Empleados y accesos" })).toBeNull();
    fireEvent.change(search(), { target: { value: "sucursales" } });
    expect(navigation().getByRole("link", { name: "Sucursales" })).toHaveAttribute("href", "/settings/branches");
    await act(async () => {});
  });

  it("keeps the new header and task destinations out of cashier and offline sessions", async () => {
    auth.state.user.role = "cashier"; features.customer_orders = true;
    const view = host();
    expect(screen.queryByRole("button", { name: "Buscar tareas del negocio" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar sección" }), { target: { value: "crear pedido" } });
    expect(navigation().queryByRole("link", { name: "Crear pedido" })).toBeNull();
    expect(navigation().getByRole("link", { name: "Pedidos" })).toBeInTheDocument();
    view.unmount(); auth.state.user.role = "owner"; auth.state.sessionMode = "offline";
    host(); expect(screen.queryByRole("button", { name: "Buscar tareas del negocio" })).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(navigation().getAllByRole("link")).toHaveLength(1);
    await act(async () => {});
  });

});
