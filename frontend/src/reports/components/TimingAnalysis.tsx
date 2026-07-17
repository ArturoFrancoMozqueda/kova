import { useState } from "react";
import { Clock3 } from "lucide-react";

import { copy } from "@/i18n/messages";
import { formatMoney } from "@/orders/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RankBarChart } from "../charts/RankBarChart";
import type { ChartRow } from "../charts/types";
import { formatHourRange, topHoursByNetSales } from "../hours";
import type { BusinessStoryReport, SalesByHourRow } from "../types";
import {
  MIN_MONEY_BASE,
  bestDaypartRow,
  calculateSafeGrowth,
} from "../utils/calculations";
import { daysBetweenInclusive } from "../utils/dateRange";
import { formatSignedPercent } from "../utils/format";
import { MainTrendPanel } from "./MainTrendPanel";
import { PartialFailureNote, ReportSection } from "./ReportSection";

type DaypartRow = BusinessStoryReport["sales_by_daypart"][number];

function DaypartDelta({ current, previous }: { current: DaypartRow; previous: DaypartRow | null }) {
  if (!previous || previous.order_count < 3) {
    return <span className="text-xs text-kova-muted">{copy.reportsView.daypartNoComparison}</span>;
  }
  const growth = calculateSafeGrowth(Number(current.net_sales), Number(previous.net_sales), {
    minBase: MIN_MONEY_BASE,
  });
  if (growth.kind !== "pct") {
    return <span className="text-xs text-kova-muted">{copy.reportsView.daypartNoComparison}</span>;
  }
  return (
    <span
      className={cn(
        "text-xs font-medium tabular-nums",
        growth.value > 0 ? "text-kova-growth" : "text-destructive",
      )}
    >
      {formatSignedPercent(growth.value)} {copy.reportsView.deltaVsPrevious}
    </span>
  );
}

