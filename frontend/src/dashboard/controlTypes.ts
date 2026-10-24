export type DashboardScope = "all" | string;
export type ControlAreaKey = "sales" | "products" | "customers" | "attention" | "money" | "business";
export type ControlRoute = keyof typeof controlRoutes;
export const controlRoutes = {
  orders: "/orders", shifts: "/shifts", customer_orders: "/pedidos", quotes: "/quotes",
  inventory: "/inventory", purchasing: "/purchasing", replenishment: "/replenishment",
  customers: "/customers", crm: "/crm", commercial_requests: "/commercial-requests",
  followups: "/followups", loyalty: "/loyalty", appointments: "/appointments",
  service_cases: "/service-cases", inbox: "/inbox", reports: "/reports", expenses: "/expenses",
  reconciliation: "/reconciliation", automations: "/automations", channels: "/settings/channels",
  integrations: "/settings/integrations", billing: "/settings/billing", settings: "/settings",
  public_catalog: "/settings/public-catalog",
} as const;

export type ControlMetric = {
  key: string; label: string; value: string | null; format: "count" | "money" | "text";
  scope: "current" | "period" | "today" | "business"; route_key: ControlRoute; detail: string | null;
};
export type ControlBranch = { id: string; name: string };
export type ControlScope = {
  kind: "all" | "branch"; branch_id: string | null; label: string; can_view_all: boolean;
};
export type DashboardControl = {
  generated_at: string;
  scope: ControlScope;
  branches: ControlBranch[];
  branch_sales: {
    branch_id: string; branch_name: string; completed_orders: number; net_sales: string;
    average_ticket: string; share_pct: string; low_stock_count: number | null;
    open_shift_count: number | null; attention_signals: number;
  }[];
  areas: { key: ControlAreaKey; status: "ready" | "unavailable"; metrics: ControlMetric[] }[];
  alerts: {
    key: string; branch_id: string; branch_name: string; title: string; count: number;
    priority: "now" | "today" | "followup"; route_key: ControlRoute;
    scope: "current" | "period" | "today";
  }[];
  alert_groups_total: number;
  priority_counts: { now: number; today: number; followup: number };
  alerts_has_more: boolean;
};

export const metricScopeLabel = {
  current: "Actual", period: "Periodo seleccionado", today: "Hoy", business: "Todo el negocio",
} as const;
