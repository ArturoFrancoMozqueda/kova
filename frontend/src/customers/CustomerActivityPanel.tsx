import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { customerActivity, type CustomerActivity, type CustomerActivitySource } from "./api";

const sources: Record<CustomerActivitySource, { title: string; href: (id: string) => string }> = {
  appointments: { title: "Citas", href: (id) => `/appointments?appointmentId=${encodeURIComponent(id)}` },
  customer_orders: { title: "Pedidos", href: (id) => `/pedidos/${encodeURIComponent(id)}` },
  opportunities: { title: "Seguimiento comercial", href: (id) => `/crm?opportunity_id=${encodeURIComponent(id)}` },
  followups: { title: "Postventa", href: (id) => `/followups?task_id=${encodeURIComponent(id)}` },
  service_cases: { title: "Casos de atención", href: (id) => `/service-cases?case_id=${encodeURIComponent(id)}` },
};
const states: Record<string, string> = {
  scheduled: "Programada", cancelled: "Cancelada", completed: "Completada", no_show: "No asistió",
  new: "Nueva", contacted: "Contactado", proposal: "Propuesta", won: "Ganada", lost: "Perdida",
  pending: "Pendiente", dismissed: "Descartada", open: "Abierto", in_progress: "En atención",
  resolved: "Resuelto", reopened: "Reabierto",
  confirmed: "Confirmado", ready: "Listo", fulfilled: "Entregado",
};

type ActivitySection = CustomerActivity["sections"][number];

function activityState(source: CustomerActivitySource, state: string) {
  if (source === "appointments" && state === "completed") return "Atendida";
  if (source === "customer_orders" && state === "new") return "Nuevo";
  if (source === "customer_orders" && state === "in_progress") return "En preparación";
  return states[state] ?? "Consultar estado";
}

function ActivitySource({ section }: { section: ActivitySection }) {
  const [expanded, setExpanded] = useState(false);
  const source = sources[section.source];
  const items = expanded ? section.items : section.items.slice(0, 3);
  return (
    <div className="min-w-0 rounded-lg border p-4">
      <h4 className="text-sm font-semibold">{source.title}</h4>
      <ul className="mt-2 divide-y">
        {items.map((item) => (
          <li key={item.id} className="py-2">
            <Link to={source.href(item.id)} className="break-words text-sm font-medium text-primary underline underline-offset-4">
              {item.title}
            </Link>
            <p className="text-xs text-muted-foreground">
              {activityState(section.source, item.state)}
              {item.due_at ? ` · ${new Date(item.due_at).toLocaleString("es-MX")}` : ""}
            </p>
          </li>
        ))}
      </ul>
      {section.items.length > 3 && (
        <Button type="button" variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Mostrar menos" : "Ver más"} · {source.title}
        </Button>
      )}
      {section.has_more && <p className="mt-2 text-xs text-muted-foreground">La consulta incluye los 10 más recientes. Hay más registros en el módulo correspondiente.</p>}
    </div>
  );
}

export function CustomerActivityPanel({ customerId }: { customerId: string }) {
  const [data, setData] = useState<CustomerActivity | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setData(null);
    setError("");
    void customerActivity(customerId, { signal: controller.signal })
      .then((result) => { if (active) setData(result); })
      .catch(() => { if (active) setError("No pudimos cargar la actividad del cliente en esta sucursal."); });
    return () => { active = false; controller.abort(); };
  }, [customerId, revision]);
  const sections = data?.sections.filter((section) => section.items.length > 0) ?? [];
  return (
    <section aria-label="Actividad del cliente" className="space-y-4 border-t pt-4">
      <div>
        <h3 className="font-semibold">Atención y seguimiento</h3>
        <p className="text-sm text-muted-foreground">Registros recientes de la sucursal seleccionada. Incluye pendientes y terminados.</p>
        <p className="text-xs text-muted-foreground">Fechas en la zona de este dispositivo: {Intl.DateTimeFormat().resolvedOptions().timeZone}.</p>
      </div>
      {error ? (
        <div>
          <p role="alert" className="text-sm text-destructive-strong">{error}</p>
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setRevision((value) => value + 1)}>Reintentar actividad</Button>
        </div>
      ) : !data ? (
        <p role="status" className="text-sm text-muted-foreground">Cargando actividad…</p>
      ) : sections.length === 0 ? (
        <p className="text-sm text-muted-foreground">Este cliente aún no tiene actividad de atención o seguimiento en esta sucursal.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sections.map((section) => <ActivitySource key={section.source} section={section} />)}
        </div>
      )}
    </section>
  );
}
