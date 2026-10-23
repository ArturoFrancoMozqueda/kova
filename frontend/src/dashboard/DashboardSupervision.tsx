import { useState, type MouseEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowUpRight, Building2, CheckCircle2, CloudUpload, RefreshCw, WifiOff } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getActiveBranchId, saveActiveBranchId } from "@/branches/activeBranch";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { formatMoney } from "@/orders/format";
import { useIsOnline, useSyncQueue } from "@/offline/useSyncQueue";
import { cn } from "@/lib/utils";
import { controlRoutes, metricScopeLabel, type ControlBranch, type DashboardControl } from "./controlTypes";

/** A supervision filter never changes the operating drawer. Entering a different
 * branch's operational screen is an explicit, confirmed context change. */
export function DashboardScopeLink({ to, branchId, branches, children, className }: {
  to: string; branchId: string | null; branches: ControlBranch[]; children: ReactNode; className?: string;
}) {
  const { state } = useAuth();
  const navigate = useNavigate();
  const [choose, setChoose] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const active = state.status === "authenticated" ? getActiveBranchId(state.tenantId, state.user.id) : null;
  const name = branches.find(branch => branch.id === pending)?.name;
  const open = (selected: string) => {
    if (selected === active) { setChoose(false); navigate(to); }
    else { setChoose(false); setPending(selected); }
  };
  const intercept = (event: MouseEvent<HTMLAnchorElement>) => {
    if (["/catalog", "/customers", "/settings", "/settings/billing", "/settings/channels"].includes(to)) return;
    // Always resolve scope before navigation, including modified clicks: a new
    // tab inherits no reliable branch preference for this supervision target.
    event.preventDefault();
    if (branchId) open(branchId);
    else if (branches.length === 1) open(branches[0].id);
    else setChoose(true);
  };
  const confirm = () => {
    if (!pending || state.status !== "authenticated") return;
    if (state.sessionMode === "offline" || !navigator.onLine) {
      setError("Conéctate para abrir otra sucursal.");
      return;
    }
    try {
      saveActiveBranchId(state.tenantId, state.user.id, pending);
      window.location.assign(to);
    } catch { setError("No pudimos cambiar de sucursal. Inténtalo de nuevo."); }
  };
  return <>
    <Link to={to} onClick={intercept} className={className}>{children}</Link>
    <Dialog open={choose} onClose={() => setChoose(false)}>
      <DialogHeader><DialogTitle>¿Qué sucursal quieres abrir?</DialogTitle></DialogHeader>
      <p className="mb-4 text-sm text-kova-muted">El panel consulta todas las sucursales. Elige dónde continuar esta tarea.</p>
      <div className="space-y-2">{branches.map(branch => (
        <Button key={branch.id} variant="outline" className="w-full justify-between" onClick={() => open(branch.id)}>
          {branch.name}<ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      ))}</div>
    </Dialog>
    <ConfirmDialog open={pending !== null} title={`Abrir ${name ?? "otra sucursal"}`}
      description={`Continuarás esta tarea en ${name ?? "la sucursal elegida"}. Se cambiará la sucursal operativa, se vaciará el carrito y se descartarán cambios sin guardar. Las ventas registradas y pendientes de sincronizar conservan su sucursal de origen.${error ? ` ${error}` : ""}`}
      confirmLabel="Cambiar sucursal y continuar" destructive={false} onConfirm={confirm} onCancel={() => { setPending(null); setError(""); }} />
  </>;
}

