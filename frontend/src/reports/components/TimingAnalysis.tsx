import { useState } from "react";
import { Clock3, TimerReset } from "lucide-react";

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
import { BentoPanel, PartialFailureNote } from "./ReportSection";

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

/** "¿Cuándo vendo más?" as a bento cell: the strongest block answered with its
 * exact money and share up top, then one compact meter row per daypart. */
export function DaypartsPanel({
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
  const highlight =
    best && Number(best.net_sales) > 0
      ? copy.reportsView.highlightDaypart(best.label, formatMoney(best.net_sales), best.sales_share_pct)
      : null;

  return (
    <BentoPanel
      icon={<Clock3 className="h-5 w-5 text-muted-foreground" />}
      title={copy.reportsView.timingAnalysisTitle}
      highlight={highlight}
    >
      <div className="space-y-3">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-kova-tertiary">
          {copy.reportsView.daypartGridTitle}
        </h3>
        <div className="space-y-3">
          {dayparts.map((row) => {
            const isBest = best?.key === row.key && Number(row.net_sales) > 0;
            const zero = Number(row.net_sales) <= 0;
            return (
              <div key={row.key} className={cn(zero && "opacity-70")}>
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-kova-ink">
                    {row.label}
                    {isBest ? <Badge variant="secondary">{copy.reportsView.daypartStrongest}</Badge> : null}
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-kova-ink">
                    {zero ? copy.reportsView.daypartNoSales : formatMoney(row.net_sales)}
                  </p>
                </div>
                {!zero ? (
                  <>
                    <div
                      className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-kova-mist"
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
                    <p className="mt-1 text-xs tabular-nums text-kova-muted">
                      {copy.reportsView.chartShare(row.sales_share_pct)} · {row.order_count}{" "}
                      {copy.reportsView.orders.toLowerCase()} · {formatMoney(row.average_ticket)}
                      {prevComparable ? (
                        <>
                          {" · "}
                          <DaypartDelta current={row} previous={prevByKey.get(row.key) ?? null} />
                        </>
                      ) : null}
                    </p>
                  </>
                ) : null}
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
    </BentoPanel>
  );
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

/** "Tus 3 mejores horas" as a bento cell, best hour answered up top. The
 * worst-hours ranking stays one tap away (progressive disclosure). */
export function TopHoursPanel({
  hourly,
  hourlyFailed,
  rangeDays,
}: {
  hourly: SalesByHourRow[];
  hourlyFailed: boolean;
  rangeDays: number;
}) {
  const [showWorst, setShowWorst] = useState(false);
  const top = hourRows(hourly);
  const worst = worstHourRows(hourly, rangeDays);
  const highlight =
    top.length > 0 ? copy.reportsView.highlightTopHour(top[0].label, top[0].valueLabel) : null;

  return (
    <BentoPanel
      icon={<TimerReset className="h-5 w-5 text-muted-foreground" />}
      title={copy.reportsView.hourlyTopTitle}
      highlight={highlight}
    >
      {hourlyFailed ? (
        <PartialFailureNote message={copy.reportsView.hourlyUnavailable} />
      ) : top.length === 0 ? (
        <PartialFailureNote message={copy.reportsView.noHourlySales} />
      ) : (
        <div className="space-y-3">
          <RankBarChart
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
          {worst.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setShowWorst((value) => !value)}>
              {showWorst ? copy.reportsView.hourlyWorstHide : copy.reportsView.hourlyWorstShow}
            </Button>
          ) : null}
        </div>
      )}
    </BentoPanel>
  );
}
