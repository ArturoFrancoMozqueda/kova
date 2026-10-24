import { useId, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, CreditCard, Receipt, ShoppingBag, TrendingUp } from "lucide-react";
import { formatMoney, reasonLabel } from "@/orders/format";
import { calculateSafeGrowth, MIN_MONEY_BASE } from "@/lib/growth";
import type { BusinessStoryReport, SalesByHourRow, SalesSummary } from "@/reports/types";
import { cn } from "@/lib/utils";
import { DashboardAttention, DashboardViewLink } from "./DashboardSupervision";
import { salesTrendPoints } from "./visualData";
import type { DashboardControl } from "./controlTypes";


function SalesTrend({ story, hourly, byHour }: { story: BusinessStoryReport; hourly: SalesByHourRow[]; byHour: boolean }) {
  const gradient = useId().replace(/:/g, "");
  const points = salesTrendPoints(story, hourly, byHour);
  const [selection, setSelection] = useState<string | null>(null);
  const selected = points.find(point => point.id === selection);
  const low = Math.min(0, ...points.map(point => point.value));
  const high = Math.max(1, ...points.map(point => point.value));
  const x = (index: number) => 52 + index / Math.max(1, points.length - 1) * 642;
  const y = (value: number) => 180 - (value - low) / (high - low) * 154;
  const line = points.map((point, index) => `${x(index)},${y(point.value)}`).join(" ");
  const base = y(0);
  const labelIndices = [...new Set([0, Math.floor((points.length - 1) / 3), Math.floor((points.length - 1) * 2 / 3), points.length - 1])];
  return <div className="rounded-kova-xl border border-kova-border bg-white p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h2 className="font-semibold">Ritmo de ventas</h2><p className="mt-1 text-xs text-kova-muted">{byHour ? "Ventas netas por hora" : "Ventas netas por día"}</p></div>
      <div className="text-right"><p className="text-sm font-semibold tabular-nums" aria-live="polite">{formatMoney(selected?.value ?? story.summary.net_sales)}</p><p className="mt-1 text-xs text-kova-muted">{selected?.label ?? "Total del periodo"}</p></div>
    </div>
    {points.length ? <>
      <div className="mt-4 flex gap-3">
        <div className="relative hidden h-56 w-10 shrink-0 text-right text-[11px] tabular-nums text-kova-muted sm:block" aria-hidden="true">{[high, (high + low) / 2, low].map((value, index) => <span key={index} className="absolute right-0 -translate-y-1/2" style={{ top: `${y(value) / 195 * 100}%` }}>{new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 }).format(value)}</span>)}</div>
        <div className="min-w-0 flex-1">
          <svg viewBox="45 0 660 195" preserveAspectRatio="none" className="h-44 w-full sm:h-56" role="img" aria-label={`Gráfica de ventas netas ${byHour ? "por hora" : "por día"}`}>
            <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3868ff" stopOpacity="0.22" /><stop offset="100%" stopColor="#3868ff" stopOpacity="0.02" /></linearGradient></defs>
            {[low, (high + low) / 2, high].map((value, index) => <line key={index} x1="52" x2="694" y1={y(value)} y2={y(value)} stroke="#dfe4ee" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />)}
            <polygon points={`${x(0)},${base} ${line} ${x(points.length - 1)},${base}`} fill={`url(#${gradient})`} />
            <polyline points={line} fill="none" stroke="#3868ff" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            {selected && <line x1={x(points.indexOf(selected))} x2={x(points.indexOf(selected))} y1="20" y2="182" stroke="#3868ff" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
          </svg>
          <div className="mb-3 flex justify-between gap-2 text-[11px] tabular-nums text-kova-muted" aria-hidden="true">{labelIndices.map(index => <span key={index}>{byHour ? points[index].label : `${points[index].id.slice(8)}/${points[index].id.slice(5, 7)}`}</span>)}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-kova-border pt-2">
        <label className="text-xs text-kova-muted" htmlFor={`${gradient}-point`}>Consultar {byHour ? "hora" : "día"}</label>
        <select id={`${gradient}-point`} className="min-h-11 max-w-full rounded-kova-md border border-kova-border bg-white px-2 text-xs" value={selected?.id ?? ""} onChange={event => setSelection(event.target.value || null)}>
          <option value="">Total del periodo</option>{points.map(point => <option key={point.id} value={point.id}>{point.label} · {formatMoney(point.value)}</option>)}
        </select>
      </div>
    </> : <div className="flex h-64 items-center justify-center text-sm text-kova-muted">Sin desglose horario disponible.</div>}
  </div>;
}

