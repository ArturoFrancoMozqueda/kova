import { CalendarDays } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useOperationsPanel } from "@/automations/useOperationsPanel";
import type { WorkspaceIdentity } from "@/automations/workspace";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { ViewError, ViewEmpty } from "@/components/ui/view-states";
import { SectionSkeleton } from "@/components/ui/section-skeleton";
import { formatAppointmentTime } from "./timezone";
import type { AppointmentResource } from "./types";
import type {
  TableReservation,
  TableDetail,
  TableStatus,
} from "./bookingTypes";
import { tableStatusText } from "@/bookings/tableStatus";

type Rows = { items: TableReservation[]; has_more: boolean };
export function TableReservations({
  identity,
  revision,
}: {
  identity: WorkspaceIdentity;
  revision: number;
}) {
  const [status, setStatus] = useState<TableStatus | "">("requested");
  const [offset, setOffset] = useState(0);
  const [, setParams] = useSearchParams();
  const panel = useOperationsPanel<Rows>(
    "/api/v1/appointments/table-reservations",
    identity,
    `?limit=50&offset=${offset}&revision=${revision}${status ? `&status=${status}` : ""}`,
  );
  return (
    <section
      aria-label="Solicitudes y reservas de mesas"
      className="space-y-4 rounded-2xl border border-kova-border bg-white p-5"
    >
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">
            Mesas: solicitudes y llegadas
          </h2>
          <p className="mt-1 text-sm text-kova-muted">
            Revisa cada solicitud y confirma una mesa. El equipo libera la mesa
            cuando el cliente se retira.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={panel.loading || !panel.online}
          onClick={() => void panel.load()}
        >
          Actualizar solicitudes
        </Button>
      </div>
      <div className="max-w-sm space-y-1">
        <Label htmlFor="table-request-status">Estado de las mesas</Label>
        <Select
          id="table-request-status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as TableStatus | "");
            setOffset(0);
          }}
        >
          <option value="">Todos los estados</option>
          {Object.entries(tableStatusText).map(([v, label]) => (
            <option value={v} key={v}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      {panel.error && (
        <ViewError
          retryLabel="Volver a consultar"
          message={panel.error}
          onRetry={() => void panel.load()}
        />
      )}
      {panel.loading && (
        <SectionSkeleton
          label="Consultando solicitudes de mesa…"
          variant="list"
        />
      )}
      {!panel.loading && !panel.error && panel.data?.items.length === 0 && (
        <ViewEmpty
          icon={<CalendarDays className="h-6 w-6" aria-hidden="true" />}
          title="No hay solicitudes con este estado."
          body="Las solicitudes del enlace público aparecerán aquí para que el equipo las revise."
        />
      )}
      <ul className="grid gap-3 md:grid-cols-2">
        {panel.data?.items.map((row) => (
          <li
            key={row.id}
            className="min-w-0 space-y-2 rounded-xl border border-kova-border p-4"
          >
            <h3 className="break-words font-semibold">{row.name}</h3>
            <p className="text-sm">
              {formatAppointmentTime(row.starts_at, row.timezone)} ·{" "}
              {row.party_size} personas
            </p>
            <p className="text-sm text-kova-muted">
              {tableStatusText[row.status]}
              {row.resource_name ? ` · ${row.resource_name}` : ""}
            </p>
            <Button
              variant="outline"
              onClick={() =>
                setParams((p) => {
                  const n = new URLSearchParams(p);
                  n.delete("appointmentId");
                  n.delete("bookingId");
                  n.set("tableId", row.id);
                  return n;
                })
              }
            >
              Revisar solicitud de {row.name}
            </Button>
          </li>
        ))}
      </ul>
      <nav aria-label="Páginas de solicitudes de mesa" className="flex gap-2">
        <Button
          variant="outline"
          disabled={panel.loading || offset === 0}
          onClick={() => setOffset((v) => Math.max(0, v - 50))}
        >
          Anteriores
        </Button>
        <Button
          variant="outline"
          disabled={panel.loading || !panel.data?.has_more}
          onClick={() => setOffset((v) => v + 50)}
        >
          Siguientes
        </Button>
      </nav>
    </section>
  );
}

function ReviewTable({
  identity,
  reservationId,
  resourceId,
  onReady,
}: {
  identity: WorkspaceIdentity;
  reservationId: string;
  resourceId: string;
  onReady: (ready: boolean) => void;
}) {
  const review = useOperationsPanel<Rows>(
    `/api/v1/appointments/table-reservations/${reservationId}/review`,
    identity,
    `?resource_id=${encodeURIComponent(resourceId)}`,
  );
  useEffect(() => {
    onReady(!review.loading && !review.error && Boolean(review.data));
    return () => onReady(false);
  }, [onReady, review.loading, review.error, review.data]);
  return (
    <section
      aria-label="Reservas de la mesa elegida"
      className="space-y-2 rounded-xl bg-kova-mist p-4"
    >
      <h3 className="font-semibold">Revisa esta mesa antes de confirmar</h3>
      <p className="text-sm text-kova-muted">
        Se muestran sus llegadas confirmadas de ese día y cualquier visita que
        siga ocupando la mesa. Sin una hora de salida, el equipo decide si puede
        recibir otra reserva.
      </p>
      {review.loading && (
        <SectionSkeleton
          label="Consultando reservas de esta mesa…"
          variant="list"
        />
      )}
      {review.error && (
        <ViewError
          retryLabel="Volver a consultar"
          message={review.error}
          onRetry={() => void review.load()}
        />
      )}
      {!review.loading && !review.error && review.data?.items.length === 0 && (
        <p className="text-sm">
          No hay otras llegadas confirmadas ni visitas ocupando esta mesa en
          esta consulta.
        </p>
      )}
      <ul className="space-y-2">
        {review.data?.items.map((r) => (
          <li key={r.id} className="text-sm">
            {formatAppointmentTime(r.starts_at, r.timezone)} · {r.name} ·{" "}
            {tableStatusText[r.status]}
          </li>
        ))}
      </ul>
      {review.data?.has_more && (
        <p role="status" className="text-sm">
          Hay más reservas de esta mesa. Revisa el día completo en Agenda antes
          de confirmar.
        </p>
      )}
    </section>
  );
}

export function TableReservationDetail({
  identity,
  reservationId,
  resources,
  onClose,
  onSaved,
}: {
  identity: WorkspaceIdentity;
  reservationId: string;
  resources: AppointmentResource[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const panel = useOperationsPanel<TableDetail>(
    `/api/v1/appointments/table-reservations/${reservationId}`,
    identity,
  );
  const [tableId, setTableId] = useState("");
  const [reviewReady, setReviewReady] = useState(false);
  const row = panel.data;
  const act = async (action: string) => {
    if (!row) return;
    if (
      await panel.mutate(
        "/action",
        "POST",
        {
          expected_version: row.version,
          action,
          ...(action === "confirm" ? { resource_id: tableId } : {}),
        },
        action === "confirm"
          ? "Reserva confirmada. Contacta al cliente para avisarle; no se envió un mensaje automático."
          : action === "release"
            ? "Mesa liberada. La visita terminó; no se registró ningún cobro."
            : "Estado de la reserva actualizado.",
      )
    )
      onSaved();
  };
  return (
    <Dialog open onClose={onClose} className="space-y-4 sm:max-w-2xl">
      <DialogTitle>Solicitud de mesa</DialogTitle>
      {panel.loading && !row && (
        <SectionSkeleton
          label="Consultando solicitud de mesa…"
          variant="summary"
        />
      )}
      {panel.error && (
        <ViewError
          retryLabel="Volver a consultar"
          message={panel.error}
          onRetry={() => void panel.load()}
        />
      )}
      {panel.notice && (
        <p role="status" className="text-sm">
          {panel.notice}
        </p>
      )}
      {row && (
        <>
          <section
            className="space-y-2"
            aria-label="Detalle de solicitud de mesa"
          >
            <h2 className="break-words text-xl font-semibold">{row.name}</h2>
            <p>{row.phone}</p>
            <p>
              {formatAppointmentTime(row.starts_at, row.timezone)} ·{" "}
              {row.party_size} personas
            </p>
            <p className="font-medium">{tableStatusText[row.status]}</p>
            {row.resource_name && <p>Mesa asignada: {row.resource_name}</p>}
            <p className="text-sm text-kova-muted">
              Sólo se registra la llegada. La salida se registra cuando el
              equipo libera la mesa. El cobro se realiza por separado en Caja.
            </p>
          </section>
          {row.status === "requested" && (
            <section className="space-y-3">
              <Label htmlFor="table-confirm-resource">
                Mesa para esta reserva
              </Label>
              <Select
                id="table-confirm-resource"
                value={tableId}
                disabled={panel.busy}
                onChange={(e) => {
                  setReviewReady(false);
                  setTableId(e.target.value);
                }}
              >
                <option value="">Elige una mesa</option>
                {resources
                  .filter(
                    (r) =>
                      r.kind === "table" &&
                      r.is_active &&
                      r.timezone === row.timezone,
                  )
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </Select>
              {tableId && (
                <ReviewTable
                  key={tableId}
                  identity={identity}
                  reservationId={row.id}
                  resourceId={tableId}
                  onReady={setReviewReady}
                />
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={
                    !tableId || !reviewReady || panel.busy || !panel.online
                  }
                  onClick={() => void act("confirm")}
                >
                  Confirmar esta mesa
                </Button>
                <Button
                  variant="outline"
                  disabled={panel.busy || !panel.online}
                  onClick={() => void act("decline")}
                >
                  No puedo confirmar esta solicitud
                </Button>
              </div>
            </section>
          )}
          <div className="flex flex-wrap gap-2">
            {row.status === "confirmed" && (
              <>
                <Button
                  disabled={
                    panel.busy ||
                    !panel.online ||
                    new Date(row.starts_at).getTime() > Date.now()
                  }
                  onClick={() => void act("seat")}
                >
                  Registrar llegada y ocupar mesa
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    panel.busy ||
                    !panel.online ||
                    new Date(row.starts_at).getTime() > Date.now()
                  }
                  onClick={() => void act("no_show")}
                >
                  Registrar que no se presentó
                </Button>
              </>
            )}
            {row.status === "seated" && (
              <Button
                disabled={panel.busy || !panel.online}
                onClick={() => void act("release")}
              >
                El cliente se retiró: liberar mesa
              </Button>
            )}
            {["requested", "confirmed"].includes(row.status) && (
              <Button
                variant="outline"
                disabled={panel.busy || !panel.online}
                onClick={() => void act("cancel")}
              >
                Cancelar esta reserva
              </Button>
            )}
          </div>
          <details>
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">
              Historial de la solicitud
            </summary>
            <ul className="space-y-2">
              {row.history.map((h, i) => (
                <li key={i} className="text-sm">
                  {tableStatusText[h.status]} ·{" "}
                  {new Date(h.created_at).toLocaleString("es-MX")}
                  {h.action === "reschedule"
                    ? " · Nueva hora solicitada"
                    : h.action === "revoke"
                      ? " · Acceso privado revocado"
                      : ""}
                </li>
              ))}
            </ul>
          </details>
          <Button
            variant="ghost"
            disabled={panel.busy || !panel.online}
            onClick={() => void act("revoke")}
          >
            Revocar enlace privado
          </Button>
        </>
      )}
    </Dialog>
  );
}
