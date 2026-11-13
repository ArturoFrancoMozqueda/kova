import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { CalendarDays, CheckCircle2, Clock, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SectionSkeleton } from "@/components/ui/section-skeleton";
import { ViewError } from "@/components/ui/view-states";
import { csrfHeaders } from "@/lib/csrf";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useOnline } from "@/automations/workspace";
import type {
  BookingReceipt,
  BookingService,
  Slot,
} from "@/appointments/bookingTypes";
import {
  appointmentTimezoneLabel,
  formatAppointmentTime,
} from "@/appointments/timezone";
import { BookingError, publicBookingRequest } from "./api";
import { addDays, dateKey, DatePicker } from "./DatePicker";
import { downloadCalendar } from "./calendarFile";
import { PublicTableRequest } from "./PublicTableRequest";

export type BookingContext = Context;
export type BookingPreviewData = {
  context: Context;
  selection: { service_id: string; resource_id: string; day: string } | null;
  slots: Slot[];
};
type Context = {
  mode?: "appointments" | "tables";
  timezone?: string | null;
  business_name: string;
  branch_name: string;
  services: BookingService[];
  resources: { id: string; name: string; timezone: string }[];
  horizon_days: number;
  manage_cutoff_hours: number;
};
export default function PublicBookingView() {
  const { token = "" } = useParams();
  return <BookingPage key={token} token={token} />;
}
/**
 * The public booking page. With `preview`, it renders server-built preview data
 * for the owner (unsaved settings) without calling public endpoints.
 */