export function DashboardVisualOverview({ story, hourly, previous, compareLabel, byHour, control, destinations }: {
  story: BusinessStoryReport; hourly: SalesByHourRow[]; previous: SalesSummary | null; compareLabel: string;
  byHour: boolean; control: DashboardControl; destinations: readonly { to: string }[];
}) {
  const growth = previous && previous.order_count > 0 ? calculateSafeGrowth(Number(story.summary.net_sales), Number(previous.net_sales), { minBase: MIN_MONEY_BASE }) : null;
  const rising = growth?.kind === "pct" && growth.value >= 0;
  const salesArea = control.areas.find(area => area.key === "sales");
  const shifts = salesArea?.status === "ready" ? salesArea.metrics.find(metric => metric.key === "open_shifts")?.value : null;
  const cards = [
    { label: "Ventas netas", value: formatMoney(story.summary.net_sales), icon: TrendingUp, main: true, note: previous?.order_count ? `${formatMoney(previous.net_sales)} ${compareLabel}` : "Sin base anterior" },
    { label: "Órdenes", value: story.summary.completed_orders.toLocaleString("es-MX"), icon: ShoppingBag, note: "Completadas en el periodo" },
    { label: "Ticket promedio", value: formatMoney(story.summary.average_ticket), icon: Receipt, note: "Por orden completada" },
    { label: "Turnos abiertos", value: shifts ?? "Sin datos", icon: CreditCard, note: "Estado actual de caja" },
  ];
  return <section aria-label="Tu día" className="mb-5 space-y-4">
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{cards.map(({ label, value, icon: Icon, note, main }) => <div key={label} className={cn("min-w-0 rounded-kova-xl border p-3 sm:p-5", main ? "border-kova-ink bg-kova-ink text-white" : "border-kova-border bg-white")}>
      <div className="flex items-center justify-between gap-2"><p className={cn("text-xs font-medium", main ? "text-white/80" : "text-kova-muted")}>{label}</p><Icon className="h-4 w-4 shrink-0" aria-hidden="true" /></div>
      <p aria-label={main ? "Ventas netas del periodo" : undefined} className="mt-3 break-words text-xl font-semibold tracking-tight tabular-nums sm:text-3xl">{value}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {main && growth?.kind === "pct" && <span className={cn("inline-flex items-center rounded px-1 py-0.5 text-xs font-semibold", rising ? "bg-emerald-200 text-emerald-950" : "bg-rose-200 text-rose-950")}>{rising ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(growth.value).toLocaleString("es-MX", { maximumFractionDigits: 1 })}%</span>}
        <p className={cn("text-[11px]", main ? "text-white/80" : "text-kova-muted")}>{note}</p>
      </div>
    </div>)}</div>
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(300px,1fr)]">
      <SalesTrend key={`${story.summary.start_date}:${story.summary.end_date}:${control.scope.branch_id}`} story={story} hourly={hourly} byHour={byHour} />
      <DashboardAttention control={control} allowedDestinations={destinations} />
    </div>
  </section>;
}

