import { useAuth } from "@/auth/useAuth";
import { hasPlanFeature } from "@/billing/entitlements";
import { PlanFeatureNotice } from "@/billing/PlanFeatureNotice";
import { SectionSkeleton } from "@/components/ui/section-skeleton";
import { AlertTriangle, CheckCircle2, ClipboardList, Clock, Repeat, Star, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { InitialsAvatar } from "@/components/visual";
import { Link } from "react-router-dom";
import { LinkedRecordNotice } from "@/operationsQueue/LinkedRecordNotice";
import { useLinkedRecord } from "@/operationsQueue/useLinkedRecord";
import { useId, useEffect, useState } from "react";
import {
  OperationsSession,
  type WorkspaceIdentity,
} from "@/automations/workspace";
import { useOperationsPanel } from "@/automations/useOperationsPanel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewEmpty, ViewError } from "@/components/ui/view-states";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

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
const kindIcons = { review: Star, rebuy: Repeat, incident: AlertTriangle };
const statusChips = {
  pending: { icon: Clock, variant: "warning" },
  completed: { icon: CheckCircle2, variant: "success" },
  dismissed: { icon: XCircle, variant: "secondary" },
} as const;
const fieldClass = "mt-1 min-w-0";
export default function FollowupsView() {
  useDocumentTitle("Seguimiento después de la venta");
  const { state } = useAuth();
  return (
    <OperationsSession>
      {(identity) => <FollowupsWorkspace identity={identity} canConfigure={hasPlanFeature(state.status === "authenticated" ? state.commercialAccess : undefined, "customer_orders")} />}
    </OperationsSession>
  );
}
function FollowupsWorkspace({ identity, canConfigure }: { identity: WorkspaceIdentity; canConfigure: boolean }) {
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
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [selected, setSelected] = useState<Task | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  useEffect(() => {
    setSelected(null);
    setResolutionNote("");
  }, [linked.id]);
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
      {!canConfigure && <PlanFeatureNotice />}
      <ViewHeader
        eyebrow="Relación con clientes"
        title="Seguimiento después de la venta"
        meta="Revisa a quién contactar después de una compra: una opinión, una próxima visita o un pendiente."
        actions={panel.data ? panel.online ? (
          <Link className={buttonVariants({ className: "h-auto min-h-11 whitespace-normal" })} to="/service-cases?new=1">
            Registrar incidencia
          </Link>
        ) : <Button disabled>Registrar incidencia</Button> : undefined}
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
      {panel.loading && <SectionSkeleton label="Cargando seguimiento…" />}
      {canConfigure && policy && (
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
      <section className="space-y-4" aria-label="Pendientes de postventa">
        <h2 className="text-xl font-semibold">Pendientes del equipo</h2>
        {!panel.loading && !panel.error && panel.data?.tasks.length === 0 && (
          <ViewEmpty illustration="people"
            icon={<ClipboardList className="h-6 w-6" aria-hidden="true" />}
            title="No hay tareas de postventa en esta página."
            body="Activa la regla cuando estés listo. Registra nuevas incidencias en Casos de atención."
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
      {panel.data && (
        <details className="space-y-4 rounded-2xl border border-kova-border bg-white p-6">
          <summary className="min-h-11 cursor-pointer font-semibold">Configurar tareas después de una venta</summary>
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
              disabled={panel.busy || !canConfigure}
              onClick={() => setPolicy({ ...panel.data!.policy })}
            >
              Revisar regla
            </Button>
            <Button
              className="h-auto min-h-11 whitespace-normal text-left"
              variant="outline"
              disabled={
                panel.busy || !panel.online || !canConfigure || !panel.data.policy.enabled
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
        </details>
      )}
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
      <FollowupChips row={row} />
      <h3 className="break-words font-semibold">{row.title}</h3>
      <p className="flex min-w-0 items-center gap-2 text-sm">
        <InitialsAvatar name={row.customer_name} size="sm" />
        <span className="min-w-0 break-words">{row.customer_name}</span>
      </p>
      {row.note && (
        <p className="whitespace-pre-wrap break-words text-sm text-kova-muted">
          {row.note}
        </p>
      )}
      <p className="text-sm">
        Seguimiento: {new Date(row.due_at).toLocaleString("es-MX")}
      </p>
      {online && (
        <nav className="flex flex-wrap gap-2" aria-label={`Registros relacionados con ${row.title}`}>
          <Link
            className={buttonVariants({ variant: "outline", size: "sm", className: "min-h-11" })}
            to={`/customers?customerId=${encodeURIComponent(row.customer_id)}`}
          >
            Ver cliente
          </Link>
          <Link
            className={buttonVariants({ variant: "outline", size: "sm", className: "min-h-11" })}
            to={`/service-cases?new=1&followup_id=${encodeURIComponent(row.id)}`}
          >
            Abrir atención postventa
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

function FollowupChips({ row }: { row: Task }) {
  const KindIcon = kindIcons[row.kind];
  const status = statusChips[row.status];
  const StatusIcon = status.icon;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-kova-muted">
      <span className="inline-flex items-center gap-1">
        <KindIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {kinds[row.kind]}
      </span>
      <Badge variant={status.variant} className="gap-1">
        <StatusIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
        {statuses[row.status]}
      </Badge>
    </div>
  );
}
