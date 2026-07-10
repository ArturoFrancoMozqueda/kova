import { copy } from "../../i18n/messages";
import { formatMoney } from "../../orders/format";
import type { InventoryVelocityItem, StockItem } from "../../inventory/types";
import type { BusinessStoryReport } from "../types";
import {
  INVENTORY_THRESHOLDS,
  MIN_COUNT_BASE,
  MIN_MONEY_BASE,
  calculateSafeGrowth,
  parseDaysUntilOut,
} from "./calculations";

export type RecommendationPriority = "alta" | "media" | "baja";

export type RecommendationTone =
  | "risk"
  | "opportunity"
  | "good_signal"
  | "operational_improvement";

/**
 * A single actionable recommendation. `id` is the template that produced it and
 * `subjectId` is what it is about (a product id, "payments", "refunds", ...);
 * together they form the dedupe key. `estimatedImpactMxn` orders cards within a
 * priority tier and, when present, is also surfaced to the user as `impact`.
 */
export type Recommendation = {
  id: string;
  subjectId: string;
  priority: RecommendationPriority;
  tone: RecommendationTone;
  finding: string;
  evidence: string;
  action: string;
  impact?: string;
  estimatedImpactMxn?: number;
};

export type RecommendationInput = {
  story: BusinessStoryReport;
  previousStory: BusinessStoryReport | null;
  trackedIds: Set<string>;
  stockByProduct: Map<string, StockItem>;
  velocityByProduct: Map<string, InventoryVelocityItem>;
  rangeDays: number;
};

const PRIORITY_RANK: Record<RecommendationPriority, number> = { alta: 0, media: 1, baja: 2 };
const TEMPLATE_RANK = [
  "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10", "R11", "R12", "R13",
];

const rec = copy.reportsView.rec;

function unitPrice(grossSales: string, quantitySold: number): number {
  const gross = Number(grossSales);
  if (!Number.isFinite(gross) || quantitySold <= 0) return 0;
  return gross / quantitySold;
}

/** Ordered top-5 drivers by sales share — the "key products" set. */
function topDrivers(story: BusinessStoryReport, n: number) {
  return [...story.product_drivers]
    .sort((a, b) => b.sales_share_pct - a.sales_share_pct)
    .slice(0, n);
}

