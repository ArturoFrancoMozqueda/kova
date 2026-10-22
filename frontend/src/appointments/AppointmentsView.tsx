import { LinkedRecordNotice } from "@/operationsQueue/LinkedRecordNotice";
import { useLinkedRecord } from "@/operationsQueue/useLinkedRecord";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  OperationsSession,
  useOperationsRequest,
  type WorkspaceIdentity,
} from "@/automations/workspace";
import { useOperationsPanel } from "@/automations/useOperationsPanel";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewError } from "@/components/ui/view-states";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import type { Customer } from "@/customers/api";
import type {
  Appointment,
  AppointmentPage,
  AppointmentResource,
} from "./types";
import {
  appointmentDateRange,
  appointmentTimezones,
  formatAppointmentTime,
  utcToZonedInput,
  zonedInputToUtc,
} from "./timezone";

const fieldClass =
  "mt-1 min-h-11 w-full rounded-lg border border-input bg-white p-3";
const buttonClass = "h-auto min-h-11 whitespace-normal";
const statuses = {
  scheduled: "Programada",
  cancelled: "Cancelada",
  completed: "Atendida",
  no_show: "No asistió",
};
const zoneLabel = (timezone: string) =>
  appointmentTimezones.find((zone) => zone.value === timezone)?.label ??
  timezone;
