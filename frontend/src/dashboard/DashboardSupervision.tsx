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
  return <section aria-label="Alcance del centro de control" className="my-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-kova-xl border border-kova-border bg-white p-2.5 sm:gap-3 sm:px-4">
    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
      <Building2 className="h-4 w-4 shrink-0 text-kova-blue" aria-hidden="true" />
      <label htmlFor="dashboard-branch" className="sr-only text-sm font-medium sm:not-sr-only">Consultar</label>
      <Select id="dashboard-branch" value={scope} onChange={event => onScope(event.target.value)} disabled={loading || branches.length === 0} className="w-auto min-w-0 flex-1 sm:w-56 sm:flex-none">
        {canViewAll && <option value="all">Todas las sucursales</option>}
        {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </Select>
      <p className="sr-only text-xs text-kova-muted sm:not-sr-only">Este filtro no cambia la sucursal de Caja.</p>
    </div>
    <div className="flex items-center gap-2">
      <p className="sr-only text-xs text-kova-muted sm:not-sr-only" role="status">{loading ? "Actualizando…" : generatedAt
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

export function DashboardAttention({ control, allowedDestinations }: { control: DashboardControl; allowedDestinations: readonly { to: string }[] }) {
  const allowed = new Set(allowedDestinations.map(destination => destination.to));
  const alerts = control.alerts.filter(alert => allowed.has(controlRoutes[alert.route_key]));
  const incomplete = control.areas.some(area => area.status === "unavailable");
  const alertRow = (alert: DashboardControl["alerts"][number]) => <DashboardScopeLink key={`${alert.branch_id}:${alert.key}`} to={controlRoutes[alert.route_key]} branchId={alert.branch_id} branches={control.branches}
    className="group flex min-h-16 items-center gap-3 rounded-kova-md py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue">
    <span className={cn("flex h-9 min-w-9 shrink-0 items-center justify-center rounded-kova-md px-1 text-sm font-semibold tabular-nums", alert.priority === "now" ? "bg-destructive/10 text-destructive-strong" : "bg-warning/10 text-warning-foreground")}>{alert.count}</span>
    <span className="min-w-0 flex-1"><span className="block text-sm font-medium leading-snug">{alert.title}</span><span className="mt-1 block text-xs text-kova-muted">{alert.branch_name} · {metricScopeLabel[alert.scope]}</span></span>
    <ArrowUpRight className="h-4 w-4 shrink-0 text-kova-blue" aria-hidden="true" />
  </DashboardScopeLink>;
  return <section aria-labelledby="control-attention-title" className="rounded-kova-xl border border-kova-border bg-white p-4 sm:p-5">
    <div className="flex items-center justify-between gap-2"><h2 id="control-attention-title" className="font-semibold">Necesita tu atención</h2><span className="rounded-full bg-kova-mist px-2 py-1 text-xs font-semibold tabular-nums">{control.alert_groups_total}</span></div>
    {incomplete && <div role="status" className="mt-3 rounded-kova-md bg-warning/10 p-3 text-xs text-warning-foreground"><h3 className="flex items-center gap-1.5 font-semibold"><AlertCircle className="h-4 w-4" aria-hidden="true" />Lectura parcial</h3><p className="mt-1">Algunas áreas no pudieron actualizarse. Sus pendientes no se consideran resueltos.</p></div>}
    <div className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-kova-mist" aria-hidden="true">{(["now", "today", "followup"] as const).map(priority => <span key={priority} className={priority === "now" ? "bg-destructive" : priority === "today" ? "bg-warning" : "bg-kova-blue"} style={{ width: `${control.alert_groups_total ? control.priority_counts[priority] / control.alert_groups_total * 100 : 0}%` }} />)}</div>
    <p className="mt-2 text-[11px] text-kova-muted">{control.priority_counts.now} ahora · {control.priority_counts.today} hoy · {control.priority_counts.followup} seguimiento</p>
    {alerts.length ? <div className="mt-1 divide-y divide-kova-border">{alerts.slice(0, 3).map(alertRow)}</div> : <p className="mt-5 flex items-center gap-2 text-sm text-kova-muted"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{incomplete ? "Revisa las áreas disponibles." : "Sin señales prioritarias."}</p>}
    {alerts.length > 3 && <details className="border-t border-kova-border"><summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-kova-blue">Ver {alerts.length - 3} señales más</summary><div className="divide-y divide-kova-border">{alerts.slice(3).map(alertRow)}</div></details>}
    <p className="mt-3 border-t border-kova-border pt-3 text-[11px] text-kova-muted">Señales agrupadas por sucursal y tipo.{control.alerts_has_more ? ` Se muestran ${control.alerts.length} de ${control.alert_groups_total}; filtra para revisar más.` : ""}</p>
  </section>;
}

export function DashboardBranches({ control, onScope }: { control: DashboardControl; onScope: (id: string) => void }) {
  const stockAvailable = control.areas.some(area => area.key === "products" && area.status === "ready");
  const shiftsAvailable = control.areas.some(area => area.key === "sales" && area.status === "ready");
  const max = Math.max(1, ...control.branch_sales.map(branch => Math.max(0, Number(branch.net_sales))));
  return <section aria-labelledby="control-branches-title" className="mb-5 rounded-kova-xl border border-kova-border bg-white p-4 sm:p-5">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 id="control-branches-title" className="font-semibold">Resultados por sucursal</h2><span className="text-xs text-kova-muted">Ventas netas · periodo seleccionado</span></div>
    <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">{control.branch_sales.map((branch, index) => <article key={branch.branch_id}>
      <div className="flex items-center justify-between gap-2"><h3 className="min-w-0 break-words text-sm font-medium">{branch.branch_name}</h3>
        {control.scope.kind === "all" ? <button type="button" onClick={() => onScope(branch.branch_id)} aria-label={`Consultar ${branch.branch_name}`} className="flex min-h-11 shrink-0 items-center gap-2 rounded-kova-md px-1 text-sm font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue">{formatMoney(branch.net_sales)}<ArrowUpRight className="h-3.5 w-3.5 text-kova-blue" aria-hidden="true" /></button> : <strong className="py-3 text-sm font-semibold tabular-nums">{formatMoney(branch.net_sales)}</strong>}
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-kova-mist" aria-hidden="true"><div className={cn("h-full rounded-full", index % 2 ? "bg-kova-blue/40" : "bg-kova-blue")} style={{ width: `${Math.max(0, Number(branch.net_sales)) / max * 100}%` }} /></div>
      <p className="mt-2 text-xs text-kova-muted">{branch.completed_orders} órdenes · {Number(branch.share_pct).toLocaleString("es-MX", { maximumFractionDigits: 1 })}% de esta vista</p>
      <details className="mt-1"><summary className="min-h-11 cursor-pointer py-3 text-xs text-kova-blue">Caja e inventario actuales</summary><dl className="grid grid-cols-3 gap-2 pb-2 text-xs">{[["Stock bajo", stockAvailable ? branch.low_stock_count : null], ["Turnos abiertos", shiftsAvailable ? branch.open_shift_count : null], ["Señales", branch.attention_signals]].map(([label, value]) => <div key={String(label)}><dt className="text-kova-muted">{label}</dt><dd className="mt-1 font-semibold tabular-nums">{value ?? "Sin datos"}</dd></div>)}</dl></details>
    </article>)}</div>
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
