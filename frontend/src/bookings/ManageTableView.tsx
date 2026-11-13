import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ViewError } from "@/components/ui/view-states";
import { SectionSkeleton } from "@/components/ui/section-skeleton";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useOnline } from "@/automations/workspace";
import type { TableArrival, TableReceipt } from "@/appointments/bookingTypes";
import { formatAppointmentTime } from "@/appointments/timezone";
import { publicBookingRequest } from "./api";
import { addDays, dateKey, DatePicker } from "./DatePicker";
import { TableReceiptView } from "./PublicTableRequest";
import { downloadCalendar } from "./calendarFile";

export default function ManageTableView() {
  useDocumentTitle("Tu solicitud de mesa");
  const online = useOnline();
  const token = useRef(window.location.hash.slice(1));
  const [receipt, setReceipt] = useState<TableReceipt | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<"cancel" | "reschedule" | null>(null);
  const [day, setDay] = useState("");
  const [arrivals, setArrivals] = useState<TableArrival[]>([]);
  const [selected, setSelected] = useState<TableArrival | null>(null);
  const [loadingArrivals, setLoadingArrivals] = useState(false);
  const [arrivalError, setArrivalError] = useState("");
  const [arrivalAttempt, setArrivalAttempt] = useState(0);
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
    setLoading(true);
    setError("");
    if (!token.current) {
      setError("Abre el enlace privado que recibiste al solicitar tu mesa.");
      setLoading(false);
      return;
    }
    void publicBookingRequest<TableReceipt>(
      "/table-manage/read",
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
            e instanceof Error
              ? e.message
              : "No pudimos consultar tu solicitud.",
          );
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [attempt]);
  useEffect(() => {
    setSelected(null);
    setArrivals([]);
    setArrivalError("");
    if (action !== "reschedule" || !day) {
      setLoadingArrivals(false);
      return;
    }
    const c = new AbortController();
    setLoadingArrivals(true);
    void publicBookingRequest<{ items: TableArrival[] }>(
      `/table-manage/arrivals?day=${day}`,
      { token: token.current },
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
        if (!c.signal.aborted) setLoadingArrivals(false);
      });
    return () => c.abort();
  }, [day, action, arrivalAttempt]);
  const confirm = async () => {
    if (
      !receipt ||
      !action ||
      !online ||
      lock.current ||
      (action === "reschedule" && !selected)
    )
      return;
    const body = {
      token: token.current,
      expected_version: receipt.version,
      action,
      ...(action === "reschedule" ? { starts_at: selected?.starts_at } : {}),
    };
    const signature = JSON.stringify(body);
    if (operation.current.signature !== signature)
      operation.current = { signature, key: crypto.randomUUID() };
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await publicBookingRequest<TableReceipt>(
        "/table-manage",
        body,
        operation.current.key,
      );
      if (alive.current) {
        setReceipt(r);
        setNotice(
          action === "cancel"
            ? "Solicitud cancelada."
            : "Nueva hora solicitada. El negocio debe volver a confirmar la mesa.",
        );
        setAction(null);
        setDay("");
      }
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error
            ? e.message
            : "No pudimos actualizar tu solicitud.",
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
        <h1 className="text-2xl font-semibold">Tu solicitud de mesa</h1>
        {!online && (
          <p role="status">Conéctate para consultar o cambiar tu solicitud.</p>
        )}
        {loading && (
          <SectionSkeleton
            label="Consultando tu solicitud…"
            variant="summary"
          />
        )}
        {error && (
          <ViewError
            retryLabel="Volver a consultar"
            message={error}
            onRetry={() => setAttempt((a) => a + 1)}
          />
        )}
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
        {receipt && (
          <>
            <TableReceiptView receipt={receipt} />
            <Button
              variant="outline"
              disabled={busy || loading || !online}
              onClick={() => setAttempt((a) => a + 1)}
            >
              Actualizar estado
            </Button>
            {["confirmed", "seated"].includes(receipt.status) && (
              <Button
                variant="outline"
                onClick={() => downloadCalendar(receipt)}
              >
                Descargar llegada al calendario
              </Button>
            )}
            {receipt.can_manage ? (
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  disabled={busy || !online}
                  onClick={() => setAction("reschedule")}
                >
                  Solicitar otra hora
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !online}
                  onClick={() => setAction("cancel")}
                >
                  Cancelar solicitud
                </Button>
              </div>
            ) : (
              <p className="text-sm text-kova-muted">
                Para cualquier cambio, contacta al negocio.
              </p>
            )}
            {action && receipt.can_manage && (
              <section
                aria-label="Cambiar solicitud de mesa"
                className="space-y-4 rounded-xl border border-kova-border p-4"
              >
                <h2 className="font-semibold">
                  {action === "cancel"
                    ? "¿Cancelar tu solicitud?"
                    : "Solicitar otra hora de llegada"}
                </h2>
                {action === "reschedule" && (
                  <>
                    <p className="text-sm text-kova-muted">
                      Se retira la confirmación anterior. El negocio debe
                      aceptar la nueva hora.
                    </p>
                    <DatePicker
                      value={day}
                      min={today}
                      max={addDays(today, 366)}
                      onChange={setDay}
                    />
                    {loadingArrivals && (
                      <SectionSkeleton
                        label="Consultando horas de llegada…"
                        variant="list"
                      />
                    )}
                    {arrivalError && (
                      <ViewError
                        retryLabel="Volver a consultar"
                        message={arrivalError}
                        onRetry={() => setArrivalAttempt((a) => a + 1)}
                      />
                    )}
                    {day &&
                      !loadingArrivals &&
                      !arrivalError &&
                      !arrivals.length && (
                        <p role="status">No se reciben solicitudes ese día.</p>
                      )}
                    <div className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto">
                      {arrivals.map((a) => (
                        <Button
                          key={a.starts_at}
                          disabled={busy}
                          variant={
                            selected?.starts_at === a.starts_at
                              ? "default"
                              : "outline"
                          }
                          onClick={() => setSelected(a)}
                        >
                          {formatAppointmentTime(a.starts_at, a.timezone)}
                        </Button>
                      ))}
                    </div>
                  </>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={
                      busy || !online || (action === "reschedule" && !selected)
                    }
                    onClick={() => void confirm()}
                  >
                    {action === "cancel"
                      ? "Sí, cancelar solicitud"
                      : "Enviar nueva solicitud"}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setAction(null);
                      setDay("");
                    }}
                  >
                    Volver
                  </Button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
