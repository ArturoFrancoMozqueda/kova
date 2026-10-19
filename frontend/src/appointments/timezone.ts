/** Convert a wall clock in an explicit IANA zone without relying on the device zone. */
export const appointmentTimezones = [
  { value: "America/Mexico_City", label: "Ciudad de México" },
  { value: "America/Cancun", label: "Cancún" },
  { value: "America/Tijuana", label: "Tijuana" },
  { value: "America/Hermosillo", label: "Hermosillo" },
  { value: "America/Mazatlan", label: "Mazatlán" },
  { value: "America/Monterrey", label: "Monterrey" },
] as const;

const wallParts = (instant: number, timezone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (name: string) =>
    parts.find((part) => part.type === name)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
};
export function utcToZonedInput(value: string, timezone: string): string {
  return wallParts(new Date(value).getTime(), timezone);
}
export function zonedInputToUtc(value: string, timezone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Elige una fecha y hora completas.");
  const [, year, month, day, hour, minute] = match.map(Number);
  const nominal = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(nominal).toISOString().slice(0, 16) !== value)
    throw new Error("La fecha u hora no es válida.");
  const offsets = new Set<number>();
  // Sample the surrounding days to discover both offsets at a daylight-saving boundary.
  for (const delta of [-48, -24, 0, 24, 48]) {
    const instant = nominal + delta * 3_600_000;
    const local = wallParts(instant, timezone);
    offsets.add(new Date(`${local}Z`).getTime() - instant);
  }
  const candidates = [...offsets]
    .map((offset) => nominal - offset)
    .filter((instant) => wallParts(instant, timezone) === value);
  if (candidates.length === 0)
    throw new Error(
      "Esa hora no existe por el cambio de horario de esta zona. Elige otra hora.",
    );
  if (candidates.length > 1)
    throw new Error(
      "Esa hora ocurre dos veces por el cambio de horario. Elige una hora fuera de ese intervalo para evitar confusiones.",
    );
  return new Date(candidates[0]).toISOString();
}
export function formatAppointmentTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function appointmentDateRange(
  start: string,
  end: string,
  timezone: string,
) {
  const next = new Date(`${end}T00:00:00Z`);
  if (!Number.isFinite(next.getTime()) || start > end)
    throw new Error("Elige un período válido.");
  next.setUTCDate(next.getUTCDate() + 1);
  const starts_from = zonedInputToUtc(`${start}T00:00`, timezone);
  const starts_until = zonedInputToUtc(
    `${next.toISOString().slice(0, 10)}T00:00`,
    timezone,
  );
  if (
    new Date(starts_until).getTime() - new Date(starts_from).getTime() >
    366 * 86400000
  )
    throw new Error("Consulta un período de hasta 366 días.");
  return { start: starts_from, end: starts_until };
}
