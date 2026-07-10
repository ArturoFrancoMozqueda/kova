import type { InventoryVelocityItem, StockItem } from "../../inventory/types";
import type { BusinessStoryReport, ProductTrendRow } from "../types";

// ---------------------------------------------------------------------------
// Refund / cancellation severity (shared by the ops section and the action
// plan, so both always agree on what "nivel normal" means)
// ---------------------------------------------------------------------------

export type OpsSeverity = "info" | "watch" | "high";

export function refundSeverityLevel(ratePct: number, count: number): OpsSeverity {
  if (count <= 1 && ratePct < 5) return "info";
  if (ratePct < 1) return "info";
  if (ratePct <= 5) return "watch";
  return "high";
}

export function cancelSeverityLevel(ratePct: number, count: number): OpsSeverity {
  if (ratePct <= 5) return "info";
  if (ratePct <= 15) return "watch";
  return count >= 3 ? "high" : "info";
}

export function refundRatePct(summary: BusinessStoryReport["summary"]): number {
  const gross = Number(summary.gross_sales);
  return gross > 0 ? (Number(summary.refund_total) / gross) * 100 : 0;
}

export function cancelRatePct(summary: BusinessStoryReport["summary"]): number {
  const denominator = summary.completed_orders + summary.cancellation_count;
  return denominator > 0 ? (summary.cancellation_count / denominator) * 100 : 0;
}

/** True when both refunds and cancellations sit at the "info" level. Zero
 * counts short-circuit to normal, mirroring the ops section's clean state
 * (which never looks at rates when there is nothing to count). */
export function opsAreNormal(summary: BusinessStoryReport["summary"]): boolean {
  if (summary.refund_count === 0 && summary.cancellation_count === 0) return true;
  return (
    refundSeverityLevel(refundRatePct(summary), summary.refund_count) === "info" &&
    cancelSeverityLevel(cancelRatePct(summary), summary.cancellation_count) === "info"
  );
}

// ---------------------------------------------------------------------------
// Period-over-period growth — promoted to `@/lib/growth` (shared with Panel and
// future tabs). Re-exported here so existing report callers and tests that
// import from `./calculations` keep working unchanged.
// ---------------------------------------------------------------------------

export {
  MIN_MONEY_BASE,
  MIN_COUNT_BASE,
  MAX_DISPLAY_PCT,
  calculateSafeGrowth,
  toneFromGrowth,
} from "@/lib/growth";
export type { GrowthResult } from "@/lib/growth";

// ---------------------------------------------------------------------------
// Sales-by-day helpers
// ---------------------------------------------------------------------------

export function bestDayRow(story: BusinessStoryReport) {
  const row = [...story.sales_by_day].sort(
    (a, b) => Number(b.net_sales) - Number(a.net_sales),
  )[0];
  return row && Number(row.net_sales) > 0 ? row : null;
}

export function bestDaypartRow(story: BusinessStoryReport) {
  const row = [...story.sales_by_daypart].sort(
    (a, b) => Number(b.net_sales) - Number(a.net_sales),
  )[0];
  return row && Number(row.net_sales) > 0 ? row : null;
}

// ---------------------------------------------------------------------------
// Inventory status
// ---------------------------------------------------------------------------

export const INVENTORY_THRESHOLDS = {
  criticalDays: 3,
  restockDays: 7,
  overstockDays: 60,
  overstockStockMultiple: 3,
  starSharePct: 25,
  starMinDrivers: 3,
  starMinUnits: 5,
  decliningDeltaPct: -20,
  decliningMinPrevUnits: 5,
  growingDeltaPct: 20,
  growingMinPrevUnits: 5,
  growingNewMinUnits: 5,
  unlinkedMinSharePct: 10,
} as const;

/**
 * A product's inventory/sales standing, as a single verdict per row. Kinds are
 * evaluated top-down (first match wins) so the most urgent signal surfaces.
 * `tracked === false` products never receive a stock-based verdict — they can
 * only be "sin-vincular", "estrella", a trend state, or "estable".
 */