export default function AppointmentsView() {
  useDocumentTitle("Agenda del negocio");
  return (
    <OperationsSession>
      {(identity) => <AppointmentsWorkspace identity={identity} />}
    </OperationsSession>
  );
}
function AppointmentsWorkspace({ identity }: { identity: WorkspaceIdentity }) {
  const [reminderRevision, setReminderRevision] = useState(0);
  const [offset, setOffset] = useState(0);
  const [windowStart, setWindowStart] = useState(() =>
    new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
  );
  const [windowEnd, setWindowEnd] = useState(() =>
    new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
  );
  const [filterTimezone, setFilterTimezone] = useState("America/Mexico_City");
  const [rangeError, setRangeError] = useState("");
  const [range, setRange] = useState(() =>
    appointmentDateRange(windowStart, windowEnd, "America/Mexico_City"),
  );
  const panel = useOperationsPanel<AppointmentPage>(
    "/api/v1/appointments",
    identity,
    `?starts_from=${encodeURIComponent(range.start)}&starts_until=${encodeURIComponent(range.end)}&limit=50&offset=${offset}`,
  );
  const { request } = panel;
  const customerRequest = useOperationsRequest("/api/v1/customers", identity);
  const [resources, setResources] = useState<AppointmentResource[]>([]);
  const [resourceRevision, setResourceRevision] = useState(0);
  const [resourceError, setResourceError] = useState("");
  const [resourceOpen, setResourceOpen] = useState(false);
  const [resourceName, setResourceName] = useState("");
  const [resourceTimezone, setResourceTimezone] = useState(
    "America/Mexico_City",
  );
  const [bookingOpen, setBookingOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [resourceId, setResourceId] = useState("");
  const resource = resources.find((row) => row.id === resourceId);
  const formTimezone = editing?.timezone ?? resource?.timezone;
  const [customerId, setCustomerId] = useState("");
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerError, setCustomerError] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [formError, setFormError] = useState("");
  const [historyId, setHistoryId] = useState("");
  const [transition, setTransition] = useState<{
    appointment: Appointment;
    status: "cancelled" | "completed" | "no_show";
  } | null>(null);
  useEffect(() => {
    let active = true;
    void request<{ items: AppointmentResource[] }>("/resources")
      .then((result) => {
        if (active) {
          setResources(result.items);
          setResourceError("");
        }
      })
      .catch((e: unknown) => {
        if (active)
          setResourceError(
            e instanceof Error ? e.message : "No pudimos cargar los recursos.",
          );
      });
    return () => {
      active = false;
    };
  }, [request, resourceRevision]);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void customerRequest<Customer[]>(`?q=${encodeURIComponent(search)}`)
        .then((rows) => {
          if (active) {
            setCustomers(rows);
            setCustomerError("");
          }
        })
        .catch(() => {
          if (active)
            setCustomerError(
              "No pudimos buscar clientes. Modifica la búsqueda para reintentar.",
            );
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [customerRequest, search]);
  const createResource = async (event: FormEvent) => {
    event.preventDefault();
    if (
      await panel.mutate(
        "/resources",
        "POST",
        { name: resourceName.trim(), timezone: resourceTimezone },
        "Recurso creado con su zona horaria.",
      )
    ) {
      setResourceOpen(false);
      setResourceName("");
      setResourceRevision((value) => value + 1);
    }
  };
  const saveBooking = async (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    try {
      if (!formTimezone)
        throw new Error("Elige un recurso y confirma su zona horaria.");
      const start = zonedInputToUtc(startsAt, formTimezone);
      const end = zonedInputToUtc(endsAt, formTimezone);
      if (new Date(end).getTime() - new Date(start).getTime() > 86400000)
        throw new Error("La cita puede durar hasta 24 horas.");
      if (end <= start)
        throw new Error("La hora de fin debe ser posterior al inicio.");
      const body = editing
        ? {
            expected_version: editing.version,
            starts_at: start,
            ends_at: end,
            note: note.trim() || null,
          }
        : {
            resource_id: resourceId,
            customer_id: customerId,
            title: title.trim(),
            starts_at: start,
            ends_at: end,
            note: note.trim() || null,
          };
      if (
        await panel.mutate(
          editing ? `/${editing.id}/reschedule` : "",
          "POST",
          body,
          editing
            ? "Cita reprogramada. Revisa la fecha confirmada en la agenda."
            : "Cita registrada. No se ha enviado ningún aviso al cliente.",
        )
      ) {
        setBookingOpen(false);
        setReminderRevision((value) => value + 1);
        setEditing(null);
        setTitle("");
        setNote("");
        setStartsAt("");
        setEndsAt("");
      }
    } catch (e) {
      setFormError(
        e instanceof Error ? e.message : "Revisa las fechas de la cita.",
      );
    }
  };
  const edit = (row: Appointment) => {
    setEditing(row);
    setResourceId(row.resource_id);
    setCustomerId(row.customer_id);
    setTitle(row.title);
    setNote(row.note ?? "");
    setStartsAt(utcToZonedInput(row.starts_at, row.timezone));
    setEndsAt(utcToZonedInput(row.ends_at, row.timezone));
    setBookingOpen(true);
    setFormError("");
  };
  return (
    <ViewLayout className="space-y-6">
      <ViewHeader
        eyebrow="Servicio y atención"
        title="Agenda del negocio"
        meta="Reserva el tiempo del equipo sin cruces de horario."
      />
      <p className="max-w-3xl text-sm text-kova-muted">
        Cada recurso conserva su zona horaria. Las citas son internas: no envían
        recordatorios, generan cobros ni cambian el inventario.
      </p>
      {panel.error && (
        <ViewError
          message={panel.error}
          onRetry={() => void panel.load()}
          retryLabel="Consultar versión actual"
        />
      )}
      {panel.notice && (
        <p role="status" className="rounded-xl bg-kova-mist p-4">
          {panel.notice}
        </p>
      )}
      {resourceError && (
        <ViewError
          message={resourceError}
          onRetry={() => setResourceRevision((value) => value + 1)}
          retryLabel="Consultar recursos"
        />
      )}
      <section className="space-y-4 rounded-2xl border border-kova-border bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Recursos disponibles</h2>
            <p className="mt-2 text-sm text-kova-muted">
              Una persona, mesa de atención o espacio que puede recibir una cita
              a la vez.
            </p>
          </div>
          <Button
            className={buttonClass}
            variant="outline"
            disabled={panel.busy || !panel.online}
            onClick={() => setResourceOpen((value) => !value)}
          >
            Agregar recurso
          </Button>
        </div>
        {resources.length === 0 && !resourceError && (
          <p className="text-sm text-kova-muted">
            Agrega el primer recurso para empezar a programar citas.
          </p>
        )}
        <ul className="grid gap-3 sm:grid-cols-2">
          {resources.map((row) => (
            <li
              key={row.id}
              className="min-w-0 space-y-2 rounded-xl bg-kova-mist p-4"
            >
              <p className="break-words font-medium">{row.name}</p>
              <p className="text-sm text-kova-muted">
                {zoneLabel(row.timezone)} ·{" "}
                {row.is_active ? "Disponible" : "Inactivo"}
              </p>
              <Button
                className={buttonClass}
                size="sm"
                variant="outline"
                disabled={panel.busy || !panel.online}
                onClick={() =>
                  void panel
                    .mutate(
                      `/resources/${row.id}`,
                      "PATCH",
                      {
                        expected_version: row.version,
                        is_active: !row.is_active,
                      },
                      "Disponibilidad del recurso actualizada.",
                    )
                    .then((ok) => {
                      if (ok) setResourceRevision((value) => value + 1);
                    })
                }
              >
                {row.is_active ? "Desactivar" : "Activar"} {row.name}
              </Button>
            </li>
          ))}
        </ul>
      </section>
      {resourceOpen && (
        <form
          className="space-y-4 rounded-2xl border border-kova-border bg-white p-6"
          onSubmit={(event) => void createResource(event)}
        >
          <h2 className="text-xl font-semibold">Nuevo recurso</h2>
          <label className="block text-sm">
            Nombre del recurso
            <input
              className={fieldClass}
              required
              maxLength={120}
              value={resourceName}
              onChange={(event) => setResourceName(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            Zona horaria del recurso
            <select
              className={fieldClass}
              value={resourceTimezone}
              onChange={(event) => setResourceTimezone(event.target.value)}
            >
              {appointmentTimezones.map((zone) => (
                <option key={zone.value} value={zone.value}>
                  {zone.label} ({zone.value})
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-kova-muted">
            Confirma la zona donde se prestará el servicio. Después de crear el
            recurso, su zona se conserva para proteger las citas.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              className={buttonClass}
              disabled={panel.busy || !panel.online || !resourceName.trim()}
            >
              Crear recurso
            </Button>
            <Button
              className={buttonClass}
              type="button"
              variant="ghost"
              onClick={() => setResourceOpen(false)}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          className={buttonClass}
          disabled={
            panel.busy ||
            !panel.online ||
            !resources.some((row) => row.is_active)
          }
          onClick={() => {
            setEditing(null);
            setResourceId("");
            setCustomerId("");
            setTitle("");
            setNote("");
            setStartsAt("");
            setEndsAt("");
            setFormError("");
            setBookingOpen((value) => !value);
          }}
        >
          Nueva cita
        </Button>
      </div>
      {bookingOpen && (
        <form
          className="space-y-4 rounded-2xl border border-kova-border bg-white p-6"
          onSubmit={(event) => void saveBooking(event)}
        >
          <h2 className="text-xl font-semibold">
            {editing ? "Reprogramar cita" : "Programar una cita"}
          </h2>
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          {editing ? (
            <p className="text-sm">
              {editing.title} · {editing.customer_name} ·{" "}
              {editing.resource_name}
            </p>
          ) : (
            <>
              <label className="block text-sm">
                Recurso de la cita
                <select
                  className={fieldClass}
                  required
                  value={resourceId}
                  onChange={(event) => {
                    setResourceId(event.target.value);
                    setStartsAt("");
                    setEndsAt("");
                  }}
                >
                  <option value="">Elige un recurso</option>
                  {resources
                    .filter((row) => row.is_active)
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name} · {zoneLabel(row.timezone)}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block text-sm">
                Buscar cliente
                <input
                  className={fieldClass}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              {customerError && <p role="alert">{customerError}</p>}
              <label className="block text-sm">
                Cliente de la cita
                <select
                  className={fieldClass}
                  required
                  value={customerId}
                  onChange={(event) => setCustomerId(event.target.value)}
                >
                  <option value="">Elige un cliente registrado</option>
                  {customers.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Motivo de la cita
                <input
                  className={fieldClass}
                  required
                  maxLength={160}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
            </>
          )}
          <p className="rounded-xl bg-kova-mist p-4 text-sm">
            {formTimezone
              ? `Escribe las horas de ${zoneLabel(formTimezone)} (${formTimezone}). La zona del dispositivo no modifica esta cita.`
              : "Selecciona primero el recurso para conocer la zona de la cita."}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              Inicio de la cita
              <input
                className={fieldClass}
                type="datetime-local"
                required
                disabled={!formTimezone}
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
              />
            </label>
            <label className="text-sm">
              Fin de la cita
              <input
                className={fieldClass}
                type="datetime-local"
                required
                disabled={!formTimezone}
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
              />
            </label>
          </div>
          <label className="block text-sm">
            Nota interna de la cita
            <textarea
              className={fieldClass}
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <Button
              className={buttonClass}
              disabled={
                panel.busy ||
                !panel.online ||
                !formTimezone ||
                !startsAt ||
                !endsAt ||
                (!editing && (!customerId || !title.trim()))
              }
            >
              {editing ? "Confirmar nuevo horario" : "Confirmar cita"}
            </Button>
            <Button
              className={buttonClass}
              type="button"
              variant="ghost"
              disabled={panel.busy}
              onClick={() => {
                setBookingOpen(false);
                setEditing(null);
              }}
            >
              Cancelar edición
            </Button>
          </div>
        </form>
      )}
      <AppointmentReminders revision={reminderRevision} identity={identity} />
      <section className="space-y-4" aria-label="Citas del negocio">
        <h2 className="text-xl font-semibold">Próximas citas y actividad</h2>
        <form
          className="space-y-3 rounded-xl border border-kova-border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const nextRange = appointmentDateRange(
                windowStart,
                windowEnd,
                filterTimezone,
              );
              if (
                nextRange.start === range.start &&
                nextRange.end === range.end &&
                offset === 0
              )
                void panel.load();
              else {
                setRange(nextRange);
                setOffset(0);
              }
              setRangeError("");
            } catch (e) {
              setRangeError(
                e instanceof Error
                  ? e.message
                  : "Revisa el período de consulta.",
              );
            }
          }}
        >
          <p className="text-sm text-kova-muted">
            El período usa la zona que elijas abajo e incluye días completos.
            Cada cita conserva la hora local de su recurso.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1 text-sm">
              Zona del período
              <select
                className={fieldClass}
                value={filterTimezone}
                onChange={(event) => setFilterTimezone(event.target.value)}
              >
                {appointmentTimezones.map((zone) => (
                  <option key={zone.value} value={zone.value}>
                    {zone.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 flex-1 text-sm">
              Desde
              <input
                className={fieldClass}
                required
                type="date"
                value={windowStart}
                onChange={(event) => setWindowStart(event.target.value)}
              />
            </label>
            <label className="min-w-0 flex-1 text-sm">
              Hasta
              <input
                className={fieldClass}
                required
                type="date"
                min={windowStart}
                value={windowEnd}
                onChange={(event) => setWindowEnd(event.target.value)}
              />
            </label>
            <Button className={buttonClass} variant="outline">
              Consultar período
            </Button>
          </div>
          {rangeError && (
            <p role="alert" className="text-sm text-destructive">
              {rangeError}
            </p>
          )}
        </form>
        {panel.loading && <p role="status">Consultando agenda…</p>}
        {panel.data?.items.length === 0 && (
          <p className="rounded-2xl border border-kova-border bg-white p-6 text-sm text-kova-muted">
            No hay citas en este período. Crea una cita o consulta otras fechas.
          </p>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          {panel.data?.items.map((row) => (
            <article
              key={row.id}
              className="min-w-0 space-y-3 rounded-2xl border border-kova-border bg-white p-5"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <h3 className="break-words font-semibold">{row.title}</h3>
                <span className="text-sm text-kova-muted">
                  {statuses[row.status]}
                </span>
              </div>
              <p className="break-words text-sm">
                {row.customer_name} · {row.resource_name}
              </p>
              <p className="text-sm font-medium">
                {formatAppointmentTime(row.starts_at, row.timezone)} →{" "}
                {formatAppointmentTime(row.ends_at, row.timezone)}
              </p>
              <p className="break-words text-xs text-kova-muted">
                Hora de {zoneLabel(row.timezone)} ({row.timezone})
              </p>
              {row.note && (
                <p className="whitespace-pre-wrap break-words text-sm text-kova-muted">
                  {row.note}
                </p>
              )}
              <Button
                className={buttonClass}
                size="sm"
                variant="ghost"
                onClick={() => setHistoryId(historyId === row.id ? "" : row.id)}
              >
                Ver historial de {row.title}
              </Button>
              {historyId === row.id && (
                <AppointmentHistory
                  key={`${row.id}:${row.version}`}
                  identity={identity}
                  appointment={row}
                />
              )}
              {row.status === "scheduled" &&
                new Date(row.starts_at).getTime() > Date.now() && (
                  <p className="text-xs text-kova-muted">
                    Podrás registrar atención o inasistencia después del inicio
                    de la cita.
                  </p>
                )}
              {row.status === "scheduled" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    className={buttonClass}
                    size="sm"
                    variant="outline"
                    disabled={panel.busy || !panel.online}
                    onClick={() => edit(row)}
                  >
                    Reprogramar {row.title}
                  </Button>
                  {(["completed", "no_show", "cancelled"] as const).map(
                    (status) => (
                      <Button
                        className={buttonClass}
                        key={status}
                        size="sm"
                        variant="outline"
                        disabled={
                          panel.busy ||
                          !panel.online ||
                          (status !== "cancelled" &&
                            new Date(row.starts_at).getTime() > Date.now())
                        }
                        onClick={() =>
                          setTransition({ appointment: row, status })
                        }
                      >
                        {status === "completed"
                          ? "Registrar atención"
                          : status === "no_show"
                            ? "Registrar inasistencia"
                            : "Cancelar cita"}
                      </Button>
                    ),
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
      {transition && (
        <section
          className="space-y-4 rounded-2xl border border-kova-border bg-white p-6"
          aria-label="Confirmar estado de cita"
        >
          <h2 className="text-xl font-semibold">
            Confirmar: {statuses[transition.status]}
          </h2>
          <p className="break-words text-sm">
            {transition.appointment.title} ·{" "}
            {transition.appointment.customer_name}
          </p>
          <p className="text-sm text-kova-muted">
            Registra lo ocurrido en el servicio. Esta acción no confirma cobros
            ni envía mensajes.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              className={buttonClass}
              disabled={panel.busy || !panel.online}
              onClick={() =>
                void panel
                  .mutate(
                    `/${transition.appointment.id}/transition`,
                    "POST",
                    {
                      expected_version: transition.appointment.version,
                      status: transition.status,
                    },
                    "Estado de cita actualizado.",
                  )
                  .then((ok) => {
                    if (ok) {
                      setTransition(null);
                      setReminderRevision((value) => value + 1);
                    }
                  })
              }
            >
              Confirmar estado
            </Button>
            <Button
              className={buttonClass}
              variant="ghost"
              disabled={panel.busy}
              onClick={() => setTransition(null)}
            >
              Volver
            </Button>
          </div>
        </section>
      )}
      <nav aria-label="Páginas de citas" className="flex flex-wrap gap-3">
        <Button
          className={buttonClass}
          variant="outline"
          disabled={offset === 0 || panel.loading}
          onClick={() => setOffset((value) => Math.max(0, value - 50))}
        >
          Anteriores
        </Button>
        <Button
          className={buttonClass}
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

type HistoryEntry = {
  id: string;
  action: "created" | "rescheduled" | "cancelled" | "completed" | "no_show";
  starts_at: string;
  ends_at: string;
  note: string | null;
  created_at: string;
  appointment_version: number;
};
const historyActions = {
  created: "Cita creada",
  rescheduled: "Horario actualizado",
  cancelled: "Cita cancelada",
  completed: "Atención registrada",
  no_show: "Inasistencia registrada",
};
function AppointmentHistory({
  identity,
  appointment,
}: {
  identity: WorkspaceIdentity;
  appointment: Appointment;
}) {
  const panel = useOperationsPanel<{ items: HistoryEntry[] }>(
    `/api/v1/appointments/${appointment.id}/history`,
    identity,
  );
  return (
    <section
      className="space-y-3 rounded-xl bg-kova-mist p-4"
      aria-label="Historial de la cita"
    >
      <h4 className="font-medium">Historial de cambios</h4>
      {panel.loading && <p role="status">Consultando historial…</p>}
      {panel.error && (
        <ViewError
          message={panel.error}
          onRetry={() => void panel.load()}
          retryLabel="Consultar historial"
        />
      )}
      <ol className="space-y-3">
        {panel.data?.items.map((row) => (
          <li key={row.id} className="min-w-0 space-y-1 text-sm">
            <p className="font-medium">
              {historyActions[row.action]} · versión {row.appointment_version}
            </p>
            <p>
              {formatAppointmentTime(row.starts_at, appointment.timezone)} →{" "}
              {formatAppointmentTime(row.ends_at, appointment.timezone)}
            </p>
            <p className="text-xs text-kova-muted">
              Registrado: {new Date(row.created_at).toLocaleString("es-MX")}
            </p>
            {row.note && (
              <p className="whitespace-pre-wrap break-words">{row.note}</p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
type Reminder = {
  id: string;
  appointment_id: string;
  appointment_version: number;
  title: string;
  starts_at: string;
  timezone: string;
  status: "pending" | "completed" | "dismissed" | "suppressed";
  due_at: string;
  version: number;
};
function AppointmentReminders({
  identity,
  revision,
}: {
  identity: WorkspaceIdentity;
  revision: number;
}) {
  const linked = useLinkedRecord<Reminder>(
    identity,
    "reminder_id",
    "/api/v1/appointments/reminders",
  );
  const [offset, setOffset] = useState(0);
  const panel = useOperationsPanel<{ items: Reminder[]; has_more: boolean }>(
    "/api/v1/appointments",
    identity,
    `/reminders?limit=50&offset=${offset}`,
  );
  const { load } = panel;
  const { reload: reloadLinked, requested: linkedRequested } = linked;
  const lastRevision = useRef(revision);
  useEffect(() => {
    if (lastRevision.current !== revision) {
      lastRevision.current = revision;
      void load();
      if (linkedRequested) reloadLinked();
    }
  }, [revision, load, linkedRequested, reloadLinked]);
  const resolve = async (row: Reminder, status: "completed" | "dismissed") => {
    await panel.mutate(
      `/reminders/${row.id}/resolve`,
      "POST",
      { expected_version: row.version, status },
      status === "completed"
        ? "Recordatorio revisado por el equipo. No se ha enviado un mensaje."
        : "Recordatorio descartado.",
    );
    if (linked.requested) linked.reload();
  };
  return (
    <section
      className="space-y-4 rounded-2xl border border-kova-border bg-white p-6"
      aria-label="Recordatorios internos"
    >
      <h2 className="text-xl font-semibold">Recordatorios para el equipo</h2>
      <p className="text-sm text-kova-muted">
        Son pendientes internos de citas vigentes. Marcarlos como revisados no
        envía un mensaje ni confirma que el cliente haya recibido un aviso.
      </p>
      <LinkedRecordNotice linked={linked}>
        {linked.record && (
          <ReminderCard
            row={linked.record}
            busy={panel.busy}
            online={panel.online}
            onResolve={resolve}
          />
        )}
      </LinkedRecordNotice>
      {panel.error && (
        <ViewError
          message={panel.error}
          onRetry={() => void panel.load()}
          retryLabel="Consultar recordatorios"
        />
      )}
      {panel.notice && <p role="status">{panel.notice}</p>}
      {panel.loading && <p role="status">Consultando recordatorios…</p>}
      {panel.data?.items.length === 0 && (
        <p className="text-sm text-kova-muted">
          No hay recordatorios pendientes por revisar en esta página.
        </p>
      )}
      <ul className="space-y-3">
        {panel.data?.items
          .filter((row) => row.id !== linked.record?.id)
          .map((row) => (
            <li key={row.id}>
              <ReminderCard
                row={row}
                busy={panel.busy}
                online={panel.online}
                onResolve={resolve}
              />
            </li>
          ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        <Button
          className={buttonClass}
          size="sm"
          variant="outline"
          disabled={offset === 0 || panel.loading}
          onClick={() => setOffset((value) => Math.max(0, value - 50))}
        >
          Recordatorios anteriores
        </Button>
        <Button
          className={buttonClass}
          size="sm"
          variant="outline"
          disabled={!panel.data?.has_more || panel.loading}
          onClick={() => setOffset((value) => value + 50)}
        >
          Más recordatorios
        </Button>
      </div>
    </section>
  );
}

function ReminderCard({
  row,
  busy,
  online,
  onResolve,
}: {
  row: Reminder;
  busy: boolean;
  online: boolean;
  onResolve: (row: Reminder, status: "completed" | "dismissed") => void;
}) {
  return (
    <article className="min-w-0 space-y-3 rounded-xl bg-kova-mist p-4">
      <h3 className="break-words font-medium">{row.title}</h3>
      <p className="text-sm">
        {formatAppointmentTime(row.starts_at, row.timezone)} ·{" "}
        {zoneLabel(row.timezone)}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button
          className={buttonClass}
          size="sm"
          variant="outline"
          disabled={busy || !online || row.status !== "pending"}
          onClick={() => onResolve(row, "completed")}
        >
          Registrar revisión del recordatorio
        </Button>
        <Button
          className={buttonClass}
          size="sm"
          variant="ghost"
          disabled={busy || !online || row.status !== "pending"}
          onClick={() => onResolve(row, "dismissed")}
        >
          Descartar recordatorio
        </Button>
      </div>
    </article>
  );
}
