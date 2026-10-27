import { resolveUserFacingError } from "@/lib/apiError";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  ClipboardCheck,
  Handshake,
  LifeBuoy,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  OperationsSession,
  useOnline,
  useOperationsRequest,
  type WorkspaceIdentity,
} from "@/automations/workspace";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewError } from "@/components/ui/view-states";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { isRecordId } from "./useLinkedRecord";
import type {
  OperationsQueueData,
  OperationsQueueSection,
  OperationsQueueSource,
} from "./types";

const sources = [
  {
    source: "service_cases",
    parameter: "case_id",
    title: "Atención postventa",
    description: "Atenciones abiertas que requieren seguimiento del equipo.",
    empty: "No hay atenciones activas en esta consulta.",
    path: "/service-cases",
    icon: LifeBuoy,
  },
  {
    source: "opportunities",
    parameter: "opportunity_id",
    title: "Oportunidades comerciales",
    description: "Oportunidades abiertas con una próxima acción registrada.",
    empty: "No hay oportunidades abiertas con una próxima acción registrada.",
    path: "/crm",
    icon: Handshake,
  },
  {
    source: "followups",
    parameter: "task_id",
    title: "Seguimiento de clientes",
    description: "Tareas internas de postventa, recompra e incidencias.",
    empty: "No hay tareas de seguimiento pendientes en esta consulta.",
    path: "/followups",
    icon: ClipboardCheck,
  },
  {
    source: "appointment_reminders",
    parameter: "reminder_id",
    title: "Recordatorios de agenda",
    description: "Recordatorios disponibles de citas programadas y vigentes.",
    empty:
      "No hay recordatorios de citas disponibles por revisar en esta consulta.",
    path: "/appointments",
    icon: CalendarDays,
  },
] as const;
const stateLabels: Record<OperationsQueueSource, Record<string, string>> = {
  service_cases: {
    open: "Abierta",
    in_progress: "En atención",
    reopened: "Reabierta",
  },
  opportunities: {
    new: "Nueva",
    contacted: "En contacto",
    proposal: "Propuesta",
  },
  followups: { pending: "Pendiente" },
  appointment_reminders: { pending: "Pendiente de revisión" },
};
const date = (value: string, timezone: string) =>
  new Date(value).toLocaleString("es-MX", { timeZone: timezone });

export default function OperationsQueueView() {
  useDocumentTitle("Pendientes del negocio");
  return (
    <OperationsSession>
      {(identity) => <OperationsQueueWorkspace identity={identity} />}
    </OperationsSession>
  );
}

