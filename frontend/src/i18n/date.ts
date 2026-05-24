export const DEFAULT_TIMEZONE = "America/Mexico_City";

export function isoDateInTimezone(
  timezone: string = DEFAULT_TIMEZONE,
  date: Date = new Date(),
): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: timezone,
    }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // Fall back to UTC if the browser/runtime does not know the configured timezone.
  }
  return date.toISOString().slice(0, 10);
}

export function todayInTimezone(
  timezone: string = DEFAULT_TIMEZONE,
  date: Date = new Date(),
): string {
  return isoDateInTimezone(timezone, date);
}

export function daysAgoInTimezone(
  timezone: string | undefined,
  days: number,
  date: Date = new Date(),
): string {
  return isoDateInTimezone(
    timezone ?? DEFAULT_TIMEZONE,
    new Date(date.getTime() - days * 86_400_000),
  );
}

export function yesterdayInTimezone(
  timezone: string = DEFAULT_TIMEZONE,
  date: Date = new Date(),
): string {
  return daysAgoInTimezone(timezone, 1, date);
}

export function currentMonthStartInTimezone(
  timezone: string = DEFAULT_TIMEZONE,
  date: Date = new Date(),
): string {
  return `${todayInTimezone(timezone, date).slice(0, 8)}01`;
}
