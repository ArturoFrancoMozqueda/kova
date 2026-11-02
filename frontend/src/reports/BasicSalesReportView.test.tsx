import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PaymentBreakdown } from "./types";
const api = vi.hoisted(() => ({ summary: vi.fn(), payments: vi.fn(), products: vi.fn(), story: vi.fn(), hourly: vi.fn(), dashboard: vi.fn() }));
vi.mock("@/auth/useAuth", () => ({ useAuth: () => ({ state: { status: "authenticated", tenantId: "t", user: { id: "u", role: "owner" }, sessionMode: "online",
  commercialAccess: { allowed: true, plan_code: "esencial", features: ["sales_reports"] } } }) }));
vi.mock("@/auth/permissions", () => ({ REPORTS_VIEW_ALL_PERMISSION: "reports.view_all", BILLING_VIEW_PERMISSION: "billing.view", usePermission: () => true }));
vi.mock("@/hooks/useTenantTimezone", () => ({ useTenantTimezone: () => ({ timezone: "America/Mexico_City", isResolved: true }) }));
vi.mock("./api", () => ({ getSalesSummary: api.summary, getPaymentBreakdown: api.payments, getTopProducts: api.products,
  getBusinessStory: api.story, getSalesByHour: api.hourly }));
vi.mock("@/dashboard/api", () => ({ getDashboardOverview: api.dashboard }));
import ReportsView from "./ReportsView";
import { BasicSalesReportView } from "./BasicSalesReportView";
const summary = { start_date: "2026-11-02", end_date: "2026-11-02", gross_sales: "150.00", net_sales: "140.00", refund_total: "10.00", order_count: 3, refund_count: 1, void_count: 0 };
function mount(dashboard = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>{dashboard ? <BasicSalesReportView dashboard /> : <ReportsView />}</MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  api.summary.mockResolvedValue(summary); api.payments.mockResolvedValue({ payments: [] }); api.products.mockResolvedValue({ products: [] });
});
afterEach(() => vi.resetAllMocks());
it("renders completed core sections while another section is pending and never requests premium analysis", async () => {
  let finish!: (value: PaymentBreakdown) => void;
  api.payments.mockReturnValue(new Promise<PaymentBreakdown>((resolve) => { finish = resolve; }));
  mount();
  expect(await screen.findByText("$140.00")).toBeInTheDocument();
  expect(screen.getByLabelText("Cargando formas de pago")).toBeInTheDocument();
  expect(screen.queryByText("No hay cobros en este periodo.")).not.toBeInTheDocument();
  expect(api.story).not.toHaveBeenCalled(); expect(api.hourly).not.toHaveBeenCalled();
  await act(async () => finish({ start_date: "2026-11-02", end_date: "2026-11-02", payments: [], gross_total: "0", refund_total: "0", net_total: "0" }));
  expect(await screen.findByText("No hay cobros en este periodo.")).toBeInTheDocument();
});
it("uses dashboard summary even when the premium story is null", async () => {
  api.dashboard.mockResolvedValue({ story: null, summary, advanced_reports_available: false });
  mount(true);
  expect(await screen.findByText("$140.00")).toBeInTheDocument();
  expect(api.summary).not.toHaveBeenCalled(); expect(api.story).not.toHaveBeenCalled();
});
it("shows a failed section as an error while preserving the loaded summary", async () => {
  api.products.mockRejectedValue(new Error("network")); mount();
  expect(await screen.findByText("$140.00")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar los productos vendidos."));
  expect(screen.queryByText("No hay productos vendidos en este periodo.")).not.toBeInTheDocument();
});
