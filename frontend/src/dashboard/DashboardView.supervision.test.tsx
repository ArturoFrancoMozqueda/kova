import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { makeStory } from "@/reports/__fixtures__/story";
import { controlRoutes, type DashboardControl } from "./controlTypes";
import { makeControl, northId, principalId } from "./__fixtures__/control";
import type { DashboardOverview } from "./api";
import { summaryFromStory } from "./storyAdapters";

const auth = vi.hoisted(() => ({ state: { status: "authenticated", tenantId: "11111111-1111-4111-8111-111111111111", tenantName: "Negocio de control", sessionMode: "online", user: { id: "user-control", role: "owner" } } }));
vi.mock("@/auth/useAuth", () => ({ useAuth: () => auth }));
vi.mock("./api", () => ({ getDashboardOverview: vi.fn() }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/components/brand/RealTime", () => ({ CountUp: ({ value }: { value: number }) => <span data-testid="net-sales">{value}</span> }));
vi.mock("@/offline/useSyncQueue", () => ({ useIsOnline: () => true, useSyncQueue: () => ({ ready: true, pendingCount: 2, failedEntries: [], quarantinedCount: 0 }) }));
import DashboardView from "./DashboardView";
import { getDashboardOverview } from "./api";

const destinations = [
  { to: "/register", label: "Caja" },
  ...Object.entries(controlRoutes).map(([key, to]) => ({ to, label: key === "inventory" ? "Inventario" : key })),
];
function overview(control = makeControl()): DashboardOverview {
  const story = makeStory();
  return { story, hourly: [{ hour: 12, net_sales: "10000.00", order_count: 100 }], previous_summary: summaryFromStory(story), timezone: "America/Mexico_City",
    active_catalog_count: 20, tracked_inventory_count: 10, low_stock_items: [], active_employee_count: 2,
    closed_shift_count: 4, billing: null, onboarding: { tenant_id: principalId, completed_count: 0, total_count: 0, steps: [] }, control_center: control };
}
function host() {
  return render(<MemoryRouter initialEntries={["/dashboard"]}><Routes>
    <Route element={<Outlet context={{ destinations }} />}><Route path="/dashboard" element={<DashboardView />} /></Route>
    <Route path="/inventory" element={<p>Inventario abierto</p>} />
  </Routes></MemoryRouter>);
}
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); localStorage.clear();
  auth.state.tenantId = principalId;
  vi.mocked(getDashboardOverview).mockResolvedValue(overview());
});

