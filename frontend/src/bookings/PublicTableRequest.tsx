import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ViewError } from "@/components/ui/view-states";
import { SectionSkeleton } from "@/components/ui/section-skeleton";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useOnline } from "@/automations/workspace";
import type { TableArrival, TableReceipt } from "@/appointments/bookingTypes";
import {
  appointmentTimezoneLabel,
  formatAppointmentTime,
} from "@/appointments/timezone";
import { BookingError, publicBookingRequest } from "./api";
import { addDays, dateKey, DatePicker } from "./DatePicker";
import { tableStatusText } from "./tableStatus";

export function TableReceiptView({ receipt }: { receipt: TableReceipt }) {
  return (
    <section
      aria-label="Estado de tu solicitud de mesa"
      className="space-y-3 rounded-2xl border border-kova-border bg-white p-5"
    >
      <h2 className="text-xl font-semibold">
        {receipt.status === "requested"
          ? "Solicitud recibida"
          : tableStatusText[receipt.status]}
      </h2>
      <p role="status" className="font-medium">
        {tableStatusText[receipt.status]}
      </p>
      {receipt.status === "requested" && (
        <p className="text-sm text-kova-muted">
          Tu mesa aún no está confirmada. El negocio revisará la disponibilidad;
          consulta el estado desde tu enlace privado antes de acudir.
        </p>
      )}
      <p>
        Hora de llegada:{" "}
        {formatAppointmentTime(receipt.starts_at, receipt.timezone)}
      </p>
      <p className="text-sm text-kova-muted">
        {appointmentTimezoneLabel(receipt.timezone)} · {receipt.party_size}{" "}
        {receipt.party_size === 1 ? "persona" : "personas"}
      </p>
      {receipt.resource_name && <p>Mesa: {receipt.resource_name}</p>}
      <p className="text-sm text-kova-muted">
        No se fija una hora de salida ni se cobra un anticipo.
      </p>
    </section>
  );
}

