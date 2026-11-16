import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Link } from "react-router-dom";
import { useOnline, useOperationsRequest, type WorkspaceIdentity } from "@/automations/workspace";
import { Button } from "@/components/ui/button";
import { SectionSkeleton } from "@/components/ui/section-skeleton";
import { ViewEmpty, ViewError } from "@/components/ui/view-states";

export type ReservationNotice = {
  id: string;
  source: "appointment" | "booking" | "reservation";
  source_id: string;
  kind: "confirmation" | "reminder";
  recipient_name: string;
  body: string;
  starts_at: string;
  due_at: string;
  timezone: string;
  status: "scheduled" | "prepared";
  contact_status: "customer_required" | "inactive" | "contact_mismatch" | "contact_changed" | "permitted" | "consent_required";
};
type SendingSettings = { platform_available: boolean; enabled: boolean; version: number; daily_limit: number; can_manage: boolean };
type Notices = { items: ReservationNotice[]; has_more: boolean; send_enabled: boolean; sending_settings?: SendingSettings };
const contactLabels: Record<ReservationNotice["contact_status"], string> = {
  customer_required: "Falta vincular al cliente y revisar su permiso de contacto.",
  inactive: "Revisa el cliente o la persona o espacio: está desactivado.",
  contact_mismatch: "El teléfono de la reserva no coincide con el del cliente vinculado.",
  contact_changed: "El teléfono cambió después de preparar este aviso. Revisa el contacto.",
  permitted: "Permiso de contacto registrado. Este aviso aún no se ha enviado.",
  consent_required: "Falta registrar el permiso del cliente para recibir avisos por WhatsApp.",
};
function formatDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value));
}

