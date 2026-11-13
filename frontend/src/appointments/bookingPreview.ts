import type { AvailabilityWindow } from "./bookingTypes";

const toMinutes = (clock: string) => {
  const match = /^(\d{2}):(\d{2})/.exec(clock);
  if (!match) return null;
  const value = Number(match[1]) * 60 + Number(match[2]);
  return value >= 0 && value <= 24 * 60 ? value : null;
};
const toClock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * Start times a customer could be offered on a day with these windows, using
 * the same stepping as the backend (`bookings/service.py::slots`): a start
 * every `slotMinutes` from each window's opening while it is before closing.
 * Existing appointments, minimum notice and service duration are applied by
 * the server when the customer picks a date, so they are not simulated here.
 */
export function previewStartTimes(windows: readonly AvailabilityWindow[], slotMinutes: number, limit = 48): string[] {
  if (!Number.isInteger(slotMinutes) || slotMinutes < 5) return [];
  const starts = new Set<number>();
  for (const window of windows) {
    const open = toMinutes(window.start);
    const close = toMinutes(window.end);
    if (open === null || close === null) continue;
    for (let minute = open; minute < close && starts.size < limit; minute += slotMinutes) starts.add(minute);
  }
  return [...starts].sort((a, b) => a - b).slice(0, limit).map(toClock);
}

/** "2 horas", "1 día y 3 horas", "45 minutos" for the minimum notice. */
export function formatNotice(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "sin anticipación mínima";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const parts = [
    days ? `${days} ${days === 1 ? "día" : "días"}` : "",
    hours ? `${hours} ${hours === 1 ? "hora" : "horas"}` : "",
    rest ? `${rest} ${rest === 1 ? "minuto" : "minutos"}` : "",
  ].filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}` : parts[0];
}
