import { DollarSign, Receipt, RotateCcw, ShoppingCart } from "lucide-react";

import { copy } from "@/i18n/messages";
import { formatDayMonthLong, formatDayShort, formatDayWithWeekday } from "@/i18n/date";
import { formatMoney, reasonLabel } from "@/orders/format";
import { cn } from "@/lib/utils";
import type { BusinessStoryReport } from "../types";
import {
  MIN_COUNT_BASE,
  MIN_MONEY_BASE,
  bestDayRow,
  bestDaypartRow,
  calculateSafeGrowth,
} from "../utils/calculations";
import { DeltaChip, StatTile } from "@/components/ui/stat-tile";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-kova-md border border-kova-border bg-white px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-kova-tertiary">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-kova-ink" title={value}>
        {value}
      </p>
    </div>
  );
}

/** One-line summary of the period ("Vendiste $X con N órdenes…"), reused as
 * the main chart's subtitle so the number and its context read together. */
export function summaryHeadline(
  story: BusinessStoryReport,
  previousStory: BusinessStoryReport | null,
  rangeDays: number,
): string {
  const summary = story.summary;
  const prevSummary = previousStory?.summary ?? null;
  const prevHasSales = (prevSummary?.completed_orders ?? 0) > 0;
  const netGrowth = calculateSafeGrowth(
    Number(summary.net_sales),
    prevSummary ? Number(prevSummary.net_sales) : null,
    { minBase: MIN_MONEY_BASE },
  );
  const bestDaypart = bestDaypartRow(story);
  const amount = formatMoney(summary.net_sales);
  // Single-day ranges compare against yesterday and speak in "hoy", never
  // "en estos 1 día".
  if (rangeDays === 1 && prevHasSales && netGrowth.kind === "pct" && netGrowth.value > 0) {
    return copy.reportsView.headlineTodayGrowth(amount, netGrowth.value, bestDaypart?.label ?? null);
  }
  if (rangeDays === 1 && prevHasSales && netGrowth.kind === "pct" && netGrowth.value < 0) {
    return copy.reportsView.headlineTodayDecline(amount, Math.abs(netGrowth.value));
  }
  if (prevHasSales && netGrowth.kind === "pct" && netGrowth.value > 0) {
    return copy.reportsView.headlineGrowth(amount, rangeDays, netGrowth.value, bestDaypart?.label ?? null);
  }
  if (prevHasSales && netGrowth.kind === "pct" && netGrowth.value < 0) {
    return copy.reportsView.headlineDecline(amount, Math.abs(netGrowth.value));
  }
  if (rangeDays === 1) {
    return copy.reportsView.headlineToday(amount, summary.completed_orders);
  }
  return copy.reportsView.headlineNeutral(amount, summary.completed_orders, rangeDays);
}

function buildCaption({
  previousFailed,
  prevSummary,
  prevHasSales,
  rangeDays,
}: {
  previousFailed: boolean;
  prevSummary: BusinessStoryReport["summary"] | null;
  prevHasSales: boolean;
  rangeDays: number;
}): string | null {
  if (previousFailed) return copy.reportsView.comparisonUnavailable;
  if (!prevSummary) return null;
  if (!prevHasSales) {
    return copy.reportsView.comparisonEmptyPrevious(
      formatDayMonthLong(prevSummary.start_date),
      formatDayMonthLong(prevSummary.end_date),
    );
  }
  if (rangeDays === 1) {
    return copy.reportsView.comparisonCaptionYesterday(formatDayShort(prevSummary.start_date));
  }
  return copy.reportsView.comparisonCaptionMulti(
    formatDayShort(prevSummary.start_date),
    formatDayShort(prevSummary.end_date),
    rangeDays,
  );
}

/** The KPI row of the dashboard: net sales, orders, average ticket and
 * refunds, each with an honest delta vs the previous comparable period, plus
 * a one-line caption naming exactly what "previous" means. */
