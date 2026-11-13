import { useState } from "react";
import { CalendarCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LivePreview } from "@/components/ui/live-preview";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DatePicker, addDays, dateKey } from "@/bookings/DatePicker";
import type { Availability, BookingPage } from "./bookingTypes";
import { formatNotice, previewStartTimes } from "./bookingPreview";

const weekdays = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const frame = { caption: "Así lo ven tus clientes", icon: <CalendarCheck className="h-3.5 w-3.5 text-kova-blue" aria-hidden="true" /> };

/** Start times of one weekday, drawn like the public booking page's buttons. */
export function AvailabilityPreview({
  weekly,
  slotMinutes,
  resourceName,
  className,
}: {
  weekly: Availability["weekly"];
  slotMinutes: number;
  resourceName: string;
  className?: string;
}) {
  const open = weekly.filter(day => day.windows.length).map(day => day.weekday).sort((a, b) => a - b);
  const [chosen, setChosen] = useState<number | null>(null);
  const weekday = chosen !== null && open.includes(chosen) ? chosen : open[0] ?? null;
  const starts = weekday === null ? [] : previewStartTimes(weekly.find(day => day.weekday === weekday)?.windows ?? [], slotMinutes);
  const summary = weekday === null
    ? `${resourceName} no tiene días con horario; tus clientes no verán horarios para reservar.`
    : `Un ${weekdays[weekday]}, tus clientes podrán elegir ${starts.length} ${starts.length === 1 ? "horario" : "horarios"} con ${resourceName}${starts.length ? `, desde las ${starts[0]} hasta las ${starts.at(-1)}` : ""}.`;
  return (
    <LivePreview
      label="Vista previa de horarios"
      summary={summary}
      className={className}
      frame={frame}
      controls={open.length > 1 && <div className="space-y-1">
        <Label htmlFor="availability-preview-day">Ver un día</Label>
        <Select id="availability-preview-day" value={weekday ?? ""} onChange={event => setChosen(Number(event.target.value))}>
          {open.map(day => <option key={day} value={day}>{weekdays[day][0].toUpperCase() + weekdays[day].slice(1)}</option>)}
        </Select>
      </div>}
      note={<p>Inicios cada {slotMinutes} minutos. Kova quita los horarios ya ocupados, los que no respetan la anticipación mínima y los que no alcanzan a terminar antes del cierre.</p>}
    >
      <div className="space-y-3 bg-white p-4">
        <p className="text-sm font-semibold">{weekday === null ? "Sin horarios" : `Horarios disponibles · ${weekdays[weekday]}`}</p>
        <p className="text-xs text-kova-muted">Con {resourceName}</p>
        {starts.length ? (
          <div className="grid grid-cols-3 gap-2">
            {starts.slice(0, 12).map(start => <Button key={start} type="button" variant="outline" className="text-xs" tabIndex={-1}>{start}</Button>)}
          </div>
        ) : (
          <p className="rounded-xl bg-kova-mist p-4 text-sm">No hay horarios disponibles este día. Elige otra fecha.</p>
        )}
        {starts.length > 12 && <p className="text-center text-xs text-kova-muted">y {starts.length - 12} horarios más</p>}
      </div>
    </LivePreview>
  );
}

/** The real date picker limited by the draft's horizon, plus the notice and change rules in plain words. */
export function PublicationPreview({ draft, className }: { draft: BookingPage; className?: string }) {
  const today = dateKey(new Date());
  const horizon = Number.isInteger(draft.horizon_days) && draft.horizon_days > 0 ? draft.horizon_days : 1;
  const last = addDays(today, horizon);
  const lastLabel = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${last}T12:00:00Z`));
  const tables = draft.mode === "tables";
  const summary = `${draft.enabled ? "Enlace público activo" : "Enlace público desactivado"}. Tus clientes podrán ${tables ? "solicitar mesa" : "reservar"} desde hoy hasta el ${lastLabel}, con ${formatNotice(draft.notice_minutes)} de anticipación${tables ? "" : `, y cambiar su cita hasta ${draft.manage_cutoff_hours} horas antes`}.`;
  return (
    <LivePreview
      label="Vista previa de reservas en línea"
      summary={summary}
      className={className}
      frame={frame}
      note={!draft.enabled && <p className="font-medium text-kova-ink">El enlace está desactivado: tus clientes no podrán reservar hasta que lo actives y guardes.</p>}
    >
      <div className="space-y-3 bg-white p-4">
        <p className="text-sm font-semibold">{tables ? "Elige el día de tu visita" : "Elige un día"}</p>
        <DatePicker key={`${today}:${horizon}`} min={today} max={last} value={today} onChange={() => undefined} />
        <ul className="space-y-1.5 text-xs">
          <li>Pueden elegir hasta el <strong>{lastLabel}</strong> ({horizon} {horizon === 1 ? "día" : "días"}).</li>
          <li>Lo más pronto: con <strong>{formatNotice(draft.notice_minutes)}</strong> de anticipación.</li>
          {!tables && <li>Pueden cambiar o cancelar hasta <strong>{draft.manage_cutoff_hours} {draft.manage_cutoff_hours === 1 ? "hora" : "horas"}</strong> antes.</li>}
          {tables && <li>Tu equipo confirma cada mesa desde Agenda.</li>}
        </ul>
      </div>
    </LivePreview>
  );
}