function DaypartGrid({
  story,
  previousStory,
}: {
  story: BusinessStoryReport;
  previousStory: BusinessStoryReport | null;
}) {
  // When the previous period had no sales at all, the summary caption already
  // says so once — repeating "Sin comparación" per block is noise.
  const prevComparable = (previousStory?.summary.completed_orders ?? 0) > 0;
  const prevByKey = new Map((previousStory?.sales_by_daypart ?? []).map((row) => [row.key, row]));
  // Hide madrugada when it never had an order in the whole range (closed hours).
  const dayparts = story.sales_by_daypart.filter(
    (row) => row.key !== "madrugada" || row.order_count > 0,
  );
  const best = bestDaypartRow(story);
  const recommendation = daypartRecommendation(story, previousStory);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-kova-ink">{copy.reportsView.daypartGridTitle}</h3>
      {/* One row on desktop: an orphan block on a second line reads unbalanced.
          Columns match the visible daypart count (3, or 4 with madrugada). */}
      <div
        className={cn(
          "grid gap-3 sm:grid-cols-2",
          dayparts.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3",
        )}
      >
        {dayparts.map((row) => {
          const isBest = best?.key === row.key && Number(row.net_sales) > 0;
          const zero = Number(row.net_sales) <= 0;
          return (
            <div
              key={row.key}
              className={cn(
                "rounded-kova-md border p-4",
                isBest ? "border-kova-blue/40 bg-kova-blue/5" : "border-kova-border bg-white",
                zero && "opacity-70",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-kova-ink">{row.label}</p>
                {isBest ? <Badge variant="secondary">{copy.reportsView.daypartStrongest}</Badge> : null}
              </div>
              {zero ? (
                <p className="mt-2 text-sm text-kova-muted">{copy.reportsView.daypartNoSales}</p>
              ) : (
                <>
                  <p className="mt-2 text-lg font-bold tabular-nums text-kova-ink">
                    {formatMoney(row.net_sales)}
                  </p>
                  <div
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-kova-mist"
                    role="meter"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={row.sales_share_pct}
                    aria-label={`${row.label}: ${copy.reportsView.chartShare(row.sales_share_pct)}`}
                  >
                    <div
                      className="h-full rounded-full bg-kova-blue"
                      style={{ width: `${Math.min(100, Math.max(2, row.sales_share_pct))}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs tabular-nums text-kova-muted">
                    {copy.reportsView.chartShare(row.sales_share_pct)} · {row.order_count}{" "}
                    {copy.reportsView.orders.toLowerCase()} · {formatMoney(row.average_ticket)}
                  </p>
                  {prevComparable ? (
                    <div className="mt-1">
                      <DaypartDelta current={row} previous={prevByKey.get(row.key) ?? null} />
                    </div>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
      </div>
      {recommendation ? (
        <p className="rounded-kova-md border border-kova-border bg-kova-mist/40 p-3 text-sm leading-6 text-kova-ink">
          {recommendation}
        </p>
      ) : null}
    </div>
  );
}

function daypartRecommendation(
  story: BusinessStoryReport,
  previousStory: BusinessStoryReport | null,
): string | null {
  const best = bestDaypartRow(story);
  if (!best) return null;
  const rangeDays = daysBetweenInclusive(story.summary.start_date, story.summary.end_date);

  // 1. Peak daypart concentrates the day → staff/stock ahead of it. The
  // insight carries the exact money, share and order count, then the
  // operational recommendation.
  if (best.sales_share_pct >= 40 && best.order_count >= 10) {
    return copy.reportsView.daypartRecReinforce(
      best.label,
      formatMoney(best.net_sales),
      best.sales_share_pct,
      best.order_count,
      best.start_hour,
    );
  }
  // 2. Strong block shifted vs the previous period.
  const prevBest = previousStory ? bestDaypartRow(previousStory) : null;
  if (prevBest && prevBest.key !== best.key && prevBest.order_count >= 3 && best.order_count >= 3) {
    return copy.reportsView.daypartRecShift(prevBest.label, best.label);
  }
  // 3. A genuinely quiet active block is an opportunity, not a problem.
  if (rangeDays >= 7) {
    const quiet = story.sales_by_daypart
      .filter((row) => row.order_count > 0 && row.sales_share_pct < 10)
      .sort((a, b) => a.sales_share_pct - b.sales_share_pct)[0];
    if (quiet) return copy.reportsView.daypartRecQuiet(quiet.label);
  }
  return null;
}

function hourRows(rows: SalesByHourRow[]): ChartRow[] {
  return topHoursByNetSales(rows, 3).map((row) => ({
    id: String(row.hour),
    label: formatHourRange(row.hour),
    value: Number(row.net_sales),
    valueLabel: formatMoney(row.net_sales),
    meta: [{ label: copy.reportsView.chartOrders, value: String(row.order_count) }],
  }));
}

function worstHourRows(rows: SalesByHourRow[], rangeDays: number): ChartRow[] {
  const active = rows.filter((row) => Number(row.net_sales) > 0);
  if (active.length < 6 || rangeDays < 7) return [];
  const topIds = new Set(topHoursByNetSales(rows, 3).map((row) => String(row.hour)));
  return [...active]
    .sort((a, b) => Number(a.net_sales) - Number(b.net_sales))
    .filter((row) => !topIds.has(String(row.hour)))
    .slice(0, 3)
    .map((row) => ({
      id: String(row.hour),
      label: formatHourRange(row.hour),
      value: Number(row.net_sales),
      valueLabel: formatMoney(row.net_sales),
      meta: [{ label: copy.reportsView.chartOrders, value: String(row.order_count) }],
    }));
}

function HourlySection({
  hourly,
  hourlyFailed,
  rangeDays,
}: {
  hourly: SalesByHourRow[];
  hourlyFailed: boolean;
  rangeDays: number;
}) {
  // Progressive disclosure: the worst-hours ranking duplicates the shape of
  // "mejores horas" and only matters on longer reads, so it stays one tap away.
  const [showWorst, setShowWorst] = useState(false);
  if (hourlyFailed) {
    return <PartialFailureNote message={copy.reportsView.hourlyUnavailable} />;
  }
  const top = hourRows(hourly);
  const worst = worstHourRows(hourly, rangeDays);
  if (top.length === 0) {
    return <PartialFailureNote message={copy.reportsView.noHourlySales} />;
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-6 xl:grid-cols-2">
        <RankBarChart
          title={copy.reportsView.hourlyTopTitle}
          subtitle={copy.reportsView.hourlyChartSubtitle}
          rows={top}
          emptyLabel={copy.reportsView.noHourlySales}
          valueFormatter={(value) => formatMoney(value)}
        />
        {worst.length > 0 && showWorst ? (
          <RankBarChart
            title={copy.reportsView.hourlyWorstTitleActive}
            rows={worst}
            emptyLabel={copy.reportsView.noHourlySales}
            valueFormatter={(value) => formatMoney(value)}
          />
        ) : null}
      </div>
      {worst.length > 0 ? (
        <Button variant="ghost" size="sm" onClick={() => setShowWorst((value) => !value)}>
          {showWorst ? copy.reportsView.hourlyWorstHide : copy.reportsView.hourlyWorstShow}
        </Button>
      ) : null}
    </div>
  );
}

export function TimingAnalysis({
  story,
  hourly,
  hourlyFailed,
  previousStory,
  trendStory = null,
}: {
  story: BusinessStoryReport;
  hourly: SalesByHourRow[];
  hourlyFailed: boolean;
  previousStory: BusinessStoryReport | null;
  /** Trailing 7-day story for single-day ranges: the daily chart stays on
   * screen even on "Hoy", with today pre-selected against its own week. */
  trendStory?: BusinessStoryReport | null;
}) {
  const rangeDays = daysBetweenInclusive(story.summary.start_date, story.summary.end_date);

  return (
    <ReportSection
      icon={<Clock3 className="h-5 w-5 text-muted-foreground" />}
      title={copy.reportsView.timingAnalysisTitle}
      description={copy.reportsView.timingAnalysisDescription}
    >
      <div className="space-y-6">
        <MainTrendPanel story={story} previousStory={previousStory} trendStory={trendStory} />
        <DaypartGrid story={story} previousStory={previousStory} />
        <HourlySection hourly={hourly} hourlyFailed={hourlyFailed} rangeDays={rangeDays} />
      </div>
    </ReportSection>
  );
}