export function BookingPage({ token, preview }: { token: string; preview?: BookingPreviewData }) {
  useDocumentTitle(preview ? false : "Reserva una cita");
  const online = useOnline();
  const [context, setContext] = useState<Context | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [serviceId, setServiceId] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [day, setDay] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotLoading, setSlotLoading] = useState(false);
  const [slotError, setSlotError] = useState("");
  const [slotAttempt, setSlotAttempt] = useState(0);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [receipt, setReceipt] = useState<BookingReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const formHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (selected) formHeading.current?.focus();
  }, [selected]);
  const locked = useRef(false);
  const operation = useRef({ signature: "", key: "" });
  const alive = useRef(true);
  const identity = useRef(
    new URLSearchParams(window.location.hash.slice(1)).get("identity"),
  );
  const [params] = useSearchParams();
  const menu = params.get("menu");
  const [identityReady, setIdentityReady] = useState(!menu);
  const [identityError, setIdentityError] = useState("");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (preview) {
      setContext(preview.context);
      setServiceId(preview.selection?.service_id ?? "");
      setResourceId(preview.selection?.resource_id ?? "");
      setDay(preview.selection?.day ?? "");
      return;
    }
    const controller = new AbortController();
    setError("");
    setContext(null);
    void publicBookingRequest<Context>(
      `/context?page_token=${encodeURIComponent(token)}`,
      undefined,
      undefined,
      controller.signal,
    )
      .then(setContext)
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "No pudimos abrir la agenda.",
          );
      });
    return () => controller.abort();
  }, [token, attempt, preview]);
  useEffect(() => {
    if (!menu) return;
    const controller = new AbortController();
    setIdentityReady(false);
    setIdentityError("");
    void fetch("/api/v1/public/loyalty/membership/booking-grant", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...csrfHeaders("POST") },
      body: JSON.stringify({ menu_token: menu, page_token: token }),
    })
      .then(async (r) => {
        if (!r.ok)
          throw new Error(
            "No pudimos reconocer tu tarjeta. Vuelve a abrir la agenda desde tu tarjeta o continúa como invitado.",
          );
        const result = (await r.json()) as { identity_token: string | null };
        if (!controller.signal.aborted) {
          identity.current = result.identity_token;
          setIdentityReady(true);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setIdentityError(
            e instanceof Error ? e.message : "No pudimos reconocer tu tarjeta.",
          );
      });
    return () => controller.abort();
  }, [menu, token]);
  const service = context?.services.find((s) => s.id === serviceId);
  const resources =
    context?.resources.filter((r) => service?.resource_ids.includes(r.id)) ??
    [];
  const resource = resources.find((r) => r.id === resourceId);
  const today = dateKey(new Date(), resource?.timezone);
  useEffect(() => {
    setSlots([]);
    setSelected(null);
    setSlotError("");
    if (preview) {
      setSlots(preview.slots);
      setSlotLoading(false);
      return;
    }
    if (!serviceId || !resourceId || !day) {
      setSlotLoading(false);
      return;
    }
    const controller = new AbortController();
    setSlotLoading(true);
    void publicBookingRequest<{ items: Slot[] }>(
      `/slots?page_token=${encodeURIComponent(token)}&service_id=${encodeURIComponent(serviceId)}&resource_id=${encodeURIComponent(resourceId)}&day=${day}`,
      undefined,
      undefined,
      controller.signal,
    )
      .then((r) => {
        if (!controller.signal.aborted) setSlots(r.items);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setSlotError(
            e instanceof Error
              ? e.message
              : "No pudimos consultar los horarios.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setSlotLoading(false);
      });
    return () => controller.abort();
  }, [token, serviceId, resourceId, day, slotAttempt, preview]);
  const submit = async () => {
    if (locked.current || !selected || !online || !identityReady) return;
    const body = {
      page_token: token,
      service_id: serviceId,
      resource_id: resourceId,
      starts_at: selected.starts_at,
      name: name.trim(),
      phone: phone.trim(),
      identity_token: identity.current,
    };
    const signature = JSON.stringify(body);
    if (operation.current.signature !== signature)
      operation.current = { signature, key: crypto.randomUUID() };
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await publicBookingRequest<BookingReceipt>(
        "",
        body,
        operation.current.key,
      );
      if (alive.current) setReceipt(result);
    } catch (e) {
      if (alive.current) {
        setError(
          e instanceof Error ? e.message : "No pudimos confirmar la reserva.",
        );
        if (e instanceof BookingError && e.status === 409)
          setSlotAttempt((a) => a + 1);
      }
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  if (context?.mode === "tables")
    return (
      <PublicTableRequest
        token={token}
        preview={Boolean(preview)}
        context={context}
        identityToken={identity.current}
        identityReady={identityReady}
        identityError={identityError}
        onGuest={() => {
          identity.current = null;
          setIdentityReady(true);
          setIdentityError("");
        }}
      />
    );
  return (
    <main className="min-h-screen bg-[#FAFAF7] px-4 py-6 text-kova-ink sm:py-12">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="space-y-2">
          <p className="flex items-center gap-2 text-xs font-medium text-kova-muted">
            <CalendarDays className="h-4 w-4" />
            Reservas en línea
          </p>
          <h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">
            {context?.business_name ?? "Reserva una cita"}
          </h1>
          {context && (
            <p className="flex items-center gap-1 text-sm text-kova-muted">
              <MapPin className="h-4 w-4 shrink-0" />
              {context.branch_name}
            </p>
          )}
        </header>
        {!online && (
          <p role="status" className="rounded-xl border bg-white p-4 text-sm">
            Conéctate a internet para consultar horarios y confirmar tu reserva.
            Tus datos siguen aquí.
          </p>
        )}
        {error && (
          <ViewError
            retryLabel="Volver a consultar"
            message={error}
            onRetry={() => {
              if (!context) setAttempt((a) => a + 1);
              else setError("");
            }}
          />
        )}
        {!context && !error && (
          <SectionSkeleton label="Consultando agenda…" variant="form" />
        )}
        {receipt ? (
          <Confirmation receipt={receipt} />
        ) : (
          context && (
            <div className="grid items-start gap-0 overflow-hidden rounded-3xl border border-kova-border bg-white shadow-sm md:grid-cols-[.8fr_1.2fr]">
              <section
                aria-label="Servicio y persona"
                className="space-y-5 border-b border-kova-border p-5 sm:p-7 md:border-b-0 md:border-r"
              >
                <h2 className="text-lg font-semibold">
                  ¿Qué servicio necesitas?
                </h2>
                <div className="space-y-3">
                  {context.services.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      disabled={busy}
                      aria-pressed={serviceId === s.id}
                      onClick={() => {
                        setServiceId(s.id);
                        const eligible = context.resources.filter((r) =>
                          s.resource_ids.includes(r.id),
                        );
                        setResourceId(
                          eligible.length === 1 ? eligible[0].id : "",
                        );
                        setDay("");
                        setSelected(null);
                      }}
                      className={`w-full space-y-2 rounded-xl border p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-kova-blue ${serviceId === s.id ? "border-kova-blue bg-kova-blue/5" : "border-kova-border hover:bg-kova-mist"}`}
                    >
                      <span className="block break-words font-semibold">
                        {s.name}
                      </span>
                      {s.description && (
                        <span className="block break-words text-sm text-kova-muted">
                          {s.description}
                        </span>
                      )}
                      <span className="flex items-center gap-2 text-xs text-kova-muted">
                        <Clock className="h-3.5 w-3.5" />
                        {s.duration_minutes} minutos
                      </span>
                    </button>
                  ))}
                  {!context.services.length && (
                    <p className="text-sm text-kova-muted">
                      El negocio no tiene servicios disponibles para reservar.
                      Consulta al equipo.
                    </p>
                  )}
                </div>
                {service && (
                  <div className="space-y-2">
                    <Label htmlFor="public-booking-resource">
                      ¿Con quién o en qué espacio?
                    </Label>
                    <Select
                      id="public-booking-resource"
                      disabled={busy}
                      value={resourceId}
                      onChange={(e) => {
                        setResourceId(e.target.value);
                        setDay("");
                      }}
                    >
                      <option value="">Elige una opción</option>
                      {resources.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </Select>
                    {!resources.length && (
                      <p className="text-sm text-kova-muted">
                        Este servicio no tiene personas o espacios disponibles.
                      </p>
                    )}
                  </div>
                )}
                <p className="text-xs leading-relaxed text-kova-muted">
                  Tu horario se confirma al terminar. No se solicita pago por
                  adelantado.
                </p>
              </section>
              <section
                aria-label="Día y horario"
                className="min-w-0 space-y-5 p-5 sm:p-7"
              >
                {resource ? (
                  <>
                    <DatePicker
                      key={resource.id}
                      min={today}
                      max={addDays(today, context.horizon_days)}
                      value={day}
                      onChange={(value) => {
                        if (!busy) setDay(value);
                      }}
                    />
                    <p className="text-xs text-kova-muted">
                      Hora de {resource.name}:{" "}
                      {appointmentTimezoneLabel(resource.timezone)}
                    </p>
                    {day && (
                      <div className="space-y-3">
                        <h2 className="font-semibold">Horarios disponibles</h2>
                        {slotLoading ? (
                          <SectionSkeleton
                            label="Consultando horarios…"
                            variant="list"
                          />
                        ) : slotError ? (
                          <ViewError
                            retryLabel="Volver a consultar"
                            message={slotError}
                            onRetry={() => setSlotAttempt((a) => a + 1)}
                          />
                        ) : (
                          <>
                            {selected ? (
                              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-kova-mist p-3">
                                <p className="text-sm font-semibold">
                                  {formatAppointmentTime(
                                    selected.starts_at,
                                    selected.timezone,
                                  )}
                                </p>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  disabled={busy}
                                  onClick={() => setSelected(null)}
                                >
                                  Elegir otro horario
                                </Button>
                              </div>
                            ) : (
                              <div
                                role="group"
                                aria-label="Opciones de horario"
                                className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto rounded-lg p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-kova-blue sm:grid-cols-3"
                              >
                                {slots.map((slot) => (
                                  <Button
                                    key={slot.starts_at}
                                    type="button"
                                    className="text-xs"
                                    disabled={busy}
                                    variant="outline"
                                    onClick={() => setSelected(slot)}
                                  >
                                    {new Intl.DateTimeFormat("es-MX", {
                                      timeZone: slot.timezone,
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      timeZoneName: "shortOffset",
                                    }).format(new Date(slot.starts_at))}
                                  </Button>
                                ))}
                              </div>
                            )}
                            {!slots.length && (
                              <p className="rounded-xl bg-kova-mist p-4 text-sm">
                                No hay horarios disponibles este día. Elige otra
                                fecha.
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    {selected && (
                      <form
                        className="space-y-4 border-t pt-5"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void submit();
                        }}
                      >
                        <h2
                          ref={formHeading}
                          tabIndex={-1}
                          className="text-lg font-semibold outline-none"
                        >
                          Tus datos para confirmar
                        </h2>
                        <p className="text-sm text-kova-muted">
                          {formatAppointmentTime(
                            selected.starts_at,
                            selected.timezone,
                          )}
                        </p>
                        {identityError && (
                          <div className="space-y-2">
                            <p role="alert" className="text-sm">
                              {identityError}
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                identity.current = null;
                                setIdentityReady(true);
                                setIdentityError("");
                              }}
                            >
                              Continuar como invitado
                            </Button>
                          </div>
                        )}
                        <fieldset className="space-y-3" disabled={busy}>
                          <div className="space-y-2">
                            <Label htmlFor="booking-name">Nombre</Label>
                            <Input
                              id="booking-name"
                              autoComplete="name"
                              value={name}
                              maxLength={160}
                              required
                              onChange={(e) => setName(e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="booking-phone">
                              Teléfono de contacto
                            </Label>
                            <Input
                              id="booking-phone"
                              type="tel"
                              autoComplete="tel"
                              value={phone}
                              minLength={7}
                              maxLength={30}
                              pattern="[+0-9 ()-]+"
                              required
                              onChange={(e) => setPhone(e.target.value)}
                            />
                          </div>
                        </fieldset>
                        <p className="text-xs text-kova-muted">
                          El negocio usará estos datos para atender tu cita.{" "}
                          <a
                            className="underline"
                            href="/privacy"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Privacidad
                          </a>
                        </p>
                        <Button
                          disabled={
                            busy ||
                            !online ||
                            !identityReady ||
                            !name.trim() ||
                            phone.trim().length < 7
                          }
                        >
                          {busy ? "Confirmando…" : "Confirmar mi reserva"}
                        </Button>
                      </form>
                    )}
                  </>
                ) : (
                  <div className="py-12 text-center">
                    <CalendarDays
                      className="mx-auto mb-4 h-9 w-9 text-kova-blue"
                      aria-hidden="true"
                    />
                    <h2 className="font-semibold">
                      Encuentra tu próximo horario
                    </h2>
                    <p className="mt-2 text-sm text-kova-muted">
                      Elige un servicio y una persona o espacio para ver su
                      disponibilidad.
                    </p>
                  </div>
                )}
              </section>
            </div>
          )
        )}
        <footer className="text-center text-xs text-kova-muted">
          Reservas con Kova
        </footer>
      </div>
    </main>
  );
}
export function Confirmation({ receipt }: { receipt: BookingReceipt }) {
  return (
    <section
      aria-label="Confirmación de reserva"
      className="mx-auto max-w-xl space-y-5 rounded-3xl border border-kova-border bg-white p-6 sm:p-8"
    >
      <CheckCircle2
        className="h-10 w-10 text-kova-growth-strong"
        aria-hidden="true"
      />
      <h1 className="text-2xl font-semibold">Tu cita está confirmada</h1>
      <div className="space-y-2">
        <p className="break-words font-semibold">{receipt.title}</p>
        <p className="text-sm">{receipt.resource_name}</p>
        <p className="text-sm">
          {formatAppointmentTime(receipt.starts_at, receipt.timezone)}
        </p>
        <p className="text-xs text-kova-muted">
          Horario de {appointmentTimezoneLabel(receipt.timezone)}
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => downloadCalendar(receipt)}
        >
          Agregar a mi calendario
        </Button>
        {receipt.manage_path && (
          <a
            className="inline-flex min-h-11 items-center rounded-lg bg-kova-blue px-4 py-2 text-sm font-medium text-white"
            href={receipt.manage_path}
          >
            Ver y gestionar mi cita
          </a>
        )}
      </div>
      <p className="text-sm text-kova-muted">
        Guarda tu enlace privado para consultar, reprogramar o cancelar.
        Compártelo solo con quien deba gestionar esta cita.
      </p>
      {receipt.manage_path && (
        <label htmlFor="booking-private-link" className="block text-sm">
          Tu enlace privado
          <Input
            id="booking-private-link"
            readOnly
            value={new URL(receipt.manage_path, window.location.origin).href}
            onFocus={(e) => e.target.select()}
          />
        </label>
      )}
    </section>
  );
}
