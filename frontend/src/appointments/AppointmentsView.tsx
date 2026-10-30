import { SectionSkeleton } from "@/components/ui/section-skeleton";
import { resolveUserFacingError } from "@/lib/apiError";
import { CalendarDays } from "lucide-react";
import { LinkedRecordNotice } from "@/operationsQueue/LinkedRecordNotice";
import { useLinkedRecord } from "@/operationsQueue/useLinkedRecord";
import { useId, useEffect, useRef, useState, type FormEvent } from "react";
import {
  OperationsSession,
  useOperationsRequest,
  type WorkspaceIdentity,
} from "@/automations/workspace";
import { useOperationsPanel } from "@/automations/useOperationsPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewEmpty, ViewError } from "@/components/ui/view-states";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { resolveActiveCustomer, type Customer } from "@/customers/api";
import { Link, useSearchParams } from "react-router-dom";
import { AppointmentSalePanel } from "./AppointmentSalePanel";
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

const fieldClass = "mt-1 min-w-0";
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
  const fieldId = useId();
  const [reminderRevision, setReminderRevision] = useState(0);
  const linked = useLinkedRecord<Appointment>(identity, "appointmentId", "/api/v1/appointments");
  const [params, setParams] = useSearchParams();
  const customerValues = params.getAll("customerId");
  const incomingCustomer = customerValues.length === 1 ? customerValues[0] : customerValues.length > 1 ? "invalid" : "";
  const [linkedCustomer, setLinkedCustomer] = useState<Customer | null>(null);
  const [incomingCustomerError, setIncomingCustomerError] = useState("");
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
  const [resourceLoading, setResourceLoading] = useState(true);
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
    setResourceLoading(true);
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
            resolveUserFacingError(e, "No pudimos cargar los recursos."),
          );
      }).finally(() => { if (active) setResourceLoading(false); });
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
  useEffect(() => {
    if (!incomingCustomer) return;
    const controller = new AbortController();
    void resolveActiveCustomer(incomingCustomer, { signal: controller.signal, headers: { "X-Kova-Expected-Tenant": identity.tenantId, "X-Kova-Branch": identity.branchId } })
      .then((customer) => {
        if (controller.signal.aborted) return;
        setLinkedCustomer(customer);
        setCustomerId(customer.id);
        setBookingOpen(true);
        setIncomingCustomerError("");
        setParams((current) => { const next = new URLSearchParams(current); next.delete("customerId"); return next; }, { replace: true });
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setIncomingCustomerError(resolveUserFacingError(error, "No pudimos consultar el cliente del enlace."));
      });
    return () => controller.abort();
  }, [incomingCustomer, setParams, identity.tenantId, identity.branchId]);
  const visibleAppointments = linked.record
    ? [linked.record, ...(panel.data?.items ?? []).filter((row) => row.id !== linked.record?.id)]
    : panel.data?.items ?? [];
  const hasActiveResource = resources.some(row => row.is_active);
  const resourceNameInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (resourceOpen) resourceNameInput.current?.focus(); }, [resourceOpen]);
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
        linked.reload();
        setBookingOpen(false);
        setReminderRevision((value) => value + 1);
        setEditing(null);
        setResourceId("");
        setCustomerId("");
        setTitle("");
        setNote("");
        setStartsAt("");
        setEndsAt("");
      }
    } catch (e) {
      setFormError(
        resolveUserFacingError(e, "Revisa las fechas de la cita."),
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
        actions={
          <Button
            className={buttonClass}
            aria-expanded={hasActiveResource ? bookingOpen : resourceOpen}
            aria-controls={hasActiveResource ? "appointment-booking-form" : "appointment-resource-form"}
            disabled={
              panel.busy ||
              !panel.online || resourceLoading || Boolean(resourceError)
            }
            onClick={() => {
              if (!hasActiveResource) { setResourceOpen(true); return; }
              setFormError("");
              if (editing) {
                setEditing(null);
                setResourceId("");
                setCustomerId("");
                setTitle("");
                setNote("");
                setStartsAt("");
                setEndsAt("");
                setBookingOpen(true);
              } else {
                setBookingOpen((value) => !value);
              }
            }}
          >
            {hasActiveResource || resourceLoading ? "Nueva cita" : "Agregar persona o espacio"}
          </Button>
        }
      />
      <p className="max-w-3xl text-sm text-kova-muted">
        Organiza las citas en el horario de cada persona o espacio. El equipo contacta
        al cliente; el cobro se registra por separado en Caja.
      </p>
      {incomingCustomerError && <p role="alert">{incomingCustomerError}</p>}
      <LinkedRecordNotice linked={linked}>
        {linked.record && <p className="text-sm">Cita solicitada: {linked.record.title}. Revisa su venta y continúa abajo.</p>}
      </LinkedRecordNotice>
      {panel.error && (
        <ViewError
          message={panel.error}
          onRetry={() => void panel.load()}
          retryLabel="Consultar datos actualizados"
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
      <details className="space-y-4 rounded-2xl border border-kova-border bg-white p-6" open={resources.length === 0 || resourceOpen}>
        <summary className="min-h-11 cursor-pointer font-semibold">Personas y espacios para las citas</summary>
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
        {resources.length === 0 && !resourceError && !resourceLoading && (
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
      </details>
      {resourceOpen && (
        <form
          id="appointment-resource-form"
          className="space-y-4 rounded-2xl border border-kova-border bg-white p-6"
          onSubmit={(event) => void createResource(event)}
        >
          <h2 className="text-xl font-semibold">Nuevo recurso</h2>
          <Label htmlFor={`${fieldId}-1`} className="block text-sm">
            Nombre del recurso
            <Input id={`${fieldId}-1`} ref={resourceNameInput}
              className={fieldClass}
              required
              maxLength={120}
              value={resourceName}
              onChange={(event) => setResourceName(event.target.value)}
            />
          </Label>
          <Label htmlFor={`${fieldId}-2`} className="block text-sm">
            Zona horaria del recurso
            <Select id={`${fieldId}-2`}
              className={fieldClass}
              value={resourceTimezone}
              onChange={(event) => setResourceTimezone(event.target.value)}
            >
              {appointmentTimezones.map((zone) => (
                <option key={zone.value} value={zone.value}>
                  {zone.label} ({zone.value})
                </option>
              ))}
            </Select>
          </Label>
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
      {bookingOpen && (
        <form
          id="appointment-booking-form"
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
              <Label htmlFor={`${fieldId}-3`} className="block text-sm">
                Recurso de la cita
                <Select id={`${fieldId}-3`}
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
                </Select>
              </Label>
              <Label htmlFor={`${fieldId}-4`} className="block text-sm">
                Buscar cliente
                <Input id={`${fieldId}-4`}
                  className={fieldClass}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </Label>
              {customerError && <p role="alert">{customerError}</p>}
              <Label htmlFor={`${fieldId}-5`} className="block text-sm">
                Cliente de la cita
                <Select id={`${fieldId}-5`}
                  className={fieldClass}
                  required
                  value={customerId}
                  onChange={(event) => setCustomerId(event.target.value)}
                >
                  <option value="">Elige un cliente registrado</option>
                  {(linkedCustomer ? [linkedCustomer, ...customers.filter((row) => row.id !== linkedCustomer.id)] : customers).map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </Select>
              </Label>
              <Label htmlFor={`${fieldId}-6`} className="block text-sm">
                Motivo de la cita
                <Input id={`${fieldId}-6`}
                  className={fieldClass}
                  required
                  maxLength={160}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </Label>
            </>
          )}
          <p className="rounded-xl bg-kova-mist p-4 text-sm">
            {formTimezone
              ? `Escribe las horas de ${zoneLabel(formTimezone)} (${formTimezone}). La zona del dispositivo no modifica esta cita.`
              : "Selecciona primero el recurso para conocer la zona de la cita."}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Label htmlFor={`${fieldId}-7`} className="text-sm">
              Inicio de la cita
              <Input id={`${fieldId}-7`}
                className={fieldClass}
                type="datetime-local"
                required
                disabled={!formTimezone}
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
              />
            </Label>
            <Label htmlFor={`${fieldId}-8`} className="text-sm">
              Fin de la cita
              <Input id={`${fieldId}-8`}
                className={fieldClass}
                type="datetime-local"
                required
                disabled={!formTimezone}
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
              />
            </Label>
          </div>
          <Label htmlFor={`${fieldId}-9`} className="block text-sm">
            Nota interna de la cita
            <Textarea id={`${fieldId}-9`}
              className={fieldClass}
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Label>
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
                resolveUserFacingError(e, "Revisa el período de consulta."),
              );
            }
          }}
        >
          <p className="text-sm text-kova-muted">
            El período usa la zona que elijas abajo e incluye días completos.
            Cada cita conserva la hora local de su recurso.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Label htmlFor={`${fieldId}-10`} className="min-w-0 flex-1 text-sm">
              Zona del período
              <Select id={`${fieldId}-10`}
                className={fieldClass}
                value={filterTimezone}
                onChange={(event) => setFilterTimezone(event.target.value)}
              >
                {appointmentTimezones.map((zone) => (
                  <option key={zone.value} value={zone.value}>
                    {zone.label}
                  </option>
                ))}
              </Select>
            </Label>
            <Label htmlFor={`${fieldId}-11`} className="min-w-0 flex-1 text-sm">
              Desde
              <Input id={`${fieldId}-11`}
                className={fieldClass}
                required
                type="date"
                value={windowStart}
                onChange={(event) => setWindowStart(event.target.value)}
              />
            </Label>
            <Label htmlFor={`${fieldId}-12`} className="min-w-0 flex-1 text-sm">
              Hasta
              <Input id={`${fieldId}-12`}
                className={fieldClass}
                required
                type="date"
                min={windowStart}
                value={windowEnd}
                onChange={(event) => setWindowEnd(event.target.value)}
              />
            </Label>
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
        {panel.loading && <SectionSkeleton label="Consultando agenda…" variant="list" />}
        {!panel.loading && !panel.error && visibleAppointments.length === 0 && !linked.loading && (
          <ViewEmpty
            icon={<CalendarDays className="h-6 w-6" aria-hidden="true" />}
            title="No hay citas en este período."
            body="Crea una cita o consulta otras fechas."
          />
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          {visibleAppointments.map((row) => (
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
              <Link className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline" to={`/customers?customerId=${row.customer_id}`}>Ver cliente y su historial</Link>
              <AppointmentSalePanel appointment={row} identity={identity} busy={panel.busy} online={panel.online} onLink={async (saleId) => {
                const ok = await panel.mutate(`/${row.id}/sale`, "POST", { expected_version: row.version, sale_order_id: saleId }, "Venta vinculada. El estado de atención se conserva.");
                linked.reload();
                setReminderRevision((value) => value + 1);
                return ok;
              }} />
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
                    linked.reload();
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
  action: "created" | "rescheduled" | "cancelled" | "completed" | "no_show" | "sale_linked";
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
  sale_linked: "Venta vinculada",
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
      {panel.loading && <SectionSkeleton label="Consultando historial…" variant="list" />}
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
              {historyActions[row.action]}
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
      {panel.loading && <SectionSkeleton label="Consultando recordatorios…" variant="list" />}
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