export function DashboardScopeToolbar({ scope, branches, canViewAll, loading, generatedAt, timezone, onScope, onRefresh }: {
  scope: string; branches: ControlBranch[]; canViewAll: boolean; loading: boolean;
  generatedAt: string | null; timezone: string; onScope: (scope: string) => void; onRefresh: () => void;
}) {
  return <section aria-label="Alcance del centro de control" className="my-5 flex flex-wrap items-center justify-between gap-3 rounded-kova-xl border border-kova-border bg-white p-3 sm:px-4">
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
      <Building2 className="h-4 w-4 shrink-0 text-kova-blue" aria-hidden="true" />
      <label htmlFor="dashboard-branch" className="text-sm font-medium">Consultar</label>
      <Select id="dashboard-branch" value={scope} onChange={event => onScope(event.target.value)} disabled={loading || branches.length === 0} className="w-full sm:w-56">
        {canViewAll && <option value="all">Todas las sucursales</option>}
        {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </Select>
      <p className="text-xs text-kova-muted">Este filtro no cambia la sucursal de Caja.</p>
    </div>
    <div className="flex items-center gap-2">
      <p className="text-xs text-kova-muted" role="status">{loading ? "Actualizando…" : generatedAt
        ? `Actualizado a las ${new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(generatedAt))}` : "Sin actualización confirmada"}</p>
      <Button variant="ghost" size="icon" onClick={onRefresh} disabled={loading} aria-label="Actualizar centro de control"><RefreshCw className="h-4 w-4" /></Button>
    </div>
  </section>;
}

export function DashboardViewLink({ control, to, children, className }: {
  control: DashboardControl | null; to: string; children: ReactNode; className?: string;
}) {
  return control ? <DashboardScopeLink to={to} branchId={control.scope.branch_id} branches={control.branches} className={className}>{children}</DashboardScopeLink>
    : <Link to={to} className={className}>{children}</Link>;
}

export function DashboardStatusSummary({ control }: { control: DashboardControl }) {
  const incomplete = control.areas.some(area => area.status === "unavailable");
  const labels = { now: "Atender ahora", today: "Revisar hoy", followup: "Dar seguimiento" } as const;
  return <aside aria-labelledby="control-status-title" className="rounded-kova-xl border border-kova-border bg-white p-5">
    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-kova-blue">Estado del negocio</p>
    <h2 id="control-status-title" className="mt-3 text-xl font-semibold tracking-tight">{incomplete ? "Lectura parcial" : control.alert_groups_total ? "Hay asuntos por atender" : "Sin señales prioritarias"}</h2>
    <p className="mt-2 text-sm text-kova-muted">{control.scope.label}. Señales agrupadas por sucursal y tipo.{incomplete ? " Las cifras excluyen las áreas sin actualizar." : ""}</p>
    <dl className="mt-5 divide-y divide-kova-border">{(["now", "today", "followup"] as const).map(priority => (
      <div key={priority} className="flex items-center justify-between gap-3 py-4"><dt className="text-sm text-kova-muted">{labels[priority]}</dt><dd className={cn("text-2xl font-semibold tabular-nums", priority === "now" && control.priority_counts.now > 0 ? "text-destructive-strong" : "text-kova-ink")}>{control.priority_counts[priority]}</dd></div>
    ))}</dl>
    <p className="mt-4 text-xs leading-relaxed text-kova-muted">Los resultados de ventas usan el periodo seleccionado. Los pendientes muestran lo que sigue abierto al actualizar.</p>
  </aside>;
}

export function DashboardAttention({ control, allowedDestinations }: { control: DashboardControl; allowedDestinations: readonly { to: string }[] }) {
  const allowed = new Set(allowedDestinations.map(destination => destination.to));
  const alerts = control.alerts.filter(alert => allowed.has(controlRoutes[alert.route_key]));
  const incomplete = control.areas.some(area => area.status === "unavailable");
  return <section aria-labelledby="control-attention-title" className="mb-6 rounded-kova-xl border border-kova-border bg-white p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 id="control-attention-title" className="text-lg font-semibold tracking-tight">Necesita tu atención</h2>
        <p className="mt-1 text-sm text-kova-muted">{control.scope.label} · Pendientes actuales y diferencias del periodo.</p>
      </div>
      <span className="rounded-full bg-kova-mist px-3 py-1 text-xs font-medium text-kova-muted">{control.alert_groups_total} señales registradas</span>
    </div>
    {incomplete && <p role="status" className="mt-3 flex items-start gap-2 rounded-kova-md bg-warning/10 p-3 text-sm text-warning-foreground"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />Algunas áreas no pudieron actualizarse. Sus pendientes no se consideran resueltos.</p>}
    {alerts.length === 0 ? <p className="mt-4 flex items-center gap-2 text-sm text-kova-muted"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{incomplete ? "Consulta las áreas disponibles y vuelve a actualizar." : "Sin señales prioritarias en las áreas revisadas."}</p> : (
      <div className="mt-4 grid gap-2 lg:grid-cols-2">{alerts.map(alert => (
        <DashboardScopeLink key={`${alert.branch_id}:${alert.key}`} to={controlRoutes[alert.route_key]} branchId={alert.branch_id} branches={control.branches}
          className="group flex items-center gap-3 rounded-kova-lg border border-kova-border p-3 transition-colors hover:bg-kova-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue">
          <span className={cn("flex h-10 min-w-10 shrink-0 items-center justify-center rounded-kova-md px-1 font-semibold tabular-nums", alert.priority === "now" ? "bg-destructive/10 text-destructive-strong" : "bg-warning/10 text-warning-foreground")}>{alert.count}</span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{alert.title}</span><span className="mt-1 block text-xs text-kova-muted">{alert.branch_name} · {metricScopeLabel[alert.scope]} · {alert.priority === "now" ? "Atender ahora" : alert.priority === "today" ? "Revisar hoy" : "Seguimiento"}</span></span>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-kova-blue" aria-hidden="true" />
        </DashboardScopeLink>
      ))}</div>
    )}
    {control.alerts_has_more && <p className="mt-3 text-xs text-kova-muted">Se muestran las primeras {control.alerts.length} señales. Filtra por sucursal y consulta cada área para revisar el resto.</p>}
  </section>;
}

export function DashboardBranches({ control, onScope }: { control: DashboardControl; onScope: (id: string) => void }) {
  const stockAvailable = control.areas.some(area => area.key === "products" && area.status === "ready");
  const shiftsAvailable = control.areas.some(area => area.key === "sales" && area.status === "ready");
  return <section aria-labelledby="control-branches-title" className="mb-7">
    <h2 id="control-branches-title" className="text-xl font-semibold tracking-tight">Resultados por sucursal</h2>
    <p className="mt-1 text-sm text-kova-muted">Ventas del periodo seleccionado. Stock y turnos muestran su estado actual.</p>
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{control.branch_sales.map(branch => (
      <article key={branch.branch_id} className="rounded-kova-xl border border-kova-border bg-white p-4">
        <div className="flex items-center justify-between gap-2"><h3 className="min-w-0 break-words font-semibold">{branch.branch_name}</h3>
          {control.scope.kind === "all" && <Button variant="ghost" size="sm" onClick={() => onScope(branch.branch_id)} aria-label={`Consultar ${branch.branch_name}`}>Ver<ArrowUpRight className="ml-1 h-4 w-4" /></Button>}
        </div>
        <p className="mt-3 break-words text-2xl font-semibold tracking-tight tabular-nums">{formatMoney(branch.net_sales)}</p>
        <p className="mt-1 text-xs text-kova-muted">{branch.completed_orders} órdenes · Ticket {formatMoney(branch.average_ticket)}</p>
        <p className="mt-1 text-xs text-kova-muted">{Number(branch.share_pct).toLocaleString("es-MX", { maximumFractionDigits: 1 })}% de las ventas en esta vista</p>
        <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-kova-border pt-3 text-xs">
          {[['Stock bajo', stockAvailable ? branch.low_stock_count : null], ['Turnos abiertos', shiftsAvailable ? branch.open_shift_count : null], ['Señales', branch.attention_signals]].map(([label, value]) => (
            <div key={String(label)}><dt className="text-kova-muted">{label}</dt><dd className="mt-1 text-base font-semibold tabular-nums">{value ?? "Sin datos"}</dd></div>
          ))}
        </dl>
      </article>
    ))}</div>
  </section>;
}

export function DashboardDeviceStatus() {
  const online = useIsOnline();
  const { pendingCount, failedEntries, quarantinedCount, ready } = useSyncQueue();
  return <section aria-labelledby="control-device-title" className="mb-7 rounded-kova-xl border border-kova-border bg-white p-4">
    <h2 id="control-device-title" className="flex items-center gap-2 text-base font-semibold">{online ? <CloudUpload className="h-4 w-4 text-kova-blue" /> : <WifiOff className="h-4 w-4 text-warning-strong" />}Este dispositivo</h2>
    <p className="mt-1 text-xs text-kova-muted">La cola local puede incluir ventas de distintas sucursales de este negocio. No representa otros dispositivos.</p>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm" role="status">{ready ? `${pendingCount} por sincronizar · ${failedEntries.length} con error · ${quarantinedCount} registros sin negocio verificado` : "Consultando la cola de este dispositivo…"}</p>
      <Link to="/sync-queue" className="inline-flex min-h-11 items-center gap-1 rounded-kova-md px-2 text-sm font-medium text-kova-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue">Revisar sincronización<ArrowUpRight className="h-4 w-4" /></Link>
    </div>
  </section>;
}
