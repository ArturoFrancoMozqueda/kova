import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { InitialsAvatar } from "@/components/visual";
import { useOperationsPanel } from "@/automations/useOperationsPanel";
import type { WorkspaceIdentity } from "@/automations/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SectionSkeleton } from "@/components/ui/section-skeleton";
import { ViewError } from "@/components/ui/view-states";
import { addDays, dateKey } from "@/bookings/DatePicker";
import { appointmentDateRange, appointmentTimezones } from "./timezone";
import type { AppointmentResource } from "./types";
import type { CalendarEvent } from "./bookingTypes";
import { PublicBookingDetail } from "./PublicBookingDetail";
import { TableReservationDetail } from "./TableReservations";
import { tableStatusText } from "@/bookings/tableStatus";
import type { TableStatus } from "./bookingTypes";
import { SemanticLabel } from "@/components/ui/status-badge";

const statuses: Record<string, string> = {
  scheduled: "Programada",
  cancelled: "Cancelada",
  completed: "Atendida",
  no_show: "No asistió",
};
export function CalendarBoard({
  identity,
  resources,
  revision,
  onTableSaved,
}: {
  identity: WorkspaceIdentity;
  resources: AppointmentResource[];
  revision: number;
  onTableSaved?: () => void;
}) {
  const [day, setDay] = useState(() => dateKey(new Date()));
  const [zone, setZone] = useState("America/Mexico_City");
  const [resourceId, setResourceId] = useState("");
  const [view, setView] = useState<"day" | "week" | "list">("week");
  const [mobile, setMobile] = useState(
    () => window.matchMedia?.("(max-width: 767px)").matches ?? false,
  );
  const [params, setParams] = useSearchParams();
  const bookingId = params.get("bookingId");
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 767px)");
    if (!media) return;
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const activeView = mobile && view === "week" ? "day" : view;
  const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
  const firstDay = activeView === "day" ? day : addDays(day, -weekday);
  const lastDay = activeView === "day" ? day : addDays(firstDay, 6);
  const range = appointmentDateRange(firstDay, lastDay, zone);
  const panel = useOperationsPanel<{
    items: CalendarEvent[];
    has_more: boolean;
  }>(
    "/api/v1/appointments/calendar",
    identity,
    `?starts_from=${encodeURIComponent(range.start)}&starts_until=${encodeURIComponent(range.end)}&revision=${revision}${resourceId ? `&resource_id=${encodeURIComponent(resourceId)}` : ""}`,
  );
  const events =
    panel.data?.items.filter(
      (e) => !resourceId || e.resource_id === resourceId,
    ) ?? [];
  const days = Array.from({ length: activeView === "day" ? 1 : 7 }, (_, i) =>
    addDays(firstDay, i),
  );
  const choose = (event: CalendarEvent) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.delete("bookingId");
      n.delete("appointmentId");
      n.delete("tableId");
      n.set(
        event.source === "table"
          ? "tableId"
          : event.source === "booking"
            ? "bookingId"
            : "appointmentId",
        event.id,
      );
      return n;
    });
  const renderEvent = (event: CalendarEvent) => (
    <button
      key={event.id}
      type="button"
      onClick={() => choose(event)}
      className={`w-full min-w-0 space-y-1 rounded-xl border p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-kova-blue ${event.status === "scheduled" ? "border-kova-blue/20 bg-kova-blue/5 hover:bg-kova-blue/10" : "border-kova-border bg-kova-mist"}`}
    >
      <span className="block text-xs font-semibold tabular-nums">
        {new Intl.DateTimeFormat("es-MX", {
          timeZone: zone,
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(event.starts_at))}{" "}
        {event.ends_at ? (
          <>
            –{" "}
            {new Intl.DateTimeFormat("es-MX", {
              timeZone: zone,
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(event.ends_at))}
          </>
        ) : (
          " · Llegada"
        )}
      </span>
      <span className="block break-words text-sm font-semibold">
        {event.title}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-xs">
        <InitialsAvatar name={event.customer_name} size="sm" className="h-5 w-5 text-[9px]" />
        <span className="min-w-0 break-words">{event.customer_name}</span>
      </span>
      <span className="block break-words text-xs text-kova-muted">
        {event.resource_name}
      </span>
      <span className="flex flex-wrap items-center gap-x-1 text-xs text-kova-muted">
        {event.source === "table"
          ? tableStatusText[event.status as TableStatus]
          : <SemanticLabel domain="appointment" value={event.status} label={statuses[event.status] ?? "Consultar cita"} />}
        {event.source === "booking" ? " · Reserva en línea" : ""}
      </span>
    </button>
  );
  return (
    <section
      aria-label="Calendario de citas"
      className="space-y-4 rounded-2xl border border-kova-border bg-white p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Tu agenda</h2>
          <p className="mt-1 text-sm text-kova-muted">
            Citas del equipo y reservas en línea en un mismo lugar.
          </p>
        </div>
        <SegmentedControl
          ariaLabel="Vista de agenda"
          options={
            mobile
              ? [
                  { value: "day", label: "Día" },
                  { value: "list", label: "Lista" },
                ]
              : [
                  { value: "day", label: "Día" },
                  { value: "week", label: "Semana" },
                  { value: "list", label: "Lista" },
                ]
          }
          value={activeView}
          onValueChange={setView}
        />
      </div>
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="Período anterior"
            onClick={() => setDay(addDays(day, activeView === "day" ? -1 : -7))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setDay(dateKey(new Date(), zone))}
          >
            Hoy
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="Período siguiente"
            onClick={() => setDay(addDays(day, activeView === "day" ? 1 : 7))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor="calendar-day">Fecha</Label>
          <Input
            id="calendar-day"
            type="date"
            required
            value={day}
            onChange={(e) => {
              if (e.target.value && /^\d{4}-\d{2}-\d{2}$/.test(e.target.value))
                setDay(e.target.value);
            }}
          />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor="calendar-resource">Persona o espacio</Label>
          <Select
            id="calendar-resource"
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
          >
            <option value="">Todos</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor="calendar-zone">Zona horaria</Label>
          <Select
            id="calendar-zone"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
          >
            {appointmentTimezones.map((z) => (
              <option key={z.value} value={z.value}>
                {z.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {panel.error && (
        <ViewError
          retryLabel="Volver a consultar"
          message={panel.error}
          onRetry={() => void panel.load()}
        />
      )}
      {panel.loading ? (
        <SectionSkeleton label="Consultando calendario…" variant="list" />
      ) : (
        panel.data &&
        !panel.error && (
          <>
            {panel.data.has_more && (
              <p
                role="status"
                className="rounded-xl border border-warning/30 p-3 text-sm"
              >
                Este período contiene más citas de las que podemos mostrar.
                Cambia a la vista por día para consultar un período más corto.
              </p>
            )}
            {activeView === "list" ? (
              <div className="space-y-4">
                {days.map((d) => {
                  const rows = events.filter(
                    (e) =>
                      dateKey(new Date(e.starts_at), zone) <= d &&
                      dateKey(
                        new Date(
                          e.ends_at
                            ? new Date(e.ends_at).getTime() - 1
                            : e.starts_at,
                        ),
                        zone,
                      ) >= d,
                  );
                  return (
                    <section key={d} className="space-y-2">
                      <h3 className="font-semibold">
                        {new Intl.DateTimeFormat("es-MX", {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                          timeZone: "UTC",
                        }).format(new Date(`${d}T12:00:00Z`))}
                      </h3>
                      {rows.length ? (
                        rows.map(renderEvent)
                      ) : (
                        <p className="text-sm text-kova-muted">Sin citas.</p>
                      )}
                    </section>
                  );
                })}
              </div>
            ) : (
              <div
                className={`grid gap-2 ${activeView === "week" ? "md:grid-cols-7" : "grid-cols-1"}`}
              >
                {days.map((d) => {
                  const rows = events.filter(
                    (e) =>
                      dateKey(new Date(e.starts_at), zone) <= d &&
                      dateKey(
                        new Date(
                          e.ends_at
                            ? new Date(e.ends_at).getTime() - 1
                            : e.starts_at,
                        ),
                        zone,
                      ) >= d,
                  );
                  return (
                    <section key={d} className="min-w-0 space-y-2">
                      <h3
                        className={`rounded-lg px-1 py-3 text-center text-xs font-semibold capitalize ${d === dateKey(new Date(), zone) ? "bg-kova-blue text-white" : "bg-kova-mist"}`}
                      >
                        {new Intl.DateTimeFormat("es-MX", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          timeZone: "UTC",
                        }).format(new Date(`${d}T12:00:00Z`))}
                      </h3>
                      {rows.length ? (
                        rows.map(renderEvent)
                      ) : (
                        <div className="rounded-xl border border-dashed border-kova-border px-2 py-6 text-center text-xs text-kova-muted">
                          <CalendarDays
                            className="mx-auto mb-2 h-4 w-4"
                            aria-hidden="true"
                          />
                          Sin citas
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )
      )}
      {params.get("tableId") && (
        <TableReservationDetail
          key={params.get("tableId")}
          identity={identity}
          reservationId={params.get("tableId")!}
          resources={resources}
          onClose={() =>
            setParams((p) => {
              const n = new URLSearchParams(p);
              n.delete("tableId");
              return n;
            })
          }
          onSaved={() => {
            void panel.load();
            onTableSaved?.();
          }}
        />
      )}
      {bookingId && (
        <PublicBookingDetail
          key={bookingId}
          identity={identity}
          bookingId={bookingId}
          onClose={() =>
            setParams((p) => {
              const n = new URLSearchParams(p);
              n.delete("bookingId");
              return n;
            })
          }
          onSaved={() => void panel.load()}
        />
      )}
      {params.get("appointmentId") && (
        <Link
          to="#appointment-detail"
          className="inline-flex min-h-11 items-center text-sm underline"
          onClick={() =>
            document
              .getElementById("appointment-detail")
              ?.scrollIntoView({ behavior: "auto" })
          }
        >
          Ver detalle y acciones de la cita seleccionada
        </Link>
      )}
    </section>
  );
}
