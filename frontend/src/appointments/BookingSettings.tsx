import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, Globe, Scissors } from "lucide-react";
import { SectionHeadingIcon } from "@/components/ui/section-heading-icon";
import { useOperationsPanel } from "@/automations/useOperationsPanel";
import {
  useOperationsRequest,
  type WorkspaceIdentity,
} from "@/automations/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ViewError } from "@/components/ui/view-states";
import { SectionSkeleton } from "@/components/ui/section-skeleton";
import { appointmentTimezoneLabel } from "./timezone";
import { BookingPagePreview, type LoadBookingPreview } from "./BookingPreviews";
import type { BookingPreviewData } from "@/bookings/PublicBookingView";
import type { AppointmentResource } from "./types";
import type { Availability, BookingPage, BookingService } from "./bookingTypes";
import { resolveUserFacingError } from "@/lib/apiError";

const days = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];
export function BookingSettings({
  identity,
  resources,
  onSaved,
}: {
  identity: WorkspaceIdentity;
  resources: AppointmentResource[];
  onSaved: () => void;
}) {
  const publication = useOperationsPanel<BookingPage>(
    "/api/v1/appointments/booking-page",
    identity,
  );
  const previewRequest = useOperationsRequest("/api/v1/appointments", identity);
  const loadPreview = useCallback<LoadBookingPreview>(
    (draft) => previewRequest<BookingPreviewData>("/booking-preview", "POST", draft),
    [previewRequest],
  );
  return (
    <div className="space-y-4">
      {publication.loading && !publication.data ? (
        <SectionSkeleton
          label="Consultando tipo de reservas…"
          variant="notice"
        />
      ) : publication.data?.mode === "tables" ? (
        <p className="rounded-xl bg-kova-mist p-4 text-sm">
          Las mesas reciben solicitudes de llegada, sin duración ni hora de
          salida. El equipo elige la mesa y confirma cada reserva desde Agenda.
        </p>
      ) : (
        <Services
          identity={identity}
          resources={resources.filter((r) => r.kind !== "table")}
        />
      )}
      <AvailabilitySettings
        identity={identity}
        resources={resources}
        loadPreview={loadPreview}
        onSaved={onSaved}
      />
      <Publication panel={publication} loadPreview={loadPreview} onSaved={onSaved} />
    </div>
  );
}
function Services({
  identity,
  resources,
}: {
  identity: WorkspaceIdentity;
  resources: AppointmentResource[];
}) {
  const panel = useOperationsPanel<{ items: BookingService[] }>(
    "/api/v1/appointments/services",
    identity,
  );
  const [editing, setEditing] = useState<BookingService | null | undefined>(
    undefined,
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState("30");
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [active, setActive] = useState(true);
  const edit = (service: BookingService | null) => {
    setEditing(service);
    setName(service?.name ?? "");
    setDescription(service?.description ?? "");
    setDuration(String(service?.duration_minutes ?? 30));
    setResourceIds(service?.resource_ids ?? []);
    setActive(service?.is_active ?? true);
  };
  return (
    <section
      aria-label="Servicios para reservar"
      className="space-y-4 rounded-2xl border border-kova-border bg-white p-5"
    >
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2.5 text-lg font-semibold"><SectionHeadingIcon icon={Scissors} />Servicios</h2>
          <p className="mt-1 text-sm text-kova-muted">
            Qué pueden reservar, cuánto dura y quién lo atiende.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={panel.busy || !panel.online}
          onClick={() => edit(null)}
          aria-expanded={editing !== undefined}
          aria-controls="booking-service-form"
        >
          Agregar servicio
        </Button>
      </div>
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
      {panel.loading && (
        <SectionSkeleton label="Consultando servicios…" variant="list" />
      )}
      {panel.data?.items.length === 0 && (
        <p className="text-sm text-kova-muted">
          Agrega tu primer servicio para habilitar reservas.
        </p>
      )}
      <ul className="divide-y">
        {panel.data?.items.map((s) => (
          <li
            key={s.id}
            className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0">
              <p className="break-words font-medium">{s.name}</p>
              <p className="text-sm text-kova-muted">
                {s.duration_minutes} minutos ·{" "}
                {s.is_active ? "Disponible" : "Pausado"}
              </p>
            </div>
            <Button type="button" variant="ghost" onClick={() => edit(s)}>
              Editar {s.name}
            </Button>
          </li>
        ))}
      </ul>
      {editing !== undefined && (
        <form
          id="booking-service-form"
          className="space-y-4 border-t pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void panel
              .mutate(
                editing ? `/${editing.id}` : "",
                editing ? "PUT" : "POST",
                {
                  name,
                  description,
                  duration_minutes: Number(duration),
                  is_active: active,
                  resource_ids: resourceIds,
                  expected_version: editing?.version ?? 0,
                },
                "Servicio guardado.",
              )
              .then((ok) => {
                if (ok) {
                  setEditing(undefined);
                }
              });
          }}
        >
          <fieldset disabled={panel.busy} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="booking-service-name">Nombre del servicio</Label>
              <Input
                id="booking-service-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={160}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="booking-service-description">
                Descripción breve
              </Label>
              <Textarea
                id="booking-service-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="booking-duration">Duración en minutos</Label>
              <Input
                id="booking-duration"
                type="number"
                min="5"
                max="1440"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                required
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                Personas o espacios que lo atienden
              </legend>
              {resources.map((r) => (
                <label
                  key={r.id}
                  className="flex min-h-11 items-center gap-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={resourceIds.includes(r.id)}
                    onChange={(e) =>
                      setResourceIds((ids) =>
                        e.target.checked
                          ? [...ids, r.id]
                          : ids.filter((id) => id !== r.id),
                      )
                    }
                  />
                  {r.name}
                  {!r.is_active && " (inactivo)"}
                </label>
              ))}
              {!resources.length && (
                <p className="text-sm text-kova-muted">
                  Primero agrega una persona o espacio.
                </p>
              )}
            </fieldset>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Ofrecer este servicio
            </label>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={
                panel.busy ||
                !panel.online ||
                !name.trim() ||
                !resourceIds.length
              }
            >
              Guardar servicio
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={panel.busy}
              onClick={() => setEditing(undefined)}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
function AvailabilitySettings({
  identity,
  resources,
  loadPreview,
  onSaved,
}: {
  identity: WorkspaceIdentity;
  resources: AppointmentResource[];
  loadPreview: LoadBookingPreview;
  onSaved: () => void;
}) {
  const [resource, setResource] = useState("");
  return (
    <section
      aria-label="Disponibilidad para reservar"
      className="space-y-4 rounded-2xl border border-kova-border bg-white p-5"
    >
      <h2 className="flex items-center gap-2.5 text-lg font-semibold"><SectionHeadingIcon icon={CalendarClock} />Disponibilidad</h2>
      <p className="text-sm text-kova-muted">
        {resources.some((r) => r.kind === "table")
          ? "Define cuándo recibir solicitudes para cada mesa. El equipo revisa las reservas y confirma cada llegada."
          : "Define días y horarios de atención. Las citas ocupadas se descuentan automáticamente."}
      </p>
      <Label htmlFor="availability-resource">Persona o espacio</Label>
      <Select
        id="availability-resource"
        value={resource}
        onChange={(e) => setResource(e.target.value)}
      >
        <option value="">Elige a quién configurar</option>
        {resources.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Select>
      {resource && (
        <AvailabilityEditor
          key={resource}
          resource={resources.find((r) => r.id === resource)!}
          identity={identity}
          loadPreview={loadPreview}
          onSaved={onSaved}
        />
      )}
    </section>
  );
}
function AvailabilityEditor({
  identity,
  resource,
  loadPreview,
  onSaved,
}: {
  identity: WorkspaceIdentity;
  resource: AppointmentResource;
  loadPreview: LoadBookingPreview;
  onSaved: () => void;
}) {
  const panel = useOperationsPanel<Availability>(
    `/api/v1/appointments/availability/${resource.id}`,
    identity,
  );
  const [draft, setDraft] = useState<Availability | null>(null);
  useEffect(() => {
    if (panel.data) setDraft(panel.data);
  }, [panel.data]);
  const setWindow = (
    weekday: number,
    index: number,
    key: "start" | "end",
    value: string,
  ) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            weekly: d.weekly.map((day) =>
              day.weekday === weekday
                ? {
                    ...day,
                    windows: day.windows.map((w, i) =>
                      i === index ? { ...w, [key]: value } : w,
                    ),
                  }
                : day,
            ),
          }
        : d,
    );
  return (
    <div className="space-y-3">
      <p className="text-sm text-kova-muted">
        Horarios de {resource.name} ·{" "}
        {appointmentTimezoneLabel(resource.timezone)}
      </p>
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
      {panel.loading && !draft && (
        <SectionSkeleton label="Consultando disponibilidad…" variant="form" />
      )}
      {draft && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <BookingPagePreview
          className="lg:order-last"
          load={loadPreview}
          draft={{ availability: { resource_id: resource.id, weekly: draft.weekly, exceptions: draft.exceptions.filter((x) => x.date) } }}
        />
        <form
          className="min-w-0 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void panel
              .mutate(
                "",
                "PUT",
                {
                  expected_version: draft.version,
                  weekly: draft.weekly,
                  exceptions: draft.exceptions,
                },
                "Disponibilidad guardada. Las citas existentes se conservan.",
              )
              .then((ok) => {
                if (ok) onSaved();
              });
          }}
        >
          <fieldset disabled={panel.busy} className="space-y-3">
            {days.map((day, weekday) => {
              const entry = draft.weekly.find((d) => d.weekday === weekday);
              return (
                <div
                  key={day}
                  className="space-y-2 rounded-xl border border-kova-border p-3"
                >
                  <label className="flex min-h-11 items-center gap-3 font-medium">
                    <input
                      type="checkbox"
                      checked={Boolean(entry?.windows.length)}
                      onChange={(e) =>
                        setDraft((d) =>
                          d
                            ? {
                                ...d,
                                weekly: [
                                  ...d.weekly.filter(
                                    (w) => w.weekday !== weekday,
                                  ),
                                  ...(e.target.checked
                                    ? [
                                        {
                                          weekday,
                                          windows: [
                                            { start: "09:00", end: "18:00" },
                                          ],
                                        },
                                      ]
                                    : []),
                                ],
                              }
                            : d,
                        )
                      }
                    />
                    {day}
                  </label>
                  {entry?.windows.map((w, index) => (
                    <div key={index} className="flex flex-wrap items-end gap-2">
                      <div className="min-w-0 flex-1">
                        <Label htmlFor={`hours-${weekday}-${index}-start`}>
                          Inicio · {day}
                        </Label>
                        <Input
                          id={`hours-${weekday}-${index}-start`}
                          type="time"
                          value={w.start}
                          required
                          onChange={(e) =>
                            setWindow(weekday, index, "start", e.target.value)
                          }
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <Label htmlFor={`hours-${weekday}-${index}-end`}>
                          Fin · {day}
                        </Label>
                        <Input
                          id={`hours-${weekday}-${index}-end`}
                          type="time"
                          value={w.end}
                          required
                          onChange={(e) =>
                            setWindow(weekday, index, "end", e.target.value)
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={`Quitar horario ${index + 1} de ${day}`}
                        onClick={() =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  weekly: d.weekly.map((x) =>
                                    x.weekday === weekday
                                      ? {
                                          ...x,
                                          windows: x.windows.filter(
                                            (_, i) => i !== index,
                                          ),
                                        }
                                      : x,
                                  ),
                                }
                              : d,
                          )
                        }
                      >
                        Quitar
                      </Button>
                    </div>
                  ))}
                  {entry && entry.windows.length < 10 && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setDraft((d) =>
                          d
                            ? {
                                ...d,
                                weekly: d.weekly.map((x) =>
                                  x.weekday === weekday
                                    ? {
                                        ...x,
                                        windows: [
                                          ...x.windows,
                                          { start: "18:00", end: "19:00" },
                                        ],
                                      }
                                    : x,
                                ),
                              }
                            : d,
                        )
                      }
                    >
                      Agregar horario de {day}
                    </Button>
                  )}
                </div>
              );
            })}
            <h3 className="font-semibold">Excepciones por fecha</h3>
            <p className="text-sm text-kova-muted">
              Una excepción reemplaza los horarios de ese día. Déjala cerrada
              para vacaciones o descansos.
            </p>
            {draft.exceptions.map((x, index) => (
              <div key={index} className="space-y-2 rounded-xl border p-3">
                <Label htmlFor={`exception-${index}`}>Fecha de excepción</Label>
                <Input
                  id={`exception-${index}`}
                  type="date"
                  required
                  value={x.date}
                  onChange={(e) =>
                    setDraft((d) =>
                      d
                        ? {
                            ...d,
                            exceptions: d.exceptions.map((v, i) =>
                              i === index ? { ...v, date: e.target.value } : v,
                            ),
                          }
                        : d,
                    )
                  }
                />
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!x.windows.length}
                    onChange={(e) =>
                      setDraft((d) =>
                        d
                          ? {
                              ...d,
                              exceptions: d.exceptions.map((v, i) =>
                                i === index
                                  ? {
                                      ...v,
                                      windows: e.target.checked
                                        ? []
                                        : [{ start: "09:00", end: "18:00" }],
                                    }
                                  : v,
                              ),
                            }
                          : d,
                      )
                    }
                  />
                  Cerrado todo el día
                </label>
                {x.windows.map((w, wi) => (
                  <div key={wi} className="grid grid-cols-2 gap-2">
                    {(["start", "end"] as const).map((key) => (
                      <div key={key}>
                        <Label htmlFor={`exception-${index}-${wi}-${key}`}>
                          {key === "start" ? "Inicio" : "Fin"} de excepción
                        </Label>
                        <Input
                          id={`exception-${index}-${wi}-${key}`}
                          type="time"
                          value={w[key]}
                          required
                          onChange={(e) =>
                            setDraft((d) =>
                              d
                                ? {
                                    ...d,
                                    exceptions: d.exceptions.map((v, i) =>
                                      i === index
                                        ? {
                                            ...v,
                                            windows: v.windows.map((a, j) =>
                                              j === wi
                                                ? {
                                                    ...a,
                                                    [key]: e.target.value,
                                                  }
                                                : a,
                                            ),
                                          }
                                        : v,
                                    ),
                                  }
                                : d,
                            )
                          }
                        />
                      </div>
                    ))}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    setDraft((d) =>
                      d
                        ? {
                            ...d,
                            exceptions: d.exceptions.filter(
                              (_, i) => i !== index,
                            ),
                          }
                        : d,
                    )
                  }
                >
                  Quitar excepción
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setDraft((d) =>
                  d
                    ? {
                        ...d,
                        exceptions: [
                          ...d.exceptions,
                          { date: "", windows: [] },
                        ],
                      }
                    : d,
                )
              }
            >
              Agregar excepción
            </Button>
          </fieldset>
          <Button disabled={panel.busy || !panel.online}>
            Guardar disponibilidad
          </Button>
        </form>
        </div>
      )}
    </div>
  );
}
function Publication({
  panel,
  loadPreview,
  onSaved,
}: {
  panel: ReturnType<typeof useOperationsPanel<BookingPage>>;
  loadPreview: LoadBookingPreview;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<BookingPage | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState("");
  const share = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (panel.data && !open) setDraft(panel.data);
  }, [panel.data, open]);
  return (
    <section
      aria-label="Reservas en línea"
      className="space-y-4 rounded-2xl border border-kova-border bg-white p-5"
    >
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2.5 text-lg font-semibold"><SectionHeadingIcon icon={Globe} />Reservas en línea</h2>
          <p className="mt-1 text-sm text-kova-muted">
            Comparte un enlace para que tus clientes elijan un horario. El cobro
            se registra después en Caja.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={!panel.data || panel.busy}
          aria-expanded={open}
          aria-controls="booking-publication-form"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Cerrar ajustes" : "Configurar reservas en línea"}
        </Button>
      </div>
      {panel.error && (
        <ViewError
          retryLabel="Volver a consultar"
          message={panel.error}
          onRetry={() => void panel.load()}
        />
      )}
      {panel.notice && <p role="status">{panel.notice}</p>}
      {panel.data && (
        <p className="text-sm font-medium">
          {panel.data.enabled
            ? "Enlace público activo"
            : "Reservas públicas desactivadas"}
        </p>
      )}
      {panel.data?.share_path && (
        <div className="space-y-2">
          <Label htmlFor="booking-share">Enlace para reservar</Label>
          <Input
            id="booking-share"
            ref={share}
            readOnly
            value={new URL(panel.data.share_path, window.location.origin).href}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(share.current?.value ?? "")
                  .then(() => setCopied("Enlace copiado."))
                  .catch(() => {
                    share.current?.focus();
                    share.current?.select();
                    setCopied("Selecciona y copia tu enlace.");
                  });
              }}
            >
              Copiar enlace
            </Button>
            <a
              className="inline-flex min-h-11 items-center text-sm underline"
              href={panel.data.share_path}
              target="_blank"
              rel="noreferrer"
            >
              Ver página de reservas
            </a>
          </div>
          {copied && (
            <p role="status" className="text-sm">
              {copied}
            </p>
          )}
        </div>
      )}
      {open && draft && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <BookingPagePreview
          className="lg:order-last"
          load={loadPreview}
          enabled={draft.enabled}
          draft={{ page: { mode: draft.mode ?? "appointments", horizon_days: draft.horizon_days, notice_minutes: draft.notice_minutes, slot_minutes: draft.slot_minutes, manage_cutoff_hours: draft.manage_cutoff_hours } }}
        />
        <form
          id="booking-publication-form"
          className="min-w-0 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void panel
              .mutate(
                "",
                "PUT",
                {
                  ...(draft.mode ? { mode: draft.mode } : {}),
                  enabled: draft.enabled,
                  expected_version: draft.version,
                  horizon_days: draft.horizon_days,
                  notice_minutes: draft.notice_minutes,
                  slot_minutes: draft.slot_minutes,
                  manage_cutoff_hours: draft.manage_cutoff_hours,
                },
                "Reservas en línea actualizadas.",
              )
              .then((ok) => {
                if (ok) {
                  setOpen(false);
                  onSaved();
                }
              });
          }}
        >
          <fieldset disabled={panel.busy} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="booking-mode">¿Qué podrán reservar?</Label>
              <Select
                id="booking-mode"
                value={draft.mode ?? "appointments"}
                onChange={(e) =>
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          mode: e.target.value as "appointments" | "tables",
                        }
                      : d,
                  )
                }
              >
                <option value="appointments">
                  Servicios con cita y duración
                </option>
                <option value="tables">
                  Mesas con confirmación del negocio
                </option>
              </Select>
            </div>
            <label className="flex min-h-11 items-center gap-3 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, enabled: e.target.checked } : d))
                }
              />
              Permitir reservas desde el enlace público
            </label>
            {(
              [
                {
                  key: "horizon_days",
                  label: "Días disponibles hacia adelante",
                  min: 1,
                  max: 366,
                },
                {
                  key: "notice_minutes",
                  label: "Anticipación mínima en minutos",
                  min: 0,
                  max: 525600,
                },
                {
                  key: "slot_minutes",
                  label: "Ofrecer inicios cada (minutos)",
                  min: 5,
                  max: 120,
                },
                {
                  key: "manage_cutoff_hours",
                  label: "Cambios hasta estas horas antes",
                  min: 0,
                  max: 720,
                },
              ] as const
            ).map((f) => (
              <div key={f.key} className="space-y-2">
                <Label htmlFor={`booking-${f.key}`}>{f.label}</Label>
                <Input
                  id={`booking-${f.key}`}
                  type="number"
                  min={f.min}
                  max={f.max}
                  required
                  value={draft[f.key]}
                  onChange={(e) =>
                    setDraft((d) =>
                      d ? { ...d, [f.key]: Number(e.target.value) } : d,
                    )
                  }
                />
              </div>
            ))}
          </fieldset>
          <p className="text-sm text-kova-muted">
            {draft.mode === "tables"
              ? "El cliente envía una solicitud. El equipo revisa la disponibilidad y confirma la mesa; no se fija una hora de salida. No se envían mensajes automáticos."
              : "Se confirma al reservar. La confirmación aparece en pantalla; el equipo contacta al cliente cuando sea necesario."}
          </p>
          <Button disabled={panel.busy || !panel.online}>
            Guardar reservas en línea
          </Button>
        </form>
        </div>
      )}
    </section>
  );
}

export function PersonalBookingLink({
  identity,
  customerId,
}: {
  identity: WorkspaceIdentity;
  customerId: string;
}) {
  const request = useOperationsRequest("/api/v1/appointments", identity);
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError("");
          void request<{ share_path: string }>("/booking-invites", "POST", {
            customer_id: customerId,
          })
            .then((r) => setPath(r.share_path))
            .catch((e) =>
              setError(
                resolveUserFacingError(
                  e,
                  "No pudimos preparar el enlace personal.",
                ),
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        Compartir agenda con este cliente
      </Button>
      {path && (
        <div>
          <label htmlFor="personal-booking-link" className="text-sm">
            Enlace personal para reservar
            <Input
              id="personal-booking-link"
              readOnly
              value={new URL(path, window.location.origin).href}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <p className="mt-1 text-xs text-kova-muted">
            Compártelo solo con este cliente. Sus reservas se vincularán a su
            ficha.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
