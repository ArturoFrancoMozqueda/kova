import { Link } from "react-router-dom";
import {
  ArrowUpRight, CalendarClock, CalendarDays, ChartNoAxesCombined, CircleDollarSign,
  ClipboardCheck, Handshake, LifeBuoy, ListTodo, MessageCircle, Package,
  PackageCheck, PackageMinus, PackageX, Settings2, ShoppingBag, Users, Wallet,
  Workflow, type LucideIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { WorkspaceNavigationContext } from "@/layout/workspaceNavigation";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/orders/format";
import { DashboardScopeLink } from "./DashboardSupervision";
import { controlRoutes, metricScopeLabel, type DashboardControl, type ControlMetric } from "./controlTypes";

type Snapshot = {
  orderCount: number;
  activeCatalogCount: number;
  lowStockCount: number;
};

const areas = [
  {
    id: "sales", title: "Ventas y caja", icon: ShoppingBag,
    description: "De la cotización al cobro y al corte de caja.",
    paths: ["/register", "/orders", "/pedidos", "/quotes", "/shifts"],
    prompt: "Consulta tus ventas y turnos",
  },
  {
    id: "products", title: "Productos e inventario", icon: Package,
    description: "Qué puedes vender y qué necesitas reponer.",
    paths: ["/inventory", "/catalog", "/replenishment", "/purchasing"],
    prompt: "Consulta tus existencias",
  },
  {
    id: "customers", title: "Clientes y oportunidades", icon: Users,
    description: "Conoce a tus clientes y da seguimiento a cada oportunidad.",
    paths: ["/customers", "/crm", "/commercial-requests", "/followups", "/loyalty", "/settings/public-catalog"],
    prompt: "Historial, seguimiento y recompra",
  },
  {
    id: "attention", title: "Atención y agenda", icon: CalendarDays,
    description: "Revisa lo que hay por atender y organiza tu día.",
    paths: ["/operations-queue", "/appointments", "/service-cases", "/inbox"],
    prompt: "Consulta pendientes y citas",
  },
  {
    id: "money", title: "Finanzas y análisis", icon: ChartNoAxesCombined,
    description: "Entiende tus resultados, gastos y movimientos de dinero.",
    paths: ["/reports", "/expenses", "/reconciliation", "/assistant"],
    prompt: "Revisa cómo se mueve tu dinero",
  },
  {
    id: "business", title: "Configuración del negocio", icon: Settings2,
    description: "Administra tu equipo, reglas, conexiones y suscripción.",
    paths: ["/settings", "/automations", "/settings/channels", "/settings/integrations", "/settings/billing"],
    prompt: "Consulta configuración y disponibilidad",
  },
] as const;

const metricIcons: Record<string, LucideIcon> = {
  orders_ready: PackageCheck, open_shifts: Wallet,
  low_stock: PackageMinus, out_of_stock: PackageX,
  opportunities: Handshake, followups: ListTodo,
  appointments_today: CalendarClock, cases_open: LifeBuoy,
  gross_profit: ChartNoAxesCombined, unmatched_amount: CircleDollarSign, unmatched: ClipboardCheck,
  automation_pending: ListTodo, automation_rules: Workflow, whatsapp: MessageCircle,
};

/** Navigation reuses the shell's allowed destinations. Counts are shown only
 * for a verified overview; linked modules never imply zero pending work. */
export function BusinessControlCenter({ destinations, snapshot, control = null, loading = false }: WorkspaceNavigationContext & {
  snapshot: Snapshot | null; control?: DashboardControl | null; loading?: boolean;
}) {
  const allowed = new Set(destinations.map(destination => destination.to));
  const metricRow = (metric: ControlMetric) => <div key={metric.key} className="border-b border-kova-border/60 py-2 last:border-0">
    <dt className="text-sm text-kova-muted">{metric.label}</dt>
    <dd className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className="break-words text-base font-semibold tabular-nums">{metric.value === null ? "Sin datos suficientes" : metric.format === "money" ? formatMoney(metric.value) : metric.format === "count" ? Number(metric.value).toLocaleString("es-MX") : metric.value}</span>
      <span className="text-[11px] text-kova-muted">{metricScopeLabel[metric.scope]}</span>
    </dd>
    {metric.detail && <dd className="mt-1 text-xs text-kova-muted">{metric.detail}</dd>}
  </div>;
  const primaryKeys: Record<string, string[]> = {
    sales: ["orders_ready", "open_shifts"], products: ["low_stock", "out_of_stock"],
    customers: ["opportunities", "followups"], attention: ["appointments_today", "cases_open"],
    money: ["gross_profit", "unmatched_amount"], business: ["automation_pending", "whatsapp"],
  };
  const visibleAreas = areas.flatMap(area => {
    const links = area.paths.flatMap(path => destinations.filter(destination => destination.to === path));
    return links.length > 0 ? [{ ...area, links }] : [];
  });
  if (visibleAreas.length === 0) return null;

  return (
    <section aria-labelledby="business-control-title" aria-busy={loading || undefined} className="mb-8 scroll-mt-4" id="business-control">
      {loading && <span role="status" className="sr-only">Cargando áreas del negocio</span>}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-kova-blue">Todo tu negocio</p>
          <h2 id="business-control-title" className="text-xl font-semibold tracking-tight text-kova-ink">{control || loading ? "Tu operación, de un vistazo" : "Cada área, a la vista"}</h2>
          {!control && !loading && <p className="mt-1 max-w-2xl text-sm text-kova-muted">Entra a cada área para consultar su estado y dar el siguiente paso.</p>}
        </div>
        {loading ? <Skeleton className="h-3 w-36" /> : <p className="text-xs text-kova-muted">{control ? control.scope.label : "Los pendientes y conexiones se consultan en su sección."}</p>}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleAreas.map(area => {
          const Icon = area.icon;
          const live = control?.areas.find(item => item.key === area.id);
          const liveMetrics = live?.metrics.filter(metric => allowed.has(controlRoutes[metric.route_key])) ?? [];
          const preferred = primaryKeys[area.id].flatMap(key => liveMetrics.filter(metric => metric.key === key));
          const primary = [...preferred, ...liveMetrics.filter(metric => !preferred.includes(metric))].slice(0, 2);
          const secondary = liveMetrics.filter(metric => !primary.includes(metric));
          const needsStock = area.id === "products" && (control
            ? liveMetrics.some(metric => ["low_stock", "out_of_stock"].includes(metric.key) && Number(metric.value) > 0)
            : snapshot !== null && snapshot.lowStockCount > 0);
          const hasMetric = snapshot !== null && (area.id === "sales" || area.id === "products");
          return (
            <article key={area.id} aria-labelledby={`control-${area.id}`} className="flex min-w-0 flex-col overflow-hidden rounded-kova-xl border border-kova-border bg-white shadow-kova-card">
              <div className={cn("h-1", needsStock ? "bg-warning" : "bg-kova-blue/30")} />
              <div className="flex flex-1 flex-col p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <span className={cn("flex h-10 w-10 items-center justify-center rounded-kova-lg", needsStock ? "bg-warning/10 text-warning-strong" : "bg-kova-mist text-kova-blue")}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  {loading ? <Skeleton className="h-6 w-28 rounded-full" /> : <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", needsStock ? "bg-warning/10 text-warning-foreground" : "bg-kova-mist text-kova-muted")}>
                    {live ? live.status === "unavailable" ? "Sin actualizar" : "Estado del área" : hasMetric ? area.id === "sales" ? "Periodo seleccionado" : "Inventario actual" : "Consultar"}
                  </span>}
                </div>
                <h3 id={`control-${area.id}`} className="text-base font-semibold tracking-tight">{area.title}</h3>
                {!control && !loading && <p className="mt-1 text-sm leading-relaxed text-kova-muted">{area.description}</p>}
                {loading ? <div className="my-4 grid grid-cols-2 gap-3" aria-hidden="true">{[0, 1].map(index => <div key={index} className="min-w-0 rounded-kova-lg bg-kova-mist/60 p-3">
                  <Skeleton className="h-7 w-16" />
                  <div className="mt-2 flex items-start gap-1.5"><Skeleton className="h-4 w-4 shrink-0" /><Skeleton className="h-8 w-full" /></div>
                </div>)}</div> : live ? live.status === "unavailable" ? (
                  <p role="status" className="my-4 rounded-kova-md bg-warning/10 p-3 text-sm text-warning-foreground">No pudimos consultar esta área. Actualiza el panel para intentarlo de nuevo.</p>
                ) : <dl className="my-4 grid grid-cols-2 gap-3">{primary.map(metric => {
                  const MetricIcon = metricIcons[metric.key] ?? Icon;
                  const stockWarning = needsStock && ["low_stock", "out_of_stock"].includes(metric.key) && Number(metric.value) > 0;
                  return <div key={metric.key} className={cn("flex min-w-0 flex-col rounded-kova-lg p-3", stockWarning ? "bg-warning/10" : "bg-kova-mist/60")}>
                    <dt className="order-2 mt-2 flex min-h-8 items-start gap-1.5 text-xs leading-snug text-kova-muted">
                      <MetricIcon className={cn("h-4 w-4 shrink-0", stockWarning ? "text-warning-strong" : "text-kova-blue")} aria-hidden="true" />
                      <span>{metric.label}</span>
                    </dt>
                    <dd className="order-1 min-w-0 break-words text-xl font-semibold tracking-tight tabular-nums">{metric.value === null ? <span className="text-sm text-kova-muted">Sin datos suficientes</span> : metric.format === "money" ? formatMoney(metric.value) : metric.format === "count" ? Number(metric.value).toLocaleString("es-MX") : <span className="text-sm">{metric.value}</span>}</dd>
                  </div>;
                })}</dl> : <p className={cn("my-4 text-sm font-semibold", needsStock ? "text-warning-foreground" : "text-kova-ink")}>
                  {snapshot && area.id === "sales"
                    ? `${snapshot.orderCount} ${snapshot.orderCount === 1 ? "venta completada" : "ventas completadas"}`
                    : snapshot && area.id === "products"
                      ? needsStock
                        ? `${snapshot.lowStockCount} ${snapshot.lowStockCount === 1 ? "producto por reponer" : "productos por reponer"}`
                        : `${snapshot.activeCatalogCount} ${snapshot.activeCatalogCount === 1 ? "producto activo" : "productos activos"}`
                      : area.prompt}
                </p>}
                {loading ? <div className="mt-auto border-t border-kova-border pt-2" aria-hidden="true"><Skeleton className="my-3 h-5 w-48 max-w-full" /></div> : control ? <details className="mt-auto border-t border-kova-border pt-2">
                  <summary className="min-h-11 cursor-pointer rounded-kova-md py-3 text-sm font-medium text-kova-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue">Ver detalle y herramientas</summary>
                  {secondary.length > 0 && <dl className="mb-3">{secondary.map(metricRow)}</dl>}
                  <nav aria-label={area.title} className="grid grid-cols-2 gap-x-2">{area.links.map(link => (
                    <DashboardScopeLink key={link.to} to={link.to} branchId={control.scope.branch_id} branches={control.branches} className="flex min-h-11 items-center justify-between gap-2 rounded-kova-md px-2 py-2 text-sm text-kova-muted hover:bg-kova-mist hover:text-kova-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue">
                      <span>{link.label}</span><ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                    </DashboardScopeLink>
                  ))}</nav>
                </details> : <nav aria-label={area.title} className="mt-auto grid grid-cols-2 gap-x-2 border-t border-kova-border pt-2">
                  {area.links.map(link => (
                    <Link key={link.to} to={link.to} className="group flex min-h-11 items-center justify-between gap-3 rounded-kova-md px-2 py-2 text-sm text-kova-muted transition-colors hover:bg-kova-mist hover:text-kova-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue">
                      <span>{link.label}</span>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-kova-tertiary transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
                    </Link>
                  ))}
                </nav>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