export type InventoryStatus =
  | { kind: "riesgo"; stockOnHand: number; daysUntilOut: number | null }
  | { kind: "reabastecer"; daysUntilOut: number | null }
  | { kind: "sobrestock"; daysUntilOut: number }
  | { kind: "estrella"; sharePct: number }
  | { kind: "en-caida"; previousUnits: number; currentUnits: number }
  | { kind: "creciendo"; deltaPct: number | null }
  | { kind: "baja-rotacion" }
  | { kind: "sin-vincular" }
  | { kind: "estable" };

export type InventoryStatusInput = {
  tracked: boolean;
  stock?: StockItem;
  velocity?: InventoryVelocityItem;
  trend?: ProductTrendRow;
  isSlowMover?: boolean;
  criticalRestock?: boolean;
  quantitySold: number;
  salesSharePct: number;
  driverCount: number;
};

/** Parse `days_until_out` (Decimal-as-string | null) to a finite number or null. */
export function parseDaysUntilOut(value: string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function getInventoryStatus(input: InventoryStatusInput): InventoryStatus {
  const T = INVENTORY_THRESHOLDS;
  const {
    tracked,
    stock,
    velocity,
    trend,
    isSlowMover,
    criticalRestock,
    quantitySold,
    salesSharePct,
    driverCount,
  } = input;
  const daysUntilOut = parseDaysUntilOut(velocity?.days_until_out);
  const stockOnHand = stock?.stock_on_hand ?? velocity?.stock_on_hand ?? null;

  if (tracked) {
    // 1. Riesgo de agotarse
    const outWithDemand = stockOnHand === 0 && quantitySold > 0;
    const daysCritical = daysUntilOut !== null && daysUntilOut <= T.criticalDays;
    if (outWithDemand || daysCritical || criticalRestock) {
      return { kind: "riesgo", stockOnHand: stockOnHand ?? 0, daysUntilOut };
    }
    // 2. Reabastecer pronto
    if (stock?.is_low_stock || (daysUntilOut !== null && daysUntilOut <= T.restockDays)) {
      return { kind: "reabastecer", daysUntilOut };
    }
    // 3. Sobrestock
    const threshold = stock?.low_stock_threshold ?? 0;
    if (
      daysUntilOut !== null &&
      daysUntilOut > T.overstockDays &&
      threshold > 0 &&
      stockOnHand !== null &&
      stockOnHand >= threshold * T.overstockStockMultiple
    ) {
      return { kind: "sobrestock", daysUntilOut };
    }
  }

  // 4. Producto estrella (applies tracked or not — no stock advice attached)
  if (
    salesSharePct >= T.starSharePct &&
    driverCount >= T.starMinDrivers &&
    quantitySold >= T.starMinUnits
  ) {
    return { kind: "estrella", sharePct: salesSharePct };
  }

  // 5. En caída
  if (
    trend?.trend === "declining" &&
    trend.delta_pct <= T.decliningDeltaPct &&
    trend.previous_units >= T.decliningMinPrevUnits
  ) {
    return { kind: "en-caida", previousUnits: trend.previous_units, currentUnits: trend.current_units };
  }

  // 6. Creciendo
  if (
    (trend?.trend === "growing" &&
      trend.delta_pct >= T.growingDeltaPct &&
      trend.previous_units >= T.growingMinPrevUnits) ||
    (trend?.trend === "new" && trend.current_units >= T.growingNewMinUnits)
  ) {
    return { kind: "creciendo", deltaPct: trend.trend === "new" ? null : trend.delta_pct };
  }

  // 7. Baja rotación
  if (isSlowMover) {
    return { kind: "baja-rotacion" };
  }

  // 8. Sin inventario vinculado
  if (!tracked) {
    return { kind: "sin-vincular" };
  }

  // 9. Estable
  return { kind: "estable" };
}
