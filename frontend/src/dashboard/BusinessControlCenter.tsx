import { Link } from "react-router-dom";
import { ArrowUpRight, CalendarDays, ChartNoAxesCombined, Package, Settings2, ShoppingBag, Users } from "lucide-react";
import type { WorkspaceNavigationContext } from "@/layout/workspaceNavigation";
import { cn } from "@/lib/utils";

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

/** Navigation reuses the shell's allowed destinations. Counts are shown only
 * for a verified overview; linked modules never imply zero pending work. */
export function BusinessControlCenter({ destinations, snapshot }: WorkspaceNavigationContext & { snapshot: Snapshot | null }) {
  const visibleAreas = areas.flatMap(area => {
    const links = area.paths.flatMap(path => destinations.filter(destination => destination.to === path));
    return links.length > 0 ? [{ ...area, links }] : [];
  });
  if (visibleAreas.length === 0) return null;

  return (
    <section aria-labelledby="business-control-title" className="mb-8 scroll-mt-4" id="business-control">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-kova-blue">Todo tu negocio</p>
          <h2 id="business-control-title" className="text-xl font-semibold tracking-tight text-kova-ink">Cada área, a la vista</h2>
          <p className="mt-1 max-w-2xl text-sm text-kova-muted">Entra a cada área para consultar su estado y dar el siguiente paso.</p>
        </div>
        <p className="text-xs text-kova-muted">Los pendientes y conexiones se consultan en su sección.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleAreas.map(area => {
          const Icon = area.icon;
          const needsStock = area.id === "products" && snapshot !== null && snapshot.lowStockCount > 0;
          const hasMetric = snapshot !== null && (area.id === "sales" || area.id === "products");
          return (
            <article key={area.id} aria-labelledby={`control-${area.id}`} className="flex min-w-0 flex-col overflow-hidden rounded-kova-xl border border-kova-border bg-white shadow-kova-card">
              <div className={cn("h-1", needsStock ? "bg-warning" : "bg-kova-blue/30")} />
              <div className="flex flex-1 flex-col p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <span className={cn("flex h-10 w-10 items-center justify-center rounded-kova-lg", needsStock ? "bg-warning/10 text-warning-strong" : "bg-kova-mist text-kova-blue")}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", needsStock ? "bg-warning/10 text-warning-foreground" : "bg-kova-mist text-kova-muted")}>
                    {hasMetric ? area.id === "sales" ? "Periodo seleccionado" : "Inventario actual" : "Consultar"}
                  </span>
                </div>
                <h3 id={`control-${area.id}`} className="text-base font-semibold tracking-tight">{area.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-kova-muted">{area.description}</p>
                <p className={cn("my-4 text-sm font-semibold", needsStock ? "text-warning-foreground" : "text-kova-ink")}>
                  {snapshot && area.id === "sales"
                    ? `${snapshot.orderCount} ${snapshot.orderCount === 1 ? "orden completada" : "órdenes completadas"}`
                    : snapshot && area.id === "products"
                      ? needsStock
                        ? `${snapshot.lowStockCount} ${snapshot.lowStockCount === 1 ? "producto por reponer" : "productos por reponer"}`
                        : `${snapshot.activeCatalogCount} ${snapshot.activeCatalogCount === 1 ? "producto activo" : "productos activos"}`
                      : area.prompt}
                </p>
                <nav aria-label={area.title} className="mt-auto grid grid-cols-2 gap-x-2 border-t border-kova-border pt-2">
                  {area.links.map(link => (
                    <Link key={link.to} to={link.to} className="group flex min-h-11 items-center justify-between gap-3 rounded-kova-md px-2 py-2 text-sm text-kova-muted transition-colors hover:bg-kova-mist hover:text-kova-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue">
                      <span>{link.label}</span>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-kova-tertiary transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
                    </Link>
                  ))}
                </nav>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
