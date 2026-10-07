import { ArrowUpRight, BarChart3, Boxes, Building2, CalendarDays, Package } from "lucide-react";
import type { Resource } from "./api";

const moneyFormatter = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const money = (value: unknown) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? moneyFormatter.format(Number(value)) : "Sin dato";
const date = (value: string | number | undefined) => {
  if (typeof value !== "string") return "Sin fecha";
  // Date-only values belong to the reporting period, not the browser timezone.
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
};
function Period({ start, end }: { start?: string | number; end?: string | number }) {
  return <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-5 text-kova-muted"><CalendarDays size={13} className="mt-0.5 shrink-0" />{date(start)} a {date(end)} · Sucursal activa</p>;
}

export function SalesEvidence({ metrics, compact = false }: { metrics: Record<string, string | number>; compact?: boolean }) {
  const fields = [["net_sales", "Venta neta"], ["order_count", "Tickets"], ["gross_sales", "Venta bruta"], ["refund_total", "Reembolsos"]].filter(([key]) => key in metrics && (!compact || ["net_sales", "order_count"].includes(key)));
  return <section aria-label="Resultados de ventas" className="rounded-xl border border-kova-blue/15 bg-kova-grad-sky p-4">
    <div className="mb-4 flex items-center gap-2 text-xs font-semibold text-kova-ink"><BarChart3 size={15} className="text-kova-blue" />Resultados de ventas<span className="ml-auto text-[10px] font-normal text-kova-muted">Datos registrados</span></div>
    <dl className="grid grid-cols-2 gap-x-4 gap-y-4">{fields.map(([key, label]) => <div key={key} className="min-w-0"><dt className="text-xs text-kova-muted">{label}</dt><dd className={`mt-1 break-words font-semibold tabular-nums tracking-tight ${key === "net_sales" ? "text-2xl" : "text-xl"}`}>{key === "order_count" ? Number.isFinite(Number(metrics[key])) ? Number(metrics[key]).toLocaleString("es-MX") : "Sin dato" : money(metrics[key])}</dd></div>)}</dl>
    <Period start={metrics.start_date} end={metrics.end_date} />
  </section>;
}

const titles: Record<string, { title: string; icon: typeof Package }> = {
  compare_branches: { title: "Comparación de sucursales", icon: Building2 },
  get_top_products: { title: "Productos más vendidos", icon: Package },
  get_inventory: { title: "Señales de inventario", icon: Boxes },
};
export function EvidenceCards({ cards }: { cards: NonNullable<Resource["data"]["cards"]> }) {
  return <div className="space-y-3">{cards.map((card, index) => {
    const definition = titles[card.kind];
    if (!definition) return null;
    const Icon = definition.icon;
    return <section key={index} aria-label={definition.title} className="min-w-0 break-words rounded-xl border border-kova-border bg-white p-4 text-sm">
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold"><Icon size={15} className="shrink-0 text-kova-blue" />{definition.title}</h3>
      {card.kind === "compare_branches" ? <><p className="text-xs text-kova-muted">Venta neta del negocio</p><p className="mb-3 mt-1 text-2xl font-semibold tabular-nums tracking-tight">{money(card.data.total_net_sales)}</p><ul className="divide-y divide-kova-border">{card.data.branches?.map(branch => <li key={branch.branch_id} className="flex items-center justify-between gap-3 py-3"><span className="min-w-0 font-medium">{branch.branch_name}</span><span className="shrink-0 text-right"><span className="block font-semibold tabular-nums">{money(branch.net_sales)}</span><span className="block text-xs text-kova-muted">{branch.completed_orders.toLocaleString("es-MX")} tickets</span></span></li>)}</ul>{card.data.branch_count !== undefined && card.data.branch_count > (card.data.branches?.length ?? 0) ? <p className="mt-2 text-xs text-kova-muted">Mostrando {card.data.branches?.length ?? 0} de {card.data.branch_count} sucursales.</p> : null}</> : null}
      {card.kind === "get_top_products" ? card.data.products?.length ? <><p className="mb-1 text-[11px] text-kova-muted">Unidades vendidas · Venta bruta</p><ol className="divide-y divide-kova-border">{card.data.products.map((product, rank) => <li key={product.product_id} className="flex items-center gap-3 py-3"><span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-kova-mist text-[11px] font-medium text-kova-muted">{rank + 1}</span><span className="min-w-0 flex-1 font-medium">{product.product_name}</span><span className="shrink-0 text-right"><span className="block font-semibold tabular-nums">{money(product.gross_sales)}</span><span className="block text-xs text-kova-muted">{product.quantity_sold.toLocaleString("es-MX")} unidades</span></span></li>)}</ol></> : <p className="py-2 text-kova-muted">No hay ventas completadas en el periodo.</p> : null}
      {card.kind === "get_inventory" ? <>
        <div className="space-y-2">{card.data.restock_alerts?.map(alert => <div key={alert.product_id} className="rounded-kova-md bg-kova-mist/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{alert.product_name}</p>{alert.severity === "critical" ? <span className="rounded-full bg-kova-danger/5 px-2 py-1 text-[10px] font-medium text-kova-danger">Atención prioritaria</span> : null}</div>
          <p className="mt-2 text-xs">Existencias: <strong className="font-semibold tabular-nums">{alert.stock_on_hand}</strong> · Umbral: {alert.low_stock_threshold}</p>
          <p className="mt-1 text-xs leading-5 text-kova-muted">{alert.days_until_out !== null ? `Duración estimada al ritmo registrado: ${alert.days_until_out} días.` : "Sin historial suficiente para estimar la duración."}</p>
        </div>)}</div>
        {card.data.restock_alerts?.length === 0 ? <p className="py-2 text-kova-muted">{card.data.inventory_valuation?.tracked_products === 0 ? "No hay productos con control de inventario. Actívalo en Catálogo para revisar existencias." : "No hay alertas de reposición con los datos registrados."}</p> : null}
        {card.data.available_alert_count !== undefined && card.data.available_alert_count > (card.data.restock_alerts?.length ?? 0) ? <p className="mt-3 text-xs text-kova-muted">Mostrando {card.data.restock_alerts?.length ?? 0} de {card.data.available_alert_count} alertas disponibles en Análisis.</p> : null}
        {card.data.inventory_valuation?.complete === false ? <p className="mt-3 rounded-kova-md bg-kova-mist p-2 text-xs leading-5 text-kova-muted">Faltan costos de {card.data.inventory_valuation.products_without_cost} productos; el valor del inventario está incompleto.</p> : null}
        <a href="/reports" className="mt-2 flex min-h-11 items-center gap-2 text-xs font-medium text-kova-blue hover:underline focus-visible:outline-kova-blue">Revisar inventario y recomendaciones en Análisis<ArrowUpRight size={14} className="shrink-0" /></a>
      </> : null}
      {card.data.start_date ? card.kind === "compare_branches" ? <p className="mt-3 text-[11px] text-kova-muted">{date(card.data.start_date)} a {date(card.data.end_date)} · Todo el negocio</p> : <Period start={card.data.start_date} end={card.data.end_date} /> : null}
    </section>;
  })}</div>;
}