export function SummaryKpis({
  story,
  previousStory,
  previousFailed,
  rangeDays,
}: {
  story: BusinessStoryReport;
  previousStory: BusinessStoryReport | null;
  previousFailed: boolean;
  rangeDays: number;
}) {
  const summary = story.summary;
  const prevSummary = previousStory?.summary ?? null;
  const prevHasSales = (prevSummary?.completed_orders ?? 0) > 0;

  const netGrowth = calculateSafeGrowth(
    Number(summary.net_sales),
    prevSummary ? Number(prevSummary.net_sales) : null,
    { minBase: MIN_MONEY_BASE },
  );
  const orderGrowth = calculateSafeGrowth(
    summary.completed_orders,
    prevSummary?.completed_orders ?? null,
    { minBase: MIN_COUNT_BASE },
  );
  const ticketGrowth = calculateSafeGrowth(
    Number(summary.average_ticket),
    prevSummary ? Number(prevSummary.average_ticket) : null,
    { minBase: 1 },
  );
  const refundGrowth = calculateSafeGrowth(
    Number(summary.refund_total),
    prevSummary ? Number(prevSummary.refund_total) : null,
    { minBase: MIN_MONEY_BASE },
  );

  const caption = buildCaption({ previousFailed, prevSummary, prevHasSales, rangeDays });

  const renderDelta = (
    growth: typeof netGrowth,
    current: number,
    previous: number | null,
    format: "money" | "count",
    positiveIsGood = true,
  ) => {
    // Without a comparable previous period the caption below the KPI row says
    // it once; repeating the same note inside every tile is noise.
    if (previousFailed || !prevHasSales) return null;
    return (
      <DeltaChip
        growth={growth}
        current={current}
        previous={previous ?? 0}
        format={format}
        positiveIsGood={positiveIsGood}
      />
    );
  };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-kova-ink">{copy.reportsView.summaryTitle}</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile
          label={copy.reportsView.kpiNetSalesLabel}
          value={formatMoney(summary.net_sales)}
          icon={<DollarSign className="h-4 w-4" />}
        >
          {renderDelta(netGrowth, Number(summary.net_sales), prevSummary ? Number(prevSummary.net_sales) : null, "money")}
        </StatTile>
        <StatTile
          label={copy.reportsView.kpiOrdersLabel}
          value={String(summary.completed_orders)}
          icon={<ShoppingCart className="h-4 w-4" />}
        >
          {renderDelta(orderGrowth, summary.completed_orders, prevSummary?.completed_orders ?? null, "count")}
        </StatTile>
        <StatTile
          label={copy.reportsView.kpiAvgTicketLabel}
          value={formatMoney(summary.average_ticket)}
          icon={<Receipt className="h-4 w-4" />}
        >
          {renderDelta(ticketGrowth, Number(summary.average_ticket), prevSummary ? Number(prevSummary.average_ticket) : null, "money")}
        </StatTile>
        <StatTile
          label={copy.reportsView.kpiRefundsLabel}
          value={formatMoney(summary.refund_total)}
          icon={<RotateCcw className="h-4 w-4" />}
        >
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {renderDelta(
              refundGrowth,
              Number(summary.refund_total),
              prevSummary ? Number(prevSummary.refund_total) : null,
              "money",
              false,
            )}
            <span className="text-xs tabular-nums text-kova-muted">
              {copy.reportsView.kpiRefundsCount(summary.refund_count)}
            </span>
          </span>
        </StatTile>
      </div>
      {caption ? <p className="text-xs text-kova-muted">{caption}</p> : null}
    </section>
  );
}

/** Quick-facts (best day, peak hour, top product, dominant payment). Stacked
 * on the dashboard rail under the priority action; 2×2 grid below `lg`. */
export function QuickFactsRail({
  story,
  className,
}: {
  story: BusinessStoryReport;
  className?: string;
}) {
  const bestDay = bestDayRow(story);
  return (
    <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-1", className)}>
      <Fact
        label={copy.reportsView.factBestDay}
        value={bestDay ? formatDayWithWeekday(bestDay.date) : copy.reportsView.factEmpty}
      />
      <Fact
        label={copy.reportsView.factPeakHour}
        value={story.peak_hour?.label ?? copy.reportsView.factEmpty}
      />
      <Fact
        label={copy.reportsView.factTopProduct}
        value={story.top_product_by_sales?.product_name ?? copy.reportsView.factEmpty}
      />
      <Fact
        label={copy.reportsView.factDominantPayment}
        value={
          story.dominant_payment
            ? copy.reportsView.factDominantPaymentValue(
                reasonLabel(story.dominant_payment.method),
                story.dominant_payment.sales_share_pct,
              )
            : copy.reportsView.factEmpty
        }
      />
    </div>
  );
}
