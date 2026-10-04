import { daysAgoInTimezone, todayInTimezone } from "@/i18n/date";

export type ReportPreset = "today" | "seven_days" | "month";

export type DateRange = { startDate: string; endDate: string };

export function isValidDateRange(startDate: string, endDate: string): boolean {
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = localDate(value);
    return Number.isFinite(date.getTime()) && toISODate(date) === value;
  };
  return validDate(startDate) && validDate(endDate) && startDate <= endDate;
}

/** UTC-anchored date-only math. Report ranges are `YYYY-MM-DD` strings with no
 * time component, so we anchor them to UTC midnight to shift days without the
 * viewer's timezone ever moving the calendar day. Display formatting lives in
 * `i18n/date.ts`; this module only does arithmetic. */
export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function localDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function addDays(value: string, days: number): string {
  const date = localDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toISODate(date);
}

/** Inclusive day count: a single-day range is 1, not 0. Floors at 1 so a
 * reversed or malformed range never yields 0 or a negative divisor. */
export function daysBetweenInclusive(startDate: string, endDate: string): number {
  const start = localDate(startDate).getTime();
  const end = localDate(endDate).getTime();
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

/** The equal-length window immediately preceding [startDate, endDate]. A 7-day
 * range maps to the prior 7 days; a single day maps to the day before. */
export function previousComparableRange(startDate: string, endDate: string): DateRange {
  const days = daysBetweenInclusive(startDate, endDate);
  const previousEnd = addDays(startDate, -1);
  const previousStart = addDays(previousEnd, -(days - 1));
  return { startDate: previousStart, endDate: previousEnd };
}

export function lastThirtyDaysStart(tz?: string): string {
  return daysAgoInTimezone(tz, 29);
}

export function lastSevenDaysStart(tz?: string): string {
  return daysAgoInTimezone(tz, 6);
}

/** The range for a preset button, anchored to "today" in the tenant timezone. */
export function presetRange(preset: ReportPreset, tz?: string): DateRange {
  const today = todayInTimezone(tz);
  if (preset === "today") return { startDate: today, endDate: today };
  if (preset === "seven_days") return { startDate: lastSevenDaysStart(tz), endDate: today };
  return { startDate: lastThirtyDaysStart(tz), endDate: today };
}

/** Which preset (if any) the current range matches, so the header can highlight
 * the active button. Returns null for custom ranges. */
export function activePreset(startDate: string, endDate: string, tz?: string): ReportPreset | null {
  const today = todayInTimezone(tz);
  if (startDate === today && endDate === today) return "today";
  if (startDate === lastSevenDaysStart(tz) && endDate === today) return "seven_days";
  if (startDate === lastThirtyDaysStart(tz) && endDate === today) return "month";
  return null;
}
