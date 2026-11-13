import { useEffect, useId, useState } from "react";
import { LivePreview } from "@/components/ui/live-preview";
import { DevicePreview, type PreviewDevice } from "@/components/ui/device-preview";
import { Label } from "@/components/ui/label";
import { SectionSkeleton } from "@/components/ui/section-skeleton";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { BookingPage, type BookingPreviewData } from "@/bookings/PublicBookingView";
import type { Availability, BookingPage as BookingPageSettings } from "./bookingTypes";
import { formatNotice } from "./bookingPreview";

export type BookingPreviewDraft = {
  page?: Pick<BookingPageSettings, "horizon_days" | "notice_minutes" | "slot_minutes" | "manage_cutoff_hours"> & { mode: "appointments" | "tables" };
  availability?: { resource_id: string; weekly: Availability["weekly"]; exceptions: Availability["exceptions"] };
  service_id?: string;
  day?: string;
};
export type LoadBookingPreview = (draft: BookingPreviewDraft) => Promise<BookingPreviewData>;

/**
 * The real public booking page for unsaved settings. The server applies the
 * draft with the public page's own rules (including appointments already
 * booked), so the hours and dates shown are the ones customers would get.
 */
export function BookingPagePreview({
  draft,
  load,
  enabled,
  className,
}: {
  draft: BookingPreviewDraft;
  load: LoadBookingPreview;
  enabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const [device, setDevice] = useState<PreviewDevice>("phone");
  const [serviceId, setServiceId] = useState("");
  const [day, setDay] = useState("");
  const [data, setData] = useState<BookingPreviewData | null>(null);
  const [failed, setFailed] = useState(false);
  const key = JSON.stringify({ ...draft, ...(serviceId ? { service_id: serviceId } : {}), ...(day ? { day } : {}) });
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      load(JSON.parse(key) as BookingPreviewDraft)
        .then(result => { if (active) { setData(result); setFailed(false); } })
        .catch(() => { if (active) setFailed(true); });
    }, 400);
    return () => { active = false; window.clearTimeout(timer); };
  }, [key, load]);

  const context = data?.context;
  const selected = data?.selection;
  const service = context?.services.find(s => s.id === selected?.service_id);
  const tables = context?.mode === "tables";
  const summary = !data
    ? "Preparando la vista previa de reservas."
    : tables
      ? `Página para solicitar mesa en ${context?.business_name}.`
      : selected
        ? `Para ${service?.name ?? "el servicio"}, el ${new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${selected.day}T12:00:00Z`))} tus clientes verían ${data.slots.length} ${data.slots.length === 1 ? "horario" : "horarios"}.`
        : "Tus clientes todavía no verían servicios para reservar.";
  return (
    <LivePreview
      label="Vista previa de reservas en línea"
      summary={summary}
      className={className}
      selfContained
      controls={<div className="space-y-2">
        <SegmentedControl ariaLabel="Ver reservas en" value={device} onValueChange={setDevice}
          options={[{ value: "phone", label: "Teléfono" }, { value: "computer", label: "Computadora" }]} />
        {!tables && context && context.services.length > 0 && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          {context.services.length > 1 && <div className="space-y-1">
            <Label htmlFor={`${id}-service`}>Servicio de ejemplo</Label>
            <Select id={`${id}-service`} value={selected?.service_id ?? ""} onChange={event => { setServiceId(event.target.value); setDay(""); }}>
              {context.services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>}
          {selected && <div className="space-y-1">
            <Label htmlFor={`${id}-day`}>Día de ejemplo</Label>
            <input id={`${id}-day`} type="date" className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
              value={selected.day} onChange={event => setDay(event.target.value)} />
          </div>}
        </div>}
      </div>}
      note={<>
        {enabled === false && <p className="mb-1 font-medium text-kova-ink">El enlace está desactivado: tus clientes no podrán reservar hasta que lo actives y guardes.</p>}
        {failed && data && <p className="mb-1 text-kova-ink">Revisa los datos marcados: la vista previa muestra el último ajuste válido.</p>}
        {draft.page && !tables && <p className="mb-1">Lo más pronto que pueden reservar: con {formatNotice(draft.page.notice_minutes)} de anticipación.</p>}
        <p>Es la misma página que abren tus clientes, con tus citas actuales ya descontadas. Puedes desplazarla para verla completa.</p>
      </>}
    >
      {data ? (
        <DevicePreview device={device} title="Vista previa de reservas en línea" scrollTo={tables ? undefined : '[aria-label="Día y horario"]'} scrollKey={key}>
          <BookingPage token="vista-previa" preview={data} />
        </DevicePreview>
      ) : failed ? (
        <p className="rounded-2xl border border-kova-border bg-white p-5 text-sm">No pudimos preparar la vista previa. Revisa los horarios capturados y tu conexión.</p>
      ) : (
        <SectionSkeleton label="Preparando vista previa de reservas…" variant="summary" />
      )}
    </LivePreview>
  );
}
