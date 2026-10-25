import type { ControlMetric, DashboardControl } from "../controlTypes";

export const principalId = "11111111-1111-4111-8111-111111111111";
export const northId = "22222222-2222-4222-8222-222222222222";

function metric(key: string, label: string, value: string | null, route: ControlMetric["route_key"],
  format: ControlMetric["format"] = "count", scope: ControlMetric["scope"] = "current"): ControlMetric {
  return { key, label, value, route_key: route, format, scope, detail: null };
}

/** Explicit browser/unit data only. Production consumes the authenticated API. */
export function makeControl(overrides: Partial<DashboardControl> = {}): DashboardControl {
  return {
    generated_at: "2026-10-23T18:00:00Z",
    scope: { kind: "all", branch_id: null, label: "Todas las sucursales", can_view_all: true },
    branches: [{ id: principalId, name: "Sucursal principal" }, { id: northId, name: "Norte" }],
    branch_sales: [
      { branch_id: principalId, branch_name: "Sucursal principal", completed_orders: 60, net_sales: "6000.00", average_ticket: "100.00", share_pct: "60.00", low_stock_count: 1, open_shift_count: 1, attention_signals: 1 },
      { branch_id: northId, branch_name: "Norte", completed_orders: 40, net_sales: "4000.00", average_ticket: "100.00", share_pct: "40.00", low_stock_count: 2, open_shift_count: 1, attention_signals: 2 },
    ],
    priority_counts: { now: 2, today: 1, followup: 0 },
    alert_groups_total: 3, alerts_has_more: false,
    alerts: [
      { key: "orders_overdue", title: "Pedidos con entrega vencida", branch_id: northId, branch_name: "Norte", count: 2, priority: "now", route_key: "customer_orders", scope: "current" },
      { key: "out_of_stock", title: "Productos sin existencias disponibles", branch_id: principalId, branch_name: "Sucursal principal", count: 1, priority: "now", route_key: "inventory", scope: "current" },
      { key: "cases_overdue", title: "Casos de atención con plazo vencido", branch_id: northId, branch_name: "Norte", count: 1, priority: "today", route_key: "service_cases", scope: "current" },
    ],
    areas: [
      { key: "sales", status: "ready", metrics: [
        metric("open_shifts", "Turnos abiertos", "2", "shifts"),
        metric("expected_cash", "Efectivo esperado en cajas abiertas", "4500.00", "shifts", "money"),
        metric("shift_differences", "Cortes con diferencias", "1", "shifts", "count", "period"),
        metric("orders_ready", "Listos para entregar", "4", "customer_orders"),
        metric("orders_unpaid", "Pedidos sin cobrar", "6", "customer_orders"),
      ] },
      { key: "products", status: "ready", metrics: [
        metric("out_of_stock", "Sin existencias disponibles", "1", "inventory"),
        metric("low_stock", "Stock bajo", "3", "inventory"),
        metric("reserved_units", "Unidades reservadas", "12", "inventory"),
        metric("purchases_pending", "Compras pendientes de recibir", "2", "purchasing"),
        metric("purchases_partial", "Compras con recepción parcial", "1", "purchasing"),
      ] },
      { key: "customers", status: "ready", metrics: [
        metric("customers", "Clientes activos del negocio", "85", "customers", "count", "business"),
        metric("opportunities", "Oportunidades abiertas", "7", "crm"),
        metric("catalog_requests", "Solicitudes por atender", "3", "commercial_requests"),
        metric("followups", "Seguimientos pendientes", "5", "followups"),
        metric("loyalty", "Sucursales con lealtad habilitada", "1", "loyalty"),
      ] },
      { key: "attention", status: "ready", metrics: [
        metric("cases_open", "Casos abiertos", "4", "service_cases"),
        metric("cases_overdue", "Casos con plazo vencido", "1", "service_cases"),
        metric("appointments_today", "Citas programadas para hoy", "6", "appointments", "count", "today"),
        metric("reminders", "Recordatorios pendientes de revisar", "2", "appointments"),
        metric("drafts", "Borradores de respuesta", "2", "inbox"),
      ] },
      { key: "money", status: "ready", metrics: [
        metric("unmatched", "Liquidaciones pendientes de conciliar", "2", "reconciliation"),
        metric("unmatched_amount", "Importe pendiente de conciliar", "800.00", "reconciliation", "money"),
        metric("expenses", "Gastos registrados", "1500.00", "expenses", "money", "period"),
        metric("gross_profit", "Utilidad bruta", null, "reports", "money", "period"),
      ] },
      { key: "business", status: "ready", metrics: [
        metric("automation_pending", "Tareas internas pendientes", "3", "automations"),
        metric("automation_rules", "Reglas internas habilitadas", "2", "automations"),
        metric("whatsapp", "WhatsApp externo", "Sin conexión", "channels", "text", "business"),
        metric("subscription", "Suscripción de Kova", "Activa", "billing", "text", "business"),
        metric("cfdi_live", "Preparación fiscal de producción", "Por configurar o validar", "integrations", "text", "business"),
      ] },
    ],
    ...overrides,
  };
}