export function PublicTableRequest({
  token,
  context,
  identityToken,
  identityReady,
  identityError,
  onGuest,
  preview = false,
}: {
  token: string;
  context: {
    business_name: string;
    branch_name: string;
    timezone?: string | null;
    horizon_days: number;
  };
  identityToken: string | null;
  identityReady: boolean;
  identityError: string;
  onGuest: () => void;
  /** Owner preview: never changes the document title. */
  preview?: boolean;
}) {
  useDocumentTitle(preview ? false : "Solicitar una mesa");
  const online = useOnline();
  const [day, setDay] = useState("");
  const [arrivals, setArrivals] = useState<TableArrival[]>([]);
  const [selected, setSelected] = useState<TableArrival | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [arrivalError, setArrivalError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [party, setParty] = useState("2");
  const [receipt, setReceipt] = useState<TableReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const lock = useRef(false);
  const operation = useRef({ signature: "", key: "" });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (selected) heading.current?.focus();
  }, [selected]);
  useEffect(() => {
    setSelected(null);
    setArrivals([]);
    setArrivalError("");
    if (!day) {
      setLoading(false);
      return;
    }
    const c = new AbortController();
    setLoading(true);
    void publicBookingRequest<{ items: TableArrival[] }>(
      `/table-arrivals?page_token=${encodeURIComponent(token)}&day=${day}`,
      undefined,
      undefined,
      c.signal,
    )
      .then((r) => {
        if (!c.signal.aborted) setArrivals(r.items);
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setArrivalError(
            e instanceof Error
              ? e.message
              : "No pudimos consultar los horarios.",
          );
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [token, day, attempt]);
  const submit = async () => {
    if (!selected || !online || !identityReady || lock.current) return;
    const body = {
      page_token: token,
      starts_at: selected.starts_at,
      name: name.trim(),
      phone: phone.trim(),
      party_size: Number(party),
      identity_token: identityToken,
    };
    const signature = JSON.stringify(body);
    if (operation.current.signature !== signature)
      operation.current = { signature, key: crypto.randomUUID() };
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await publicBookingRequest<TableReceipt>(
        "/table-requests",
        body,
        operation.current.key,
      );
      if (alive.current) setReceipt(r);
    } catch (e) {
      if (alive.current) {
        setError(
          e instanceof Error ? e.message : "No pudimos enviar tu solicitud.",
        );
        if (e instanceof BookingError && e.status === 409)
          setAttempt((a) => a + 1);
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const today = dateKey(new Date(), context.timezone ?? undefined);
  return (
    <main className="min-h-screen bg-[#FAFAF7] px-4 py-8 text-kova-ink">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-2">
          <p className="text-xs font-medium text-kova-muted">
            Solicitudes de mesa
          </p>
          <h1 className="break-words text-2xl font-semibold">
            {context.business_name}
          </h1>
          <p className="text-sm text-kova-muted">{context.branch_name}</p>
        </header>
        {receipt ? (
          <>
            <TableReceiptView receipt={receipt} />
            {receipt.manage_path?.startsWith("/reservar/mesa#") && (
              <a
                className="inline-flex min-h-11 items-center font-medium underline"
                href={receipt.manage_path}
              >
                Consultar mi solicitud y guardar enlace privado
              </a>
            )}
            <p className="text-sm text-kova-muted">
              Conserva ese enlace para consultar la respuesta del negocio. No se
              ha enviado una confirmación por WhatsApp ni por correo.
            </p>
          </>
        ) : (
          <>
            <section className="space-y-2">
              <h2 className="text-xl font-semibold">Solicita una mesa</h2>
              <p className="text-sm text-kova-muted">
                Elige tu hora de llegada. El equipo revisará tu solicitud y
                confirmará si puede recibirte. No necesitas elegir una hora de
                salida.
              </p>
            </section>
            {!online && (
              <p role="status">
                Conéctate para enviar tu solicitud. Tus datos se conservan.
              </p>
            )}
            {identityError && (
              <div role="alert" className="space-y-2">
                <p>{identityError}</p>
                <Button variant="outline" onClick={onGuest}>
                  Continuar como invitado
                </Button>
              </div>
            )}
            {!identityReady && !identityError && (
              <SectionSkeleton
                label="Reconociendo tu tarjeta…"
                variant="notice"
              />
            )}
            {error && (
              <ViewError
                retryLabel="Volver a consultar"
                message={error}
                onRetry={() => setAttempt((a) => a + 1)}
              />
            )}
            <div className="grid items-start gap-6 md:grid-cols-2">
              <section className="min-w-0 space-y-4 rounded-2xl border border-kova-border bg-white p-4">
                <h2 className="font-semibold">Día y hora de llegada</h2>
                <DatePicker
                  value={day}
                  min={today}
                  max={addDays(today, context.horizon_days)}
                  onChange={setDay}
                />
                {context.timezone && (
                  <p className="text-xs text-kova-muted">
                    Horario de {appointmentTimezoneLabel(context.timezone)}
                  </p>
                )}
                {loading && (
                  <SectionSkeleton
                    label="Consultando horas de llegada…"
                    variant="list"
                  />
                )}
                {arrivalError && (
                  <ViewError
                    retryLabel="Volver a consultar"
                    message={arrivalError}
                    onRetry={() => setAttempt((a) => a + 1)}
                  />
                )}
                {day && !loading && !arrivalError && !arrivals.length && (
                  <p role="status" className="text-sm text-kova-muted">
                    No se reciben solicitudes ese día. Elige otra fecha.
                  </p>
                )}
                {arrivals.length > 0 && (
                  <p className="text-xs text-kova-muted">
                    Estas horas admiten solicitudes; la mesa está sujeta a
                    confirmación del negocio.
                  </p>
                )}
                {!selected ? (
                  <div
                    className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto"
                    aria-label="Horas para solicitar una mesa"
                  >
                    {arrivals.map((a) => (
                      <Button
                        key={a.starts_at}
                        variant="outline"
                        disabled={busy}
                        onClick={() => setSelected(a)}
                      >
                        {new Intl.DateTimeFormat("es-MX", {
                          timeZone: a.timezone,
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZoneName: "shortOffset",
                        }).format(new Date(a.starts_at))}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">
                      {formatAppointmentTime(
                        selected.starts_at,
                        selected.timezone,
                      )}
                    </p>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => setSelected(null)}
                    >
                      Elegir otra hora
                    </Button>
                  </div>
                )}
              </section>
              <form
                className="min-w-0 space-y-4 rounded-2xl border border-kova-border bg-white p-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <h2
                  ref={heading}
                  tabIndex={-1}
                  className="font-semibold outline-none"
                >
                  Datos de tu solicitud
                </h2>
                <fieldset disabled={busy} className="space-y-4">
                  <div className="space-y-1">
                    <Label htmlFor="table-party">
                      ¿Cuántas personas vendrán?
                    </Label>
                    <Input
                      id="table-party"
                      type="number"
                      min={1}
                      max={50}
                      required
                      value={party}
                      onChange={(e) => setParty(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="table-name">Tu nombre</Label>
                    <Input
                      id="table-name"
                      autoComplete="name"
                      maxLength={160}
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="table-phone">Teléfono de contacto</Label>
                    <Input
                      id="table-phone"
                      type="tel"
                      autoComplete="tel"
                      required
                      minLength={7}
                      maxLength={30}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                </fieldset>
                <p className="text-xs text-kova-muted">
                  Se envía una solicitud, sin cobro. La reserva sólo queda
                  confirmada cuando el negocio la acepta.
                </p>
                <Button
                  className="w-full"
                  disabled={
                    !selected ||
                    busy ||
                    !online ||
                    !identityReady ||
                    !name.trim() ||
                    phone.trim().length < 7 ||
                    Number(party) < 1 ||
                    Number(party) > 50
                  }
                >
                  {busy ? "Enviando solicitud…" : "Solicitar mesa"}
                </Button>
              </form>
            </div>
          </>
        )}
        <footer className="text-center text-xs text-kova-muted">
          Reservas con Kova
        </footer>
      </div>
    </main>
  );
}