function OperationsQueueWorkspace({
  identity,
}: {
  identity: WorkspaceIdentity;
}) {
  const request = useOperationsRequest("/api/v1/operations/queue", identity);
  const profileRequest = useOperationsRequest(
    "/api/v1/settings/business-profile",
    identity,
  );
  const online = useOnline();
  const [data, setData] = useState<OperationsQueueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const generation = useRef(0);
  const [timezone, setTimezone] = useState("UTC");
  const [timezoneAvailable, setTimezoneAvailable] = useState(false);
  const load = useCallback(async () => {
    const revision = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const [queue, profile] = await Promise.allSettled([
        request<OperationsQueueData>(),
        profileRequest<{ timezone?: string }>(),
      ]);
      if (queue.status === "rejected") throw queue.reason;
      let resolvedTimezone = "UTC";
      let configured = false;
      if (
        profile.status === "fulfilled" &&
        typeof profile.value.timezone === "string"
      ) {
        try {
          new Intl.DateTimeFormat("es-MX", {
            timeZone: profile.value.timezone,
          }).format(new Date());
          resolvedTimezone = profile.value.timezone;
          configured = true;
        } catch {
          // Invalid configuration uses the visibly identified UTC fallback.
        }
      }
      if (
        alive.current &&
        revision === generation.current &&
        navigator.onLine
      ) {
        setData(queue.value);
        setTimezone(resolvedTimezone);
        setTimezoneAvailable(configured);
      }
    } catch (e) {
      if (
        alive.current &&
        revision === generation.current &&
        !(e instanceof DOMException && e.name === "AbortError")
      )
        setError(
          resolveUserFacingError(e, "No pudimos consultar los pendientes del negocio."),
        );
    } finally {
      if (alive.current && revision === generation.current) setLoading(false);
    }
  }, [request, profileRequest]);
  useEffect(() => {
    alive.current = true;
    if (online) void load();
    else {
      ++generation.current;
      setData(null);
      setError("");
      setLoading(false);
    }
    return () => {
      alive.current = false;
    };
  }, [load, online]);
  return (
    <ViewLayout className="space-y-6">
      <ViewHeader
        eyebrow="Operación del negocio"
        title="Pendientes del negocio"
        meta="Consulta en un lugar lo que necesita seguimiento y continúa en el módulo correspondiente."
      />
      <p className="max-w-3xl text-sm text-kova-muted">
        Cada área conserva sus pendientes y estados. Esta consulta es de
        lectura: las acciones se realizan en su módulo de origen.
      </p>
      {!online ? (
        <p
          role="status"
          className="rounded-2xl border border-kova-border bg-white p-6"
        >
          Conéctate para consultar los pendientes actuales. La consulta anterior
          no se muestra sin conexión.
        </p>
      ) : (
        <>
          {error && (
            <ViewError
              message={error}
              onRetry={() => void load()}
              retryLabel="Consultar de nuevo"
            />
          )}
          {loading && (
            <p role="status">
              {data
                ? "Actualizando la consulta de pendientes…"
                : "Consultando pendientes del negocio…"}
            </p>
          )}
          {!loading && !error && data && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-kova-border bg-white p-5">
                <div className="min-w-0 space-y-2">
                  <p className="text-sm font-medium">
                    Consulta del {date(data.generated_at, timezone)}
                  </p>
                  <p className="break-words text-xs text-kova-muted">
                    {timezoneAvailable
                      ? `Fechas en la zona horaria del negocio: ${timezone}.`
                      : "No pudimos confirmar la zona horaria del negocio. Las fechas se muestran en UTC."}{" "}
                    La vista es acotada por área; consulta el módulo para
                    revisar el resto.
                  </p>
                </div>
                <Button
                  className="h-auto min-h-11 whitespace-normal"
                  variant="outline"
                  onClick={() => void load()}
                >
                  Actualizar pendientes
                </Button>
              </div>
              <div className="grid items-start gap-5 xl:grid-cols-2">
                {sources.map((source) => (
                  <QueueSection
                    key={source.source}
                    config={source}
                    timezone={timezone}
                    section={data.sections.find(
                      (section) => section.source === source.source,
                    )}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </ViewLayout>
  );
}

function QueueSection({
  config,
  section,
  timezone,
}: {
  config: (typeof sources)[number];
  section: OperationsQueueSection | undefined;
  timezone: string;
}) {
  const Icon = config.icon;
  return (
    <section
      className="min-w-0 space-y-4 rounded-2xl border border-kova-border bg-white p-5 sm:p-6"
      aria-label={config.title}
    >
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-kova-mist p-3">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">{config.title}</h2>
          <p className="mt-2 text-sm text-kova-muted">{config.description}</p>
        </div>
      </div>
      {!section ? (
        <p role="alert" className="text-sm text-destructive">
          Esta área no apareció en la respuesta. Actualiza la consulta antes de
          continuar.
        </p>
      ) : section.items.length === 0 ? (
        <p className="rounded-xl bg-kova-mist p-4 text-sm text-kova-muted">
          {config.empty}
        </p>
      ) : (
        <ol className="divide-y divide-kova-border">
          {section.items.map((item) => (
            <li key={item.source_id} className="min-w-0 space-y-2 py-4">
              <h3 className="break-words font-semibold">{item.title}</h3>
              {isRecordId(item.source_id) && (
                <Link
                  className="inline-flex min-h-11 items-center break-words text-sm font-medium underline underline-offset-4"
                  to={`${config.path}?${config.parameter}=${item.source_id}`}
                >
                  Abrir registro: {item.title}
                </Link>
              )}
              <p className="break-words text-sm">{item.customer_name}</p>
              <p className="text-xs font-medium text-kova-muted">
                {stateLabels[config.source][item.state] ??
                  "Consulta el estado en el módulo de origen"}
              </p>
              {item.due_at ? (
                <p
                  className={
                    item.overdue
                      ? "text-sm font-medium text-warning-strong"
                      : "text-sm text-kova-muted"
                  }
                >
                  {item.overdue ? "Fecha vencida" : "Fecha de seguimiento"}:{" "}
                  {date(item.due_at, timezone)}
                </p>
              ) : (
                <p className="text-sm text-kova-muted">
                  Sin fecha de seguimiento registrada
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
      {section?.has_more && (
        <p className="text-sm text-kova-muted">
          Hay más pendientes de esta área en su módulo de origen.
        </p>
      )}
      <Link
        className="inline-flex min-h-11 items-center break-words text-sm font-medium underline underline-offset-4"
        to={config.path}
      >
        {section?.has_more
          ? `Consultar el resto en ${config.title}`
          : `Abrir ${config.title}`}
      </Link>
    </section>
  );
}
