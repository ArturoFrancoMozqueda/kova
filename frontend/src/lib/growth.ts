// Period-over-period growth, as a shared primitive.
//
// Lives in `lib/` (not `reports/`) so any tab — Panel, Reportes, future
// surfaces — computes deltas the same honest way and shared UI like
// `components/ui/stat-tile` can depend on it without importing `reports/`.
// `reports/utils/calculations` re-exports these names for its existing callers
// and tests.

/**
 * The result of comparing a current value to a previous one. A discriminated
 * union instead of `number | null` so the UI can render each case honestly:
 * a real percentage, a first-appearance ("Nuevo"), no comparable data, or a
 * base too small / swing too large to express as a trustworthy percentage
 * (carrying `from`/`to` so the caller can fall back to an absolute delta).
 */
export type GrowthResult =
  | { kind: "pct"; value: number }
  | { kind: "flat" }
  | { kind: "new" }
  | { kind: "no-previous" }
  | { kind: "insufficient-base"; from: number; to: number };

/** Below this previous value, a percentage is noise (e.g. +900% from $1). */
export const MIN_MONEY_BASE = 500;
/** Below this previous count, an order/unit percentage is noise. */
export const MIN_COUNT_BASE = 5;
/** Percentages beyond this magnitude are shown as absolute deltas instead. */
export const MAX_DISPLAY_PCT = 300;

export function calculateSafeGrowth(
  current: number,
  previous: number | null | undefined,
  opts?: { minBase?: number },
): GrowthResult {
  const minBase = opts?.minBase ?? MIN_MONEY_BASE;

  if (previous == null || !Number.isFinite(previous) || !Number.isFinite(current)) {
    return { kind: "no-previous" };
  }
  if (previous === 0) {
    return current > 0 ? { kind: "new" } : { kind: "no-previous" };
  }
  if (Math.abs(previous) < minBase) {
    return { kind: "insufficient-base", from: previous, to: current };
  }

  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { kind: "flat" };
  if (Math.abs(pct) > MAX_DISPLAY_PCT) {
    return { kind: "insufficient-base", from: previous, to: current };
  }
  return { kind: "pct", value: pct };
}

export function toneFromGrowth(growth: GrowthResult): "up" | "down" | "neutral" {
  if (growth.kind === "pct") return growth.value > 0 ? "up" : "down";
  if (growth.kind === "insufficient-base") {
    return growth.to > growth.from ? "up" : growth.to < growth.from ? "down" : "neutral";
  }
  if (growth.kind === "new") return "up";
  return "neutral";
}
