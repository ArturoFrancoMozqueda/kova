import type { Resource } from "./api";
const money = (value: unknown) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(value));
export function EvidenceCards({ cards }: { cards: NonNullable<Resource["data"]["cards"]> }) {
  return <div className="space-y-3">{cards.map((card, index) => <div key={index} className="break-words rounded-kova-md border border-kova-border p-3 text-sm">
    <h3 className="font-medium">{card.kind === "compare_branches" ? "Comparación de sucursales" : card.kind === "get_top_products" ? "Productos más vendidos" : "Señales de inventario"}</h3>
    {card.kind === "compare_branches" ? <><p className="mt-2">Venta neta del negocio: {money(card.data.total_net_sales)}</p>{card.data.branches?.map(branch => <p key={branch.branch_id} className="mt-2">{branch.branch_name}: {money(branch.net_sales)} · {branch.completed_orders} tickets</p>)}<p className="mt-2 text-xs text-kova-muted">Mostrando hasta cinco de {card.data.branch_count} sucursales.</p></> : null}
    {card.kind === "get_top_products" ? card.data.products?.length ? card.data.products.map(product => <p key={product.product_id} className="mt-2">{product.product_name}: {product.quantity_sold} unidades · {money(product.gross_sales)}</p>) : <p className="mt-2 text-kova-muted">No hay ventas completadas en el periodo.</p> : null}
    {card.kind === "get_inventory" ? <>
      {card.data.restock_alerts?.map(alert => <div key={alert.product_id} className="mt-2">
        <p className="font-medium">{alert.product_name}{alert.severity === "critical" ? " · Atención prioritaria" : ""}</p>
        <p>Existencias: {alert.stock_on_hand} · Umbral: {alert.low_stock_threshold}</p>
        <p className="text-xs text-kova-muted">{alert.days_until_out !== null ? `Duración estimada al ritmo registrado: ${alert.days_until_out} días.` : "Sin historial suficiente para estimar la duración."}</p>
      </div>)}
      {card.data.restock_alerts?.length === 0 ? <p className="mt-2 text-kova-muted">{card.data.inventory_valuation?.tracked_products === 0 ? "No hay productos con control de inventario. Actívalo en Catálogo para revisar existencias." : "No hay alertas de reposición con los datos registrados."}</p> : null}
      {card.data.available_alert_count !== undefined && card.data.available_alert_count > (card.data.restock_alerts?.length ?? 0) ? <p className="mt-2 text-xs text-kova-muted">Mostrando {card.data.restock_alerts?.length ?? 0} de {card.data.available_alert_count} alertas disponibles en Análisis.</p> : null}
      {card.data.inventory_valuation?.complete === false ? <p className="mt-2 text-xs text-kova-muted">Faltan costos de {card.data.inventory_valuation.products_without_cost} productos; el valor del inventario está incompleto.</p> : null}
      <p className="mt-2"><a href="/reports" className="text-kova-blue underline">Revisar inventario y recomendaciones en Análisis</a></p>
    </> : null}
    {card.data.start_date ? <p className="mt-2 text-xs text-kova-muted">{card.data.start_date} a {card.data.end_date}</p> : null}
  </div>)}</div>;
}