function VisualCard({ title, children, control }: { title: string; children: ReactNode; control: DashboardControl }) {
  return <section aria-label={title} className="min-w-0 rounded-kova-xl border border-kova-border bg-white p-4 sm:p-5">
    <div className="mb-4 flex items-center justify-between gap-2"><h2 className="font-semibold">{title}</h2><DashboardViewLink control={control} to="/reports" className="flex min-h-11 items-center gap-1 text-xs font-medium text-kova-blue">Detalle<ArrowUpRight className="h-3 w-3" aria-hidden="true" /></DashboardViewLink></div>{children}
  </section>;
}

export function DashboardSalesMix({ story, hourly, control }: { story: BusinessStoryReport; hourly: SalesByHourRow[]; control: DashboardControl }) {
  const products = story.product_drivers.slice(0, 3);
  const hours = [...hourly].sort((a, b) => Number(b.net_sales) - Number(a.net_sales)).slice(0, 3);
  const payments = story.payment_mix.filter(payment => Number(payment.amount) > 0);
  const colors = ["#3868ff", "#11141d", "#10a888", "#8659d9", "#b46d12"];
  const paymentTotal = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  let offset = 0;
  const slices = payments.map((payment, index) => {
    const start = offset; offset += Number(payment.amount) / paymentTotal * 100;
    return `${colors[index % colors.length]} ${start}% ${offset}%`;
  });
  const ranks = (rows: { id: string; label: string; value: number }[]) => {
    const max = Math.max(1, ...rows.map(row => row.value));
    return rows.length ? <ol className="space-y-4">{rows.map((row, index) => <li key={row.id}>
      <div className="mb-2 flex items-center justify-between gap-3 text-sm"><span className="min-w-0 truncate">{row.label}</span><strong className="shrink-0 font-semibold tabular-nums">{formatMoney(row.value)}</strong></div>
      <div className="h-2 rounded-full bg-kova-mist" aria-hidden="true"><div className={cn("h-full rounded-full", index === 0 ? "bg-kova-blue" : "bg-kova-blue/35")} style={{ width: `${Math.max(0, row.value) / max * 100}%` }} /></div>
    </li>)}</ol> : <p className="py-5 text-sm text-kova-muted">Sin ventas registradas en este desglose.</p>;
  };
  return <div className="mb-5 grid gap-4 lg:grid-cols-3">
    <VisualCard title="Productos más vendidos" control={control}>{ranks(products.map(product => ({ id: product.product_id, label: product.product_name, value: Number(product.gross_sales) })))}<p className="mt-4 text-[11px] text-kova-muted">Por importe bruto del periodo.</p></VisualCard>
    <VisualCard title="Horas con más venta" control={control}>{ranks(hours.map(hour => ({ id: String(hour.hour), label: `${String(hour.hour).padStart(2, "0")}:00–${String(hour.hour + 1).padStart(2, "0")}:00`, value: Number(hour.net_sales) })))}</VisualCard>
    <VisualCard title="Cómo te pagaron" control={control}>{paymentTotal > 0 ? <div className="flex flex-wrap items-center gap-5">
      <div className="relative h-28 w-28 shrink-0 rounded-full" style={{ background: `conic-gradient(${slices.join(",")})` }} role="img" aria-label="Distribución de cobros brutos por método de pago"><div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-white"><span className="text-[10px] text-kova-muted">Cobros</span><strong className="text-xs tabular-nums">{formatMoney(paymentTotal)}</strong></div></div>
      <ul className="min-w-0 flex-1 space-y-2">{payments.map((payment, index) => <li key={payment.method} className="flex items-center gap-2 text-xs"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} aria-hidden="true" /><span className="flex-1">{reasonLabel(payment.method)}</span><strong className="tabular-nums">{Math.round(Number(payment.amount) / paymentTotal * 100)}%</strong><span className="sr-only">{formatMoney(payment.amount)}</span></li>)}</ul>
    </div> : <p className="py-5 text-sm text-kova-muted">Sin cobros registrados.</p>}<p className="mt-4 text-[11px] text-kova-muted">Cobros antes de devoluciones · {formatMoney(story.summary.refund_total)} devuelto.</p></VisualCard>
  </div>;
}
