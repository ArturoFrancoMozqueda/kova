import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ViewError } from "@/components/ui/view-states";
import { SectionSkeleton } from "@/components/ui/section-skeleton";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useOnline } from "@/automations/workspace";
import {
  appointmentTimezoneLabel,
  formatAppointmentTime,
} from "@/appointments/timezone";
import type { BookingReceipt, Slot } from "@/appointments/bookingTypes";
import { publicBookingRequest } from "./api";
import { addDays, dateKey, DatePicker } from "./DatePicker";
import { downloadCalendar } from "./calendarFile";
export default function ManageBookingView() {
  useDocumentTitle("Tu cita");
  const online = useOnline();
  const token = useRef(window.location.hash.slice(1));
  const [receipt, setReceipt] = useState<BookingReceipt | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [action, setAction] = useState<"cancel" | "reschedule" | null>(null);
  const [day, setDay] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotError, setSlotError] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
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
    const c = new AbortController();
    setError("");
    if (!token.current) {
      setError("Abre el enlace privado que recibiste al reservar.");
      return;
    }
    void publicBookingRequest<BookingReceipt>(
      "/manage/read",
      { token: token.current },
      undefined,
      c.signal,
    )
      .then((r) => {
        if (!c.signal.aborted) setReceipt(r);
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setError(
            e instanceof Error ? e.message : "No pudimos consultar tu cita.",
          );
      });
    return () => c.abort();
  }, [attempt]);
  useEffect(() => {
    setSlots([]);
    setSelected(null);
    setSlotError("");
    if (!day || action !== "reschedule") return;
    const c = new AbortController();
    setLoadingSlots(true);
    void publicBookingRequest<{ items: Slot[] }>(
      `/manage/slots?day=${day}`,
      { token: token.current },
      undefined,
      c.signal,
    )
      .then((r) => {
        if (!c.signal.aborted) setSlots(r.items);
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setSlotError(
            e instanceof Error
              ? e.message
              : "No pudimos consultar los horarios.",
          );
      })
      .finally(() => {
        if (!c.signal.aborted) setLoadingSlots(false);
      });
    return () => c.abort();
  }, [day, action]);
  const confirm = async () => {
    if (!receipt || !action || lock.current || !online) return;
    const body = {
      token: token.current,
      action,
      expected_version: receipt.version,
      ...(action === "reschedule" ? { starts_at: selected?.starts_at } : {}),
    };
    const signature = JSON.stringify(body);
    if (operation.current.signature !== signature)
      operation.current = { signature, key: crypto.randomUUID() };
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await publicBookingRequest<BookingReceipt>(
        "/manage",
        body,
        operation.current.key,
      );
      if (alive.current) {
        setReceipt(result);
        setNotice(
          action === "cancel"
            ? "Tu cita fue cancelada."
            : "Tu nuevo horario está confirmado.",
        );
        setAction(null);
        setDay("");
      }
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error ? e.message : "No pudimos confirmar el cambio.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const today = dateKey(new Date(), receipt?.timezone);
  return (
    <main className="min-h-screen bg-[#FAFAF7] px-4 py-8 text-kova-ink">
      <div className="mx-auto max-w-xl space-y-5">
        <h1 className="text-2xl font-semibold">Tu cita</h1>
        {!online && (
          <p role="status" className="text-sm">
            Conéctate para consultar y cambiar tu cita.
          </p>
        )}
        {error && (
          <ViewError
            retryLabel="Volver a consultar"
            message={error}
            onRetry={() => {
              setAction(null);
              setAttempt((v) => v + 1);
            }}
          />
        )}
        {!receipt && !error && (
          <SectionSkeleton label="Consultando tu cita…" variant="form" />
        )}
        {receipt && (
          <section className="space-y-5 rounded-3xl border border-kova-border bg-white p-5 sm:p-7">
            <div className="space-y-2">
              <h2 className="break-words text-xl font-semibold">
                {receipt.title}
              </h2>
              <p>{receipt.resource_name}</p>
              <p className="text-sm">
                {formatAppointmentTime(receipt.starts_at, receipt.timezone)}
              </p>
              <p className="text-xs text-kova-muted">
                Horario de {appointmentTimezoneLabel(receipt.timezone)}
              </p>
              <p className="text-sm font-medium">
                {receipt.status === "cancelled"
                  ? "Cancelada"
                  : receipt.status === "completed"
                    ? "Atendida"
                    : receipt.status === "no_show"
                      ? "No asistió"
                      : "Confirmada"}
              </p>
            </div>
            {notice && (
              <p role="status" className="text-sm text-kova-growth-strong">
                {notice}
              </p>
            )}
            {receipt.status === "scheduled" && (
              <Button
                type="button"
                variant="outline"
                onClick={() => downloadCalendar(receipt)}
              >
                Agregar a mi calendario
              </Button>
            )}
            {receipt.can_manage ? (
              <>
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    disabled={busy || !online}
                    onClick={() => {
                      setAction("reschedule");
                      setError("");
                    }}
                  >
                    Reprogramar
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || !online}
                    onClick={() => {
                      setAction("cancel");
                      setError("");
                    }}
                  >
                    Cancelar cita
                  </Button>
                </div>
                {action === "reschedule" && (
                  <div className="space-y-4">
                    <DatePicker
                      min={today}
                      max={addDays(today, 366)}
                      value={day}
                      onChange={(value) => {
                        if (!busy) setDay(value);
                      }}
                    />
                    {loadingSlots ? (
                      <SectionSkeleton
                        label="Consultando horarios…"
                        variant="list"
                      />
                    ) : slotError ? (
                      <p role="alert" className="text-sm">
                        {slotError}
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {slots.map((s) => (
                          <Button
                            key={s.starts_at}
                            type="button"
                            disabled={busy}
                            variant={
                              selected?.starts_at === s.starts_at
                                ? "default"
                                : "outline"
                            }
                            aria-pressed={selected?.starts_at === s.starts_at}
                            onClick={() => setSelected(s)}
                          >
                            {new Intl.DateTimeFormat("es-MX", {
                              timeZone: s.timezone,
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZoneName: "shortOffset",
                            }).format(new Date(s.starts_at))}
                          </Button>
                        ))}
                      </div>
                    )}
                    {day && !loadingSlots && !slotError && !slots.length && (
                      <p className="text-sm text-kova-muted">
                        No hay horarios para cambiar tu cita este día. Prueba
                        otra fecha o contacta al negocio.
                      </p>
                    )}
                  </div>
                )}
                {action && (
                  <div className="space-y-3 border-t pt-4">
                    <p className="text-sm">
                      {action === "cancel"
                        ? "¿Confirmas que quieres cancelar esta cita? El horario quedará disponible."
                        : selected
                          ? `Nuevo horario: ${formatAppointmentTime(selected.starts_at, selected.timezone)}`
                          : "Elige el nuevo horario antes de confirmar."}
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <Button
                        disabled={
                          busy ||
                          !online ||
                          (action === "reschedule" && !selected)
                        }
                        onClick={() => void confirm()}
                      >
                        {busy
                          ? "Confirmando…"
                          : action === "cancel"
                            ? "Confirmar cancelación"
                            : "Confirmar nuevo horario"}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setAction(null)}
                      >
                        Volver
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              receipt.status === "scheduled" && (
                <p className="text-sm text-kova-muted">
                  Para cambiar o cancelar esta cita, contacta al negocio.
                </p>
              )
            )}
          </section>
        )}
        <p className="text-center text-xs text-kova-muted">Reservas con Kova</p>
      </div>
    </main>
  );
}
