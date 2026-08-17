import type { FiscalDraftSettings } from "./api";

export type FiscalPeriodValidation =
  | { valid: true }
  | {
      valid: false;
      reason: "invalid_iso" | "not_completed" | "weekly_mismatch" | "monthly_mismatch";
      expected?: string;
    };

type PeriodSettings = Pick<
  FiscalDraftSettings,
  "frequency" | "weekly_close_day" | "monthly_close_day"
>;

function isoFromParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function partsFromIso(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() !== month - 1 ||
    normalized.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthlyClose(year: number, month: number, configuredDay: number): string {
  return isoFromParts(year, month, Math.min(configuredDay, daysInMonth(year, month)));
}

function addDays(value: string, days: number): string {
  const parts = partsFromIso(value);
  if (!parts) throw new Error("Expected a valid ISO calendar date");
  const result = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return isoFromParts(result.getUTCFullYear(), result.getUTCMonth() + 1, result.getUTCDate());
}

function isoWeekday(value: string): number {
  const parts = partsFromIso(value);
  if (!parts) throw new Error("Expected a valid ISO calendar date");
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay() || 7;
}

export function todayInMexicoCity(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function latestCompletedPeriodEnd(
  settings: PeriodSettings,
  todayIso = todayInMexicoCity(),
): string {
  const yesterday = addDays(todayIso, -1);
  if (settings.frequency === "daily") return yesterday;

  if (settings.frequency === "weekly") {
    const daysSinceClose = (isoWeekday(yesterday) - settings.weekly_close_day + 7) % 7;
    return addDays(yesterday, -daysSinceClose);
  }

  const today = partsFromIso(todayIso);
  if (!today) throw new Error("Expected a valid ISO calendar date");
  const currentClose = monthlyClose(today.year, today.month, settings.monthly_close_day);
  if (currentClose < todayIso) return currentClose;

  const previousMonth = today.month === 1 ? 12 : today.month - 1;
  const previousYear = today.month === 1 ? today.year - 1 : today.year;
  return monthlyClose(previousYear, previousMonth, settings.monthly_close_day);
}

export function validatePeriodEnd(
  periodEnd: string,
  settings: PeriodSettings,
  todayIso = todayInMexicoCity(),
): FiscalPeriodValidation {
  const selected = partsFromIso(periodEnd);
  if (!selected) return { valid: false, reason: "invalid_iso" };
  if (periodEnd >= todayIso) return { valid: false, reason: "not_completed" };

  if (settings.frequency === "weekly" && isoWeekday(periodEnd) !== settings.weekly_close_day) {
    return { valid: false, reason: "weekly_mismatch" };
  }

  if (settings.frequency === "monthly") {
    const expected = monthlyClose(selected.year, selected.month, settings.monthly_close_day);
    if (periodEnd !== expected) {
      return { valid: false, reason: "monthly_mismatch", expected };
    }
  }

  return { valid: true };
}