describe("dashboard supervision", () => {
  it("leads with a chart before operational lists and exposes exact values by keyboard", async () => {
    host();
    const chart = await screen.findByRole("img", { name: "Gráfica de ventas netas por hora" });
    const areas = screen.getByRole("region", { name: "Tu operación, de un vistazo" });
    expect(chart.compareDocumentPosition(areas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const products = screen.getByRole("article", { name: "Productos e inventario" });
    expect(within(products).getByText("Compras con recepción parcial")).not.toBeVisible();
    fireEvent.click(within(products).getByText("Ver detalle y herramientas"));
    expect(within(products).getByText("Compras con recepción parcial")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Consultar hora"), { target: { value: "12" } });
    expect(screen.getByText("12:00", { exact: true })).toBeVisible();
    expect(screen.getByRole("img", { name: "Distribución de cobros brutos por método de pago" })).toBeVisible();
  });

  it("defaults to all branches, shows attributed alerts, operational metrics and partial cost data", async () => {
    const { container } = host();
    expect(await screen.findByLabelText("Consultar")).toHaveValue("all");
    expect(getDashboardOverview).toHaveBeenCalledExactlyOnceWith("day", "all");
    expect(screen.getByRole("heading", { name: "Resultados por sucursal" })).toBeVisible();
    expect(screen.getByText("Citas programadas para hoy")).toBeVisible();
    expect(screen.getByText("Sin datos suficientes")).toBeVisible();
    const business = screen.getByRole("article", { name: "Configuración del negocio" });
    expect(within(business).getByText("Sin conexión", { exact: true })).toBeVisible();
    expect(screen.getByText(/2 por sincronizar/)).toBeVisible();
    expect(screen.queryByText("Lectura del periodo", { exact: true })).not.toBeInTheDocument();
    expect((await axe(container, { runOnly: ["heading-order", "definition-list", "dlitem", "aria-valid-attr-value"] })).violations).toEqual([]);
  });

  it("filters supervision and retains its period without changing the operating branch preference", async () => {
    host();
    const selector = await screen.findByLabelText("Consultar");
    const key = `kova-branch:${principalId}:user-control`;
    sessionStorage.setItem(key, principalId);
    const selected = makeControl({ scope: { kind: "branch", branch_id: northId, label: "Norte", can_view_all: true }, branch_sales: makeControl().branch_sales.slice(1) });
    vi.mocked(getDashboardOverview).mockResolvedValue(overview(selected));
    fireEvent.change(selector, { target: { value: northId } });
    await waitFor(() => expect(getDashboardOverview).toHaveBeenLastCalledWith("day", northId));
    await waitFor(() => expect(selector).toHaveValue(northId));
    fireEvent.click(screen.getByRole("radio", { name: "7 días" }));
    await waitFor(() => expect(getDashboardOverview).toHaveBeenLastCalledWith("week", northId));
    expect(sessionStorage.getItem(key)).toBe(principalId);
  });

  it("requires explicit confirmation to open an alert from another operating branch and cancellation preserves it", async () => {
    host();
    const alert = await screen.findByRole("link", { name: /Pedidos con entrega vencida/ });
    fireEvent.click(alert);
    const dialog = screen.getByRole("dialog", { name: "Abrir Norte" });
    expect(within(dialog).getByText(/se vaciará el carrito/)).toBeVisible();
    expect(sessionStorage.getItem(`kova-branch:${principalId}:user-control`)).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(sessionStorage.getItem(`kova-branch:${principalId}:user-control`)).toBeNull();
  });

  it("asks for a branch when opening an area from the consolidated view", async () => {
    host();
    const products = await screen.findByRole("article", { name: "Productos e inventario" });
    fireEvent.click(within(products).getByText("Ver detalle y herramientas"));
    fireEvent.click(within(products).getByRole("link", { name: "Inventario" }));
    const dialog = screen.getByRole("dialog", { name: "¿Qué sucursal quieres abrir?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Sucursal principal" }));
    expect(await screen.findByText("Inventario abierto")).toBeVisible();
  });

  it("shows unavailable sources without inventing cleared inventory or a healthy score", async () => {
    const control = makeControl();
    control.areas = control.areas.map(area => area.key === "products" ? { ...area, status: "unavailable", metrics: [] } : area);
    vi.mocked(getDashboardOverview).mockResolvedValue(overview(control));
    host();
    expect(await screen.findByRole("heading", { name: "Lectura parcial" })).toBeVisible();
    expect(screen.getByText(/Algunas áreas no pudieron actualizarse/)).toBeVisible();
    const products = screen.getByRole("article", { name: "Productos e inventario" });
    expect(within(products).queryByText("Stock bajo", { exact: true })).not.toBeInTheDocument();
    for (const summary of screen.getAllByText("Caja e inventario actuales")) fireEvent.click(summary);
    expect(screen.getAllByText("Sin datos", { exact: true })).toHaveLength(2);
    expect(screen.queryByText("Saludable", { exact: true })).not.toBeInTheDocument();
  });

  it("discards a late consolidated response after a newer branch query", async () => {
    let resolve!: (value: DashboardOverview) => void;
    host();
    const selector = await screen.findByLabelText("Consultar");
    vi.mocked(getDashboardOverview).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    fireEvent.click(screen.getByRole("button", { name: "Actualizar centro de control" }));
    const newer: DashboardControl = makeControl({ scope: { kind: "branch", branch_id: northId, label: "Norte", can_view_all: true } });
    vi.mocked(getDashboardOverview).mockResolvedValue(overview(newer));
    fireEvent.change(selector, { target: { value: northId } });
    await waitFor(() => expect(selector).toHaveValue(northId));
    await act(async () => resolve(overview()));
    expect(selector).toHaveValue(northId);
  });
});