export default function ReservationNoticesPanel({ identity }: { identity: WorkspaceIdentity }) {
  const request = useOperationsRequest("/api/v1/messaging/reservation-notices", identity);
  const online = useOnline();
  const [data, setData] = useState<Notices | null>(null);
  const [offset, setOffset] = useState(0);
  const [acceptCosts, setAcceptCosts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [error, setError] = useState("");
  const generation = useRef(0);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setData(null); setError("");
    try {
      const result = await request<Notices>(`?limit=20&offset=${offset}`);
      if (generation.current === current) setData(result);
    } catch {
      if (generation.current === current) setError("No pudimos consultar los avisos de reservas. Revisa tu conexión e intenta de nuevo.");
    }
  }, [request, offset]);
  useEffect(() => {
    if (online) void load();
    else { invalidate(); setData(null); setError(""); }
    return invalidate;
  }, [load, online, invalidate]);
  const configure = async (enabled: boolean) => {
    if (!data?.sending_settings || saving || !online) return;
    const current = generation.current;
    setSaving(true); setSaveError("");
    try {
      await request("/settings", "PUT", {
        expected_version: data.sending_settings.version, enabled,
        daily_limit: data.sending_settings.daily_limit, accept_costs: acceptCosts,
      });
      if (generation.current === current) { setAcceptCosts(false); await load(); }
    } catch {
      if (generation.current === current) setSaveError("No pudimos cambiar los avisos. Actualiza y revisa la conexión y las plantillas antes de intentar de nuevo.");
    } finally { if (generation.current === current || generation.current === current + 1) setSaving(false); }
  };
  return <section aria-labelledby="reservation-notices-title" className="space-y-4 rounded-2xl border border-kova-border bg-white p-5 sm:p-6">
    <div className="space-y-2">
      <h2 id="reservation-notices-title" className="text-xl font-semibold">Avisos de reservas</h2>
      <p className="text-sm font-medium">{data?.send_enabled ? "Avisos automáticos activados" : "Envíos desactivados"}</p>
      <p className="max-w-2xl text-sm text-kova-muted">Revisa la confirmación y el recordatorio de 24 horas de tus próximas reservas. Esta lista muestra vistas previas privadas: no se ha enviado ningún aviso de esta lista. Los envíos procesados se consultan en la bandeja.</p>
      <p className="max-w-2xl text-sm text-kova-muted">La activación requiere aprobación de Meta, plantillas aprobadas, una prueba de entrega y autorización del dueño. Los avisos acumulados no se enviarán al activar el canal.</p>
    </div>
    {!online ? <p role="status" className="text-sm">Conéctate a internet para consultar los avisos vigentes.</p>
      : error ? <ViewError message={error} onRetry={() => void load()} retryLabel="Consultar avisos de nuevo" />
      : !data ? <SectionSkeleton label="Consultando avisos de reservas…" variant="form" />
      : <>
        {data.sending_settings?.can_manage && <div className="space-y-3 rounded-xl border border-kova-border p-4">
          <h3 className="font-semibold">Envío automático de esta sucursal</h3>
          <p className="text-sm text-kova-muted">Límite: {data.sending_settings.daily_limit} intentos diarios. Meta puede cobrar por las plantillas entregadas. Activar sólo incluye reservas nuevas o reprogramadas después de la activación.</p>
          {!data.sending_settings.platform_available && <p className="text-sm">La activación está bloqueada mientras se completa la aprobación y la prueba con Meta.</p>}
          {!data.sending_settings.enabled && <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={acceptCosts} onChange={event => setAcceptCosts(event.target.checked)} disabled={!online || saving || !data.sending_settings.platform_available} />Autorizo los avisos de reservas y acepto los cargos de Meta que correspondan.</label>}
          <Button disabled={!online || saving || (!data.sending_settings.enabled && (!data.sending_settings.platform_available || !acceptCosts))} onClick={() => void configure(!data.sending_settings!.enabled)}>{saving ? "Guardando…" : data.sending_settings.enabled ? "Desactivar avisos automáticos" : "Activar avisos automáticos"}</Button>
          {saveError && <p role="alert" className="text-sm">{saveError}</p>}
        </div>}
        {data.items.length === 0 ? <ViewEmpty icon={<CalendarClock aria-hidden="true" />} title="Sin avisos en esta página" body="Las nuevas reservas confirmadas preparan sus avisos aquí. Las solicitudes de mesa esperan la confirmación del negocio; las reservas con menos de 24 horas de anticipación preparan sólo la confirmación." primaryCta={{ label: "Revisar agenda", to: "/appointments" }} />
          : <ul className="grid gap-4 lg:grid-cols-2">{data.items.map(item => <li key={item.id} className="min-w-0 space-y-3 rounded-xl border border-kova-border p-4">
            <div><h3 className="font-semibold">{item.kind === "confirmation" ? "Confirmación de reserva" : "Recordatorio de reserva"}</h3><p className="mt-1 break-words text-sm">{item.recipient_name}</p></div>
            <p className="text-sm text-kova-muted">Reserva: {formatDate(item.starts_at, item.timezone)} · hora del lugar</p>
            {item.kind === "reminder" && <p className="text-sm text-kova-muted">Previsto para: {formatDate(item.due_at, item.timezone)}</p>}
            <p className="whitespace-pre-wrap break-words rounded-xl bg-kova-mist p-4 text-sm leading-6">{item.body}</p>
            <p className="text-sm">{contactLabels[item.contact_status]}</p>
            <p className="text-xs text-kova-muted">{item.status === "scheduled" ? "Fecha prevista pendiente · sin envío" : "Preparado · sin envío"}</p>
            <Link className="inline-flex min-h-11 items-center text-sm underline" to={`/appointments?${item.source === "appointment" ? "appointmentId" : item.source === "booking" ? "bookingId" : "tableId"}=${encodeURIComponent(item.source_id)}`}>Revisar esta reserva</Link>
          </li>)}</ul>}
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => void load()}>Actualizar avisos</Button>
          {offset > 0 && <Button variant="outline" onClick={() => setOffset(value => Math.max(0, value - 20))}>Página anterior</Button>}
          {data.has_more && <Button variant="outline" onClick={() => setOffset(value => value + 20)}>Más avisos</Button>}
        </div>
      </>}
  </section>;
}
