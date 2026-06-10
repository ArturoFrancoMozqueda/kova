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

/**
 * Calendar-day label formatters — the single source of truth for showing a
 * business day (a date-only `YYYY-MM-DD` string) to the user. Date-only strings
 * are anchored to UTC so the calendar day never shifts with the viewer's
 * timezone. Transaction timestamps (which carry a time) live in
 * `orders/format.ts` and stay numeric on purpose.
 */
function dayParts(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

/** "jueves, 15 de junio" — friendly prose for greetings and summaries. */
export function formatDayLong(isoDate: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(dayParts(isoDate));
}

/** "15 de junio" — day and month without weekday. */
export function formatDayMonthLong(isoDate: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(dayParts(isoDate));
}

/** "Jue 15 jun" — compact day label with a capitalized weekday. */
export function formatDayWithWeekday(isoDate: string): string {
  const date = dayParts(isoDate);
  const weekday = new Intl.DateTimeFormat("es-MX", { weekday: "short", timeZone: "UTC" })
    .format(date)
    .replace(/\.$/, "");
  const capitalized = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  const dm = new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
  return `${capitalized} ${dm}`;
}

/** "15 jun" — shortest day label, for dense chart axes. */
export function formatDayShort(isoDate: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(dayParts(isoDate));
}
