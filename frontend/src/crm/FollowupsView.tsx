import { ClipboardList } from "lucide-react";
import { Link } from "react-router-dom";
import { LinkedRecordNotice } from "@/operationsQueue/LinkedRecordNotice";
import { useLinkedRecord } from "@/operationsQueue/useLinkedRecord";
import { useId, useEffect, useState, type FormEvent } from "react";
import {
  OperationsSession,
  type WorkspaceIdentity,
} from "@/automations/workspace";
import { useOperationsPanel } from "@/automations/useOperationsPanel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewEmpty, ViewError } from "@/components/ui/view-states";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import type { Customer } from "@/customers/api";

type Policy = {
  enabled: boolean;
  review_delay_days: number;
  rebuy_delay_days: number;
  version: number;
};
type Task = {
  id: string;
  customer_id: string;
  customer_name: string;
  sale_order_id: string | null;
  kind: "review" | "rebuy" | "incident";
  status: "pending" | "completed" | "dismissed";
  title: string;
  note: string | null;
  due_at: string;
  version: number;
};
type Followups = { policy: Policy; tasks: Task[]; has_more: boolean };
const kinds = {
  review: "Solicitud neutral de reseña",
  rebuy: "Seguimiento de recompra",
  incident: "Incidencia",
};
const statuses = {
  pending: "Pendiente",
  completed: "Completada",
  dismissed: "Descartada",
};
const fieldClass = "mt-1 min-w-0";
export default function FollowupsView() {
  useDocumentTitle("Postventa y seguimiento");
  return (
    <OperationsSession>
      {(identity) => <FollowupsWorkspace identity={identity} />}
    </OperationsSession>
  );
}
function FollowupsWorkspace({ identity }: { identity: WorkspaceIdentity }) {
  const fieldId = useId();
  const linked = useLinkedRecord<Task>(
    identity,
    "task_id",
    "/api/v1/crm/followups",
  );
  const [offset, setOffset] = useState(0);
  const panel = useOperationsPanel<Followups>(
    "/api/v1",
    identity,
    `/crm/followups?limit=50&offset=${offset}`,
  );
  const { request } = panel;
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [customerError, setCustomerError] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [selected, setSelected] = useState<Task | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  useEffect(() => {
    setSelected(null);
    setResolutionNote("");
  }, [linked.id]);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void request<Customer[]>(`/customers?q=${encodeURIComponent(search)}`)
        .then((rows) => {
          if (active) {
            setCustomers(rows);
            setCustomerError("");
          }
        })
        .catch(() => {
          if (active)
            setCustomerError(
              "No pudimos buscar clientes. Cambia la búsqueda para reintentar.",
            );
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [request, search]);
  const createIncident = async (event: FormEvent) => {
    event.preventDefault();
    if (
      await panel.mutate(
        "/crm/followups",
        "POST",
        {
          customer_id: customerId,
          title: title.trim(),
          note: note.trim() || null,
          due_at: new Date(dueAt).toISOString(),
        },
        "Incidencia registrada para seguimiento interno.",
      )
    ) {
      setIncidentOpen(false);
      setTitle("");
      setNote("");
      setCustomerId("");
      setDueAt("");
    }
  };
  const review = (row: Task) => {
    setSelected(row);
    setResolutionNote(row.note ?? "");
  };
  const resolve = async (status: "completed" | "dismissed") => {
    if (!selected) return;
    if (
      await panel.mutate(
        `/crm/followups/${selected.id}`,
        "PATCH",
        {
          expected_version: selected.version,
          status,
          note: resolutionNote.trim() || null,
        },
        status === "completed"
          ? "Tarea completada por el equipo. Esto no acredita un envío ni una recompra."
          : "Tarea descartada.",
      )
    ) {
      setSelected(null);
    }
    if (linked.requested) {
      setSelected(null);
      linked.reload();
    }
  };
  return (
    <ViewLayout className="space-y-6">
      <ViewHeader
        eyebrow="Relación con clientes"
        title="Postventa y seguimiento"
        meta="Organiza reseñas, recompra e incidencias a partir de ventas reales."
        actions={panel.data ? (
          <Button
            className="h-auto min-h-11 whitespace-normal"
            disabled={panel.busy || !panel.online}
            aria-expanded={incidentOpen}
            aria-controls="followup-incident-form"
            onClick={() => setIncidentOpen((value) => !value)}
          >
            Registrar incidencia
          </Button>
        ) : undefined}
      />
      <p className="max-w-3xl text-sm text-kova-muted">
        Las reglas crean pendientes internos. El equipo revisa el consentimiento
        antes de contactar; completar una tarea no confirma entrega de mensajes
        ni ingresos.
      </p>
      <LinkedRecordNotice linked={linked}>
        {linked.record && (
          <FollowupCard
            row={linked.record}
            busy={panel.busy}
            online={panel.online}
            onReview={review}
          />
        )}
      </LinkedRecordNotice>
      {panel.error && (
        <ViewError
          message={panel.error}
          onRetry={() => void panel.load()}
          retryLabel="Volver a cargar"
        />
      )}
      {panel.notice && (
        <p role="status" className="rounded-xl bg-kova-mist p-4">
          {panel.notice}
        </p>
      )}
      {panel.loading && <p role="status">Cargando seguimiento…</p>}
      {panel.data && (
        <section className="space-y-4 rounded-2xl border border-kova-border bg-white p-6">
          <h2 className="text-xl font-semibold">Regla de postventa</h2>
          <p className="text-sm">
            {panel.data.policy.enabled
              ? "Activa para generar pendientes"
              : "Desactivada"}
            . Sólo considera ventas elegibles desde su activación.
          </p>
          <p className="text-sm text-kova-muted">
            Se solicita una opinión de manera neutral. Registrar una incidencia
            no bloquea ni condiciona la solicitud de reseña.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              className="h-auto min-h-11 whitespace-normal text-left"
              variant="outline"
              disabled={panel.busy}
              onClick={() => setPolicy({ ...panel.data!.policy })}
            >
              Revisar regla
            </Button>
            <Button
              className="h-auto min-h-11 whitespace-normal text-left"
              variant="outline"
              disabled={
                panel.busy || !panel.online || !panel.data.policy.enabled
              }
              onClick={() =>
                void panel.mutate(
                  "/crm/followups/process",
                  "POST",
                  {},
                  "Se revisaron las ventas elegibles; los pendientes nuevos aparecen abajo.",
                )
              }
            >
              Generar pendientes
            </Button>
          </div>
        </section>
      )}
      {policy && (
        <form
          className="space-y-4 rounded-2xl border border-kova-border bg-white p-6"
          onSubmit={(event) => {
            event.preventDefault();
            void panel
              .mutate(
                "/crm/followups/policy",
                "PUT",
                {
                  expected_version: policy.version,
                  enabled: policy.enabled,
                  review_delay_days: policy.review_delay_days,
                  rebuy_delay_days: policy.rebuy_delay_days,
                },
                "Regla de seguimiento actualizada.",
              )
              .then((ok) => {
                if (ok) setPolicy(null);
              });
          }}
        >
          <h2 className="text-xl font-semibold">
            Confirmar regla de postventa
          </h2>
          <Label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={policy.enabled}
              onChange={(event) =>
                setPolicy({ ...policy, enabled: event.target.checked })
              }
            />
            Crear pendientes a partir de ventas reales
          </Label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Label htmlFor={`${fieldId}-1`} className="text-sm">
              Días para solicitar opinión
              <Input id={`${fieldId}-1`}
                className={fieldClass}
                type="number"
                min="1"
                max="30"
                required
                value={policy.review_delay_days}
                onChange={(event) =>
                  setPolicy({
                    ...policy,
                    review_delay_days: Number(event.target.value),
                  })
                }
              />
            </Label>
            <Label htmlFor={`${fieldId}-2`} className="text-sm">
              Días para revisar recompra
              <Input id={`${fieldId}-2`}
                className={fieldClass}
                type="number"
                min="2"
                max="365"
                required
                value={policy.rebuy_delay_days}
                onChange={(event) =>
                  setPolicy({
                    ...policy,
                    rebuy_delay_days: Number(event.target.value),
                  })
                }
              />
            </Label>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              className="h-auto min-h-11 whitespace-normal text-left"
              disabled={panel.busy || !panel.online}
            >
              Confirmar regla
            </Button>
            <Button
              className="h-auto min-h-11 whitespace-normal text-left"
              type="button"
              variant="ghost"
              onClick={() => setPolicy(null)}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}
      {incidentOpen && (
        <form
          id="followup-incident-form"
          className="space-y-4 rounded-2xl border border-kova-border bg-white p-6"
          onSubmit={(event) => void createIncident(event)}
        >
          <h2 className="text-xl font-semibold">Nueva incidencia</h2>
          <Label htmlFor={`${fieldId}-3`} className="block text-sm">
            Buscar cliente
            <Input id={`${fieldId}-3`}
              className={fieldClass}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Label>
          {customerError && <p role="alert">{customerError}</p>}
          <Label htmlFor={`${fieldId}-4`} className="block text-sm">
            Cliente de la incidencia
            <Select id={`${fieldId}-4`}
              className={fieldClass}
              required
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
            >
              <option value="">Selecciona un cliente</option>
              {customers.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </Select>
          </Label>
          <Label htmlFor={`${fieldId}-5`} className="block text-sm">
            Asunto de la incidencia
            <Input id={`${fieldId}-5`}
              className={fieldClass}
              required
              maxLength={160}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Label>
          <Label htmlFor={`${fieldId}-6`} className="block text-sm">
            Nota interna
            <Textarea id={`${fieldId}-6`}
              className={fieldClass}
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Label>
          <Label htmlFor={`${fieldId}-7`} className="block text-sm">
            Fecha de seguimiento
            <Input id={`${fieldId}-7`}
              className={fieldClass}
              type="datetime-local"
              required
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </Label>
          <div className="flex flex-wrap gap-3">
            <Button
              className="h-auto min-h-11 whitespace-normal text-left"
              disabled={
                !customerId ||
                !title.trim() ||
                !dueAt ||
                panel.busy ||
                !panel.online
              }
            >
              Guardar incidencia
            </Button>
            <Button
              className="h-auto min-h-11 whitespace-normal text-left"
              type="button"
              variant="ghost"
              onClick={() => setIncidentOpen(false)}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}
      <section className="space-y-4" aria-label="Pendientes de postventa">
        <h2 className="text-xl font-semibold">Pendientes del equipo</h2>
        {!panel.loading && !panel.error && panel.data?.tasks.length === 0 && (
          <ViewEmpty
            icon={<ClipboardList className="h-6 w-6" aria-hidden="true" />}
            title="No hay tareas de postventa en esta página."
            body="Activa la regla cuando estés listo o registra una incidencia."
          />
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          {panel.data?.tasks
            .filter((row) => row.id !== linked.record?.id)
            .map((row) => (
              <FollowupCard
                key={row.id}
                row={row}
                busy={panel.busy}
                online={panel.online}
                onReview={review}
              />
            ))}
        </div>
      </section>
      {selected && (
        <section
          className="space-y-4 rounded-2xl border border-kova-border bg-white p-6"
          aria-label="Resolver seguimiento"
        >
          <h2 className="text-xl font-semibold">Resolver: {selected.title}</h2>
          <Label htmlFor={`${fieldId}-8`} className="block text-sm">
            Resultado interno
            <Textarea id={`${fieldId}-8`}
              className={fieldClass}
              maxLength={1000}
              value={resolutionNote}
              onChange={(event) => setResolutionNote(event.target.value)}
            />
          </Label>
          <div className="flex flex-wrap gap-3">
            <Button
              className="h-auto min-h-11 whitespace-normal text-left"
              disabled={panel.busy || !panel.online}
              onClick={() => void resolve("completed")}
            >
              Confirmar tarea completada
            </Button>
            <Button
              className="h-auto min-h-11 whitespace-normal text-left"
              variant="outline"
              disabled={panel.busy || !panel.online}
              onClick={() => void resolve("dismissed")}
            >
              Confirmar descarte
            </Button>
            <Button
              className="h-auto min-h-11 whitespace-normal text-left"
              variant="ghost"
              disabled={panel.busy}
              onClick={() => setSelected(null)}
            >
              Cerrar
            </Button>
          </div>
        </section>
      )}
      <nav aria-label="Páginas de seguimiento" className="flex flex-wrap gap-3">
        <Button
          className="h-auto min-h-11 whitespace-normal text-left"
          variant="outline"
          disabled={offset === 0 || panel.loading}
          onClick={() => setOffset((value) => Math.max(0, value - 50))}
        >
          Anteriores
        </Button>
        <Button
          className="h-auto min-h-11 whitespace-normal text-left"
          variant="outline"
          disabled={!panel.data?.has_more || panel.loading}
          onClick={() => setOffset((value) => value + 50)}
        >
          Siguientes
        </Button>
      </nav>
    </ViewLayout>
  );
}

function FollowupCard({
  row,
  busy,
  online,
  onReview,
}: {
  row: Task;
  busy: boolean;
  online: boolean;
  onReview: (row: Task) => void;
}) {
  return (
    <article className="min-w-0 space-y-3 rounded-2xl border border-kova-border bg-white p-5">
      <p className="text-xs text-kova-muted">
        {kinds[row.kind]} · {statuses[row.status]}
      </p>
      <h3 className="break-words font-semibold">{row.title}</h3>
      <p className="break-words text-sm">{row.customer_name}</p>
      {row.note && (
        <p className="whitespace-pre-wrap break-words text-sm text-kova-muted">
          {row.note}
        </p>
      )}
      <p className="text-sm">
        Seguimiento: {new Date(row.due_at).toLocaleString("es-MX")}
      </p>
      {row.sale_order_id && (
        <p className="break-all text-xs text-kova-muted">
          Venta de origen: {row.sale_order_id}
        </p>
      )}
      {online && (
        <nav className="flex flex-wrap gap-2" aria-label={`Registros relacionados con ${row.title}`}>
          <Link
            className={buttonVariants({ variant: "outline", size: "sm", className: "min-h-11" })}
            to={`/customers?customerId=${encodeURIComponent(row.customer_id)}`}
          >
            Ver cliente
          </Link>
          {row.sale_order_id && (
            <Link
              className={buttonVariants({ variant: "outline", size: "sm", className: "min-h-11" })}
              to={`/orders/${encodeURIComponent(row.sale_order_id)}`}
            >
              Ver venta
            </Link>
          )}
        </nav>
      )}
      {row.status === "pending" && (
        <Button
          className="h-auto min-h-11 whitespace-normal text-left"
          variant="outline"
          disabled={busy || !online}
          onClick={() => onReview(row)}
        >
          Revisar {row.title}
        </Button>
      )}
    </article>
  );
}