export function buildRecommendations(input: RecommendationInput): Recommendation[] {
  const { story, previousStory, trackedIds, stockByProduct, velocityByProduct, rangeDays } = input;
  const summary = story.summary;
  const out: Recommendation[] = [];
  // Single source of truth: recommendation triggers share the same thresholds
  // as the inventory/trend badges in calculations.ts (T0.4). A product badged
  // "en caída" or "sin-vincular" in the table now also drives its recommendation.
  const T = INVENTORY_THRESHOLDS;

  const previousComparable =
    previousStory && previousStory.summary.completed_orders >= MIN_COUNT_BASE
      ? previousStory
      : null;

  // --- R1: Caída de ventas (Alta) ---
  if (previousComparable) {
    const currentNet = Number(summary.net_sales);
    const prevNet = Number(previousComparable.summary.net_sales);
    const growth = calculateSafeGrowth(currentNet, prevNet, { minBase: MIN_MONEY_BASE });
    if (growth.kind === "pct" && growth.value <= -15) {
      const drop = prevNet - currentNet;
      out.push({
        id: "R1",
        subjectId: "sales",
        priority: "alta",
        tone: "risk",
        finding: rec.salesDropFinding,
        evidence: rec.salesDropEvidence(formatMoney(summary.net_sales), Math.abs(growth.value)),
        action: rec.salesDropAction,
        impact: drop > 0 ? rec.salesDropImpact(formatMoney(String(drop))) : undefined,
        estimatedImpactMxn: Math.max(0, drop),
      });
    }
  }

  const drivers = topDrivers(story, 5);
  const driverCriticalIds = new Set<string>();

  // --- R2: Producto clave por agotarse (Alta) ---
  for (const driver of drivers) {
    if (!trackedIds.has(driver.product_id)) continue;
    const stock = stockByProduct.get(driver.product_id);
    const velocity = velocityByProduct.get(driver.product_id);
    const days = parseDaysUntilOut(velocity?.days_until_out);
    const stockOnHand = stock?.stock_on_hand ?? velocity?.stock_on_hand ?? null;
    const outNow = stockOnHand === 0 && driver.quantity_sold > 0;
    const daysCritical = days !== null && days <= T.criticalDays;
    if (!outNow && !daysCritical) continue;
    driverCriticalIds.add(driver.product_id);
    const perDay = velocity ? Number(velocity.units_per_day_7d) : 0;
    const estImpact = Number.isFinite(perDay)
      ? perDay * unitPrice(driver.gross_sales, driver.quantity_sold) * 3
      : 0;
    out.push({
      id: "R2",
      subjectId: driver.product_id,
      priority: "alta",
      tone: "risk",
      finding: rec.stockoutFinding(driver.product_name),
      evidence: rec.stockoutEvidence(
        driver.quantity_sold,
        stockOnHand ?? 0,
        days,
      ),
      action: rec.stockoutAction,
      impact: estImpact > 0 ? rec.stockoutImpact(formatMoney(String(estImpact))) : undefined,
      estimatedImpactMxn: estImpact,
    });
  }

  // --- R3: Pico de devoluciones (Alta) ---
  const gross = Number(summary.gross_sales);
  const refundRate = gross > 0 ? (Number(summary.refund_total) / gross) * 100 : 0;
  const prevRefundCount = previousStory?.summary.refund_count ?? 0;
  const refundSpike =
    summary.refund_count >= 5 && prevRefundCount > 0 && summary.refund_count >= 2 * prevRefundCount;
  if ((refundRate > 5 || refundSpike) && summary.refund_count > 1) {
    out.push({
      id: "R3",
      subjectId: "refunds",
      priority: "alta",
      tone: "risk",
      finding: rec.refundSpikeFinding,
      evidence: rec.refundSpikeEvidence(
        summary.refund_count,
        formatMoney(summary.refund_total),
        Math.round(refundRate),
      ),
      action: rec.refundSpikeAction,
      estimatedImpactMxn: Number(summary.refund_total),
    });
  }

  // --- R4: Reabastecer pronto (Media) ---
  for (const driver of drivers) {
    if (!trackedIds.has(driver.product_id)) continue;
    if (driverCriticalIds.has(driver.product_id)) continue; // R2 supersedes R4
    const stock = stockByProduct.get(driver.product_id);
    const velocity = velocityByProduct.get(driver.product_id);
    const days = parseDaysUntilOut(velocity?.days_until_out);
    const lowStock = stock?.is_low_stock ?? false;
    if (!lowStock && !(days !== null && days <= T.restockDays)) continue;
    out.push({
      id: "R4",
      subjectId: driver.product_id,
      priority: "media",
      tone: "operational_improvement",
      finding: rec.restockFinding(driver.product_name),
      evidence: rec.restockEvidence(days),
      action: rec.restockAction,
    });
  }

  // --- R5: Estrella sin inventario vinculado (Media) ---
  for (const driver of drivers) {
    if (trackedIds.has(driver.product_id)) continue;
    if (driver.sales_share_pct < T.unlinkedMinSharePct) continue;
    out.push({
      id: "R5",
      subjectId: driver.product_id,
      priority: "media",
      tone: "operational_improvement",
      finding: rec.unlinkedFinding(driver.product_name),
      evidence: rec.unlinkedEvidence(driver.product_name, driver.sales_share_pct),
      action: rec.unlinkedAction,
    });
  }

  // --- R6: Efectivo dominante (Media) ---
  const totalPayments = story.payment_mix.reduce((sum, row) => sum + row.payment_count, 0);
  const cash = story.payment_mix.find((row) => row.method === "cash");
  if (cash && cash.sales_share_pct >= 70 && totalPayments >= 10) {
    out.push({
      id: "R6",
      subjectId: "payments",
      priority: "media",
      tone: "operational_improvement",
      finding: rec.cashHeavyFinding,
      evidence: rec.cashHeavyEvidence(cash.sales_share_pct),
      action: rec.cashHeavyAction,
    });
  }

  // --- R7: Productos en caída (Media), aggregated when ≥3 ---
  const declining = (story.product_trends?.declining ?? []).filter(
    (row) => row.delta_pct <= T.decliningDeltaPct && row.previous_units >= T.decliningMinPrevUnits,
  );
  if (declining.length >= 3) {
    out.push({
      id: "R7",
      subjectId: "declining-multi",
      priority: "media",
      tone: "risk",
      finding: rec.decliningMultiFinding,
      evidence: rec.decliningMultiEvidence(declining.length),
      action: rec.decliningMultiAction,
    });
  } else {
    for (const row of declining) {
      out.push({
        id: "R7",
        subjectId: row.product_id,
        priority: "media",
        tone: "risk",
        finding: rec.decliningFinding(row.product_name),
        evidence: rec.decliningEvidence(row.previous_units, row.current_units),
        action: rec.decliningAction,
      });
    }
  }

  // --- R8: Cancelaciones altas (Media) ---
  const cancellations = summary.cancellation_count;
  const cancelDenominator = summary.completed_orders + cancellations;
  const cancelRate = cancelDenominator > 0 ? (cancellations / cancelDenominator) * 100 : 0;
  if (cancelRate > 15 && cancellations >= 3) {
    out.push({
      id: "R8",
      subjectId: "cancellations",
      priority: "media",
      tone: "risk",
      finding: rec.cancellationsFinding,
      evidence: rec.cancellationsEvidence(cancellations, Math.round(cancelRate)),
      action: rec.cancellationsAction,
    });
  }

  // --- R9: Refuerza tu hora pico (Baja) ---
  const peak = story.peak_hour;
  if (peak && peak.sales_share_pct >= 25 && peak.order_count >= 10) {
    out.push({
      id: "R9",
      subjectId: "peak-hour",
      priority: "baja",
      tone: "opportunity",
      finding: rec.peakHourFinding,
      evidence: rec.peakHourEvidence(peak.label, peak.sales_share_pct),
      action: rec.peakHourAction,
    });
  }

  // --- R10: Aprovecha horas tranquilas (Baja) ---
  const quietDaypart = story.sales_by_daypart
    .filter((row) => row.order_count > 0 && row.sales_share_pct < 10)
    .sort((a, b) => a.sales_share_pct - b.sales_share_pct)[0];
  if (quietDaypart && rangeDays >= 14) {
    out.push({
      id: "R10",
      subjectId: "quiet-hours",
      priority: "baja",
      tone: "opportunity",
      finding: rec.quietHoursFinding(quietDaypart.label),
      evidence: rec.quietHoursEvidence(quietDaypart.label, quietDaypart.sales_share_pct),
      action: rec.quietHoursAction,
    });
  }

  // --- R11: Producto nuevo funcionando (Baja), aggregated when ≥3 like R7.
  // Without aggregation a young catalog floods the section with identical
  // "arrancó bien" cards and buries the one action that matters.
  const newWinners = (story.product_trends?.growing ?? []).filter(
    (row) => row.trend === "new" && row.current_units >= 10,
  );
  if (newWinners.length >= 3) {
    const ranked = [...newWinners].sort((a, b) => b.current_units - a.current_units);
    const totalUnits = ranked.reduce((sum, row) => sum + row.current_units, 0);
    out.push({
      id: "R11",
      subjectId: "new-products-multi",
      priority: "baja",
      tone: "opportunity",
      finding: rec.newProductMultiFinding(ranked.length),
      evidence: rec.newProductMultiEvidence(
        ranked.slice(0, 3).map((row) => row.product_name),
        totalUnits,
      ),
      action: rec.newProductMultiAction,
    });
  } else {
    for (const row of newWinners) {
      out.push({
        id: "R11",
        subjectId: row.product_id,
        priority: "baja",
        tone: "opportunity",
        finding: rec.newProductFinding(row.product_name),
        evidence: rec.newProductEvidence(row.current_units),
        action: rec.newProductAction,
      });
    }
  }

  // --- R12: Sobrestock (Baja) ---
  for (const driver of drivers) {
    if (!trackedIds.has(driver.product_id)) continue;
    const stock = stockByProduct.get(driver.product_id);
    const velocity = velocityByProduct.get(driver.product_id);
    const days = parseDaysUntilOut(velocity?.days_until_out);
    const threshold = stock?.low_stock_threshold ?? 0;
    const stockOnHand = stock?.stock_on_hand ?? velocity?.stock_on_hand ?? 0;
    if (days !== null && days > 60 && threshold > 0 && stockOnHand >= threshold * 3) {
      out.push({
        id: "R12",
        subjectId: driver.product_id,
        priority: "baja",
        tone: "operational_improvement",
        finding: rec.overstockFinding(driver.product_name),
        evidence: rec.overstockEvidence(Math.round(days)),
        action: rec.overstockAction,
      });
    }
  }

  // --- R13: Operación limpia (Baja, buena señal) ---
  if (summary.refund_count === 0 && summary.cancellation_count === 0 && summary.completed_orders >= 10) {
    out.push({
      id: "R13",
      subjectId: "clean-ops",
      priority: "baja",
      tone: "good_signal",
      finding: rec.cleanOpsFinding,
      evidence: rec.cleanOpsEvidence(summary.completed_orders),
      action: rec.cleanOpsAction,
    });
  }

  return sortRecommendations(dedupe(out));
}

function dedupe(items: Recommendation[]): Recommendation[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.id}|${item.subjectId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortRecommendations(items: Recommendation[]): Recommendation[] {
  return [...items].sort((a, b) => {
    if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) {
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    }
    const impactA = a.estimatedImpactMxn ?? 0;
    const impactB = b.estimatedImpactMxn ?? 0;
    if (impactA !== impactB) return impactB - impactA;
    return TEMPLATE_RANK.indexOf(a.id) - TEMPLATE_RANK.indexOf(b.id);
  });
}
