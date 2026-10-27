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
function shell(path = "/register") {
  return (<MemoryRouter initialEntries={[path]}><Routes><Route element={<AppShell />}>
    <Route path="*" element={<><Link to="/quotes">Abrir cotizaciones desde el contenido</Link><CurrentRoute /></>} />
  </Route></Routes></MemoryRouter>);
}
function host(path = "/register") { return render(shell(path)); }
function navigation() { return within(document.querySelector("aside nav") as HTMLElement); }

beforeEach(() => {
  window.localStorage.clear();
  auth.state.tenantId = "tenant-a";
  auth.state.user.id = "user-a";
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

describe("simple task navigation and complete discovery", () => {
  it.each([["owner", "Propietario"], ["manager", "Gerente"], ["cashier", "Cajero"], ["staff", "Colaborador"], ["unknown", "Integrante del equipo"]])("uses a human role label for %s", async (role, label) => {
    auth.state.user.role = role;
    host();
    expect(screen.getByText(label, { exact: true })).toBeVisible();
    await act(async () => {});
  });
  it.each(["owner", "manager"])("matches the owner-only loyalty API for %s", async role => {
    auth.state.user.role = role;
    host();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar sección" }), { target: { value: "lealtad" } });
    expect(navigation().queryAllByRole("link").some(link => link.getAttribute("href") === "/loyalty")).toBe(role === "owner");
    await act(async () => {});
  });

  it.each(["owner", "manager", "cashier"])("discovers digital cards without widening permissions for %s", async role => {
    auth.state.user.role = role;
    host();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar sección" }), { target: { value: "tarjeta digital" } });
    expect(navigation().queryAllByRole("link").map(link => link.getAttribute("href"))).toEqual(role === "owner" ? ["/loyalty"] : []);
    await act(async () => {});
  });

  it("finds an owner's task without more requests or changing rail preferences", async () => {
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
    expect(navigation().getByRole("button", { name: "Productos y operación" })).toBeVisible();
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
    expect(navigation().getByRole("link", { name: "Solicitudes de factura" })).toHaveAttribute("href", "/settings/integrations");
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
    expect(navigation().getByRole("button", { name: "Productos y operación" })).toBeVisible();
    expect(navigation().getByRole("button", { name: "Clientes y atención" })).toBeVisible();
    expect(navigation().getByRole("button", { name: "Configuración" })).toBeVisible();
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

  it.each(["owner", "manager", "cashier", "staff"])("keeps Caja, Pedidos and Ventas first for %s", async role => {
    features.customer_orders = true; auth.state.user.role = role; host();
    expect(navigation().getAllByRole("link").slice(0, 3).map(link => link.textContent)).toEqual(["Caja", "Pedidos", "Ventas"]);
    expect(navigation().getByRole("link", { name: "Caja" })).toHaveAttribute("aria-current", "page");
    if (role === "cashier" || role === "staff") {
      expect(navigation().queryAllByRole("button")).toHaveLength(0);
      expect(navigation().queryByRole("link", { name: "Suscripción" })).toBeNull();
      expect(navigation().getByRole("link", { name: "Clientes" })).toBeVisible();
    }
    await act(async () => {});
  });

  it("opens categories without navigating and remembers them across remounts", async () => {
    const view = host(); const nav = navigation();
    const group = nav.getByRole("button", { name: "Productos y operación" });
    expect(group).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(group.getAttribute("aria-controls")!)).not.toBeVisible();
    expect(nav.queryByRole("link", { name: "Catálogo" })).toBeNull();
    fireEvent.click(group);
    expect(group).toHaveAttribute("aria-expanded", "true");
    expect(nav.getByRole("link", { name: "Catálogo" })).toBeVisible();
    expect(screen.getByLabelText("Ruta actual")).toHaveTextContent("/register");
    view.unmount(); host();
    expect(navigation().getByRole("button", { name: "Productos y operación" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(navigation().getByRole("button", { name: "Productos y operación" }));
    expect(navigation().queryByRole("link", { name: "Catálogo" })).toBeNull();
    await act(async () => {});
  });

  it("keeps navigation operable when preference storage is unavailable", async () => {
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    try {
      host();
      fireEvent.click(navigation().getByRole("button", { name: "Productos y operación" }));
      expect(navigation().getByRole("link", { name: "Catálogo" })).toBeVisible();
      expect(navigation().getByRole("link", { name: "Caja" })).toBeVisible();
      await act(async () => {});
    } finally { read.mockRestore(); write.mockRestore(); }
  });

  it("retains every allowed destination exactly once across expanded categories", async () => {
    features.margin_reports = true; features.customer_orders = true; host();
    const nav = navigation();
    for (const name of ["Menú y ventas", "Clientes y atención", "Productos y operación", "Análisis y finanzas", "Configuración"])
      fireEvent.click(nav.getByRole("button", { name }));
    const paths = nav.getAllByRole("link").map(link => link.getAttribute("href"));
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toHaveLength(27);
    expect(paths).toEqual(expect.arrayContaining(["/purchasing", "/settings/integrations", "/followups", "/commercial-requests", "/customers", "/appointments", "/loyalty"]));
    expect(paths).not.toContain("/settings/channels");
    expect(nav.getByRole("link", { name: "Compras y proveedores" }).querySelector("span[aria-hidden]")).not.toHaveClass("truncate");
    await act(async () => {});
  });

  it("opens the current category for deep links and navigation from content", async () => {
    host("/purchasing/orders/123"); const nav = navigation();
    expect(nav.getByRole("button", { name: "Productos y operación" })).toHaveAttribute("aria-expanded", "true");
    expect(nav.getByRole("link", { name: "Compras y proveedores" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("link", { name: "Abrir cotizaciones desde el contenido" }));
    expect(nav.getByRole("button", { name: "Menú y ventas" })).toHaveAttribute("aria-expanded", "true");
    expect(nav.getByRole("link", { name: "Cotizaciones" })).toHaveAttribute("aria-current", "page");
    expect(nav.getByRole("link", { name: "Compras y proveedores" })).toBeVisible();
    await act(async () => {});
  });

  it("isolates saved groups by tenant, user and role and ignores obsolete or corrupt preferences", async () => {
    window.localStorage.setItem("kova-sidebar-groups-v1", JSON.stringify({ management: true }));
    window.localStorage.setItem("kova-navigation-groups-v2:tenant-a:user-a:owner", "invalid-json");
    window.localStorage.setItem("other-ui-preference", "preserve");
    const view = host();
    fireEvent.click(navigation().getByRole("button", { name: "Configuración" }));
    expect(navigation().getByRole("link", { name: "Suscripción" })).toBeVisible();
    auth.state.tenantId = "tenant-b"; view.rerender(shell());
    expect(navigation().getByRole("button", { name: "Configuración" })).toHaveAttribute("aria-expanded", "false");
    expect(window.localStorage.getItem("other-ui-preference")).toBe("preserve");
    expect(window.localStorage.getItem("kova-sidebar-groups-v1")).toBe(JSON.stringify({ management: true }));
    auth.state.tenantId = "tenant-a"; auth.state.user.id = "user-b"; view.rerender(shell());
    expect(navigation().getByRole("button", { name: "Configuración" })).toHaveAttribute("aria-expanded", "false");
    auth.state.user.id = "user-a"; auth.state.user.role = "manager"; view.rerender(shell());
    expect(navigation().getByRole("button", { name: "Configuración" })).toHaveAttribute("aria-expanded", "false");
    expect(navigation().queryByRole("link", { name: "Suscripción" })).toBeNull();
    await act(async () => {});
  });

  it("expands a compact category without leaving the current route and retains focus", async () => {
    window.localStorage.setItem("kova-sidebar-collapsed", "1"); host();
    const nav = navigation();
    const group = nav.getByRole("button", { name: "Productos y operación" });
    expect(group).toHaveAttribute("title", "Productos y operación");
    expect(nav.queryByRole("link", { name: "Compras y proveedores" })).toBeNull();
    group.focus(); fireEvent.click(group);
    expect(group).toHaveFocus();
    expect(group).toHaveAttribute("aria-expanded", "true");
    expect(window.localStorage.getItem("kova-sidebar-collapsed")).toBe("0");
    expect(nav.getByRole("link", { name: "Compras y proveedores" })).toBeVisible();
    expect(screen.getByLabelText("Ruta actual")).toHaveTextContent("/register");
    await act(async () => {});
  });

  it("preserves feature flags, role permissions and offline restrictions", async () => {
    const view = host();
    expect(navigation().queryByRole("link", { name: "Pedidos" })).toBeNull();
    view.unmount(); auth.state.user.role = "manager"; const manager = host("/settings");
    expect(navigation().queryByRole("link", { name: "Suscripción" })).toBeNull();
    manager.unmount(); auth.state.user.role = "cashier"; const cashier = host();
    expect(navigation().getAllByRole("link").map(link => link.textContent)).toEqual(["Caja", "Ventas", "Turnos", "Clientes"]);
    expect(navigation().queryAllByRole("button")).toHaveLength(0);
    cashier.unmount(); auth.state.sessionMode = "offline"; host();
    expect(navigation().getAllByRole("link").map(link => link.textContent)).toEqual(["Caja"]);
    expect(navigation().queryAllByRole("button")).toHaveLength(0);
    await act(async () => {});
  });

  it("keeps mobile categories open until a destination is chosen and restores focus", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    host();
    const trigger = screen.getAllByRole("button", { name: "Abrir menú de navegación" })[0];
    fireEvent.click(trigger);
    const drawer = screen.getByRole("dialog", { name: "Navegación de la cuenta" });
    expect(drawer).toHaveFocus();
    const firstControl = drawer.querySelector<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])')!;
    const logout = within(drawer).getByRole("button", { name: "Cerrar sesión" });
    logout.focus(); fireEvent.keyDown(document, { key: "Tab" }); expect(firstControl).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true }); expect(logout).toHaveFocus();
    fireEvent.click(navigation().getByRole("button", { name: "Productos y operación" }));
    expect(drawer).toBeInTheDocument();
    fireEvent.click(navigation().getByRole("link", { name: "Compras y proveedores" }));
    expect(screen.queryByRole("dialog", { name: "Navegación de la cuenta" })).toBeNull();
    expect(screen.getByLabelText("Ruta actual")).toHaveTextContent("/purchasing");
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
    expect(within(context()!).getByRole("link", { name: "Revisar pedidos" })).toHaveAttribute("href", "/pedidos");
    expect(within(context()!).queryByRole("link", { name: "Crear pedido" })).toBeNull();
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

  it("keeps desktop content clear and expands the existing compact rail search without a header button", async () => {
    window.localStorage.setItem("kova-sidebar-collapsed", "1");
    host();
    expect(screen.queryByRole("button", { name: "Buscar tareas del negocio" })).toBeNull();
    expect(document.querySelector("header")).toHaveClass("xl:hidden");
    fireEvent.click(screen.getByRole("button", { name: "Buscar sección" }));
    const search = screen.getByRole("searchbox", { name: "Buscar sección" });
    expect(search).toHaveFocus();
    expect(window.localStorage.getItem("kova-sidebar-collapsed")).toBe("0");
    expect(screen.queryByRole("button", { name: "Buscar tareas del negocio" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.change(search, { target: { value: "crear producto" } });
    expect(navigation().getAllByRole("link")[0]).toHaveAttribute("href", "/catalog?new=product");
    await act(async () => {});
  });

  it("navigates straight to supported creation tasks and settings from search", async () => {
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
