import { Clock3 } from "lucide-react";

import { copy } from "@/i18n/messages";
import { formatDayLong, formatDayShort, formatDayWithWeekday } from "@/i18n/date";
import { formatMoney } from "@/orders/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { RankBarChart } from "../charts/RankBarChart";
import { SalesTrendChart, type SalesDayPoint } from "../charts/SalesTrendChart";
import type { ChartRow } from "../charts/types";
import { formatHourRange, topHoursByNetSales } from "../hours";
import type { BusinessStoryReport, SalesByHourRow } from "../types";
import {
  MIN_MONEY_BASE,
  bestDayRow,
  bestDaypartRow,
  calculateSafeGrowth,
} from "../utils/calculations";
import { addDays, daysBetweenInclusive } from "../utils/dateRange";
import { formatSignedPercent } from "../utils/format";
import { PartialFailureNote, ReportSection } from "./ReportSection";

type DaypartRow = BusinessStoryReport["sales_by_daypart"][number];

function buildDayPoints(story: BusinessStoryReport): SalesDayPoint[] {
  const byDate = new Map(story.sales_by_day.map((row) => [row.date, row]));
  const totalNet = story.sales_by_day.reduce((sum, row) => sum + Number(row.net_sales), 0);
  const start = story.summary.start_date;
  const end = story.summary.end_date;
  const days = daysBetweenInclusive(start, end);

  const points: SalesDayPoint[] = [];
  let cursor = start;
  let previousValue: number | null = null;
  for (let i = 0; i < days; i += 1) {
    const row = byDate.get(cursor);
    const value = row ? Number(row.net_sales) : 0;
    let vsPrevLabel: string | null = null;
    if (previousValue !== null && previousValue > 0 && value > 0) {
      const pct = Math.round(((value - previousValue) / previousValue) * 100);
      vsPrevLabel = formatSignedPercent(pct);
    }
    points.push({
      id: cursor,
      axisLabel: formatDayShort(cursor),
      fullLabel: formatDayLong(cursor),
      value,
      valueLabel: formatMoney(value),
      orderCount: row?.order_count ?? 0,
      avgTicketLabel: formatMoney(row?.average_ticket ?? "0"),
      vsPrevLabel,
      sharePct: totalNet > 0 ? Math.round((value / totalNet) * 100) : 0,
      isZero: value === 0,
    });
    previousValue = value;
    cursor = addDays(cursor, 1);
  }
  return points;
}

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
      <div className="grid gap-3 sm:grid-cols-2">
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
                  <p className="text-xs text-kova-muted">
                    {copy.reportsView.chartShare(row.sales_share_pct)} · {row.order_count}{" "}
                    {copy.reportsView.orders.toLowerCase()} · {formatMoney(row.average_ticket)}
                  </p>
                  <div className="mt-1">
                    <DaypartDelta current={row} previous={prevByKey.get(row.key) ?? null} />
                  </div>
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

  // 1. Peak daypart concentrates the day → staff/stock ahead of it.
  if (best.sales_share_pct >= 40 && best.order_count >= 10) {
    return copy.reportsView.daypartRecReinforce(best.label, best.sales_share_pct, best.start_hour);
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
  if (hourlyFailed) {
    return <PartialFailureNote message={copy.reportsView.hourlyUnavailable} />;
  }
  const top = hourRows(hourly);
  const worst = worstHourRows(hourly, rangeDays);
  if (top.length === 0) {
    return <PartialFailureNote message={copy.reportsView.noHourlySales} />;
  }
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <RankBarChart
        title={copy.reportsView.hourlyTopTitle}
        subtitle={copy.reportsView.hourlyChartSubtitle}
        rows={top}
        emptyLabel={copy.reportsView.noHourlySales}
        valueFormatter={(value) => formatMoney(value)}
      />
      {worst.length > 0 ? (
        <RankBarChart
          title={copy.reportsView.hourlyWorstTitleActive}
          rows={worst}
          emptyLabel={copy.reportsView.noHourlySales}
          valueFormatter={(value) => formatMoney(value)}
        />
      ) : null}
    </div>
  );
}

export function TimingAnalysis({
  story,
  hourly,
  hourlyFailed,
  previousStory,
}: {
  story: BusinessStoryReport;
  hourly: SalesByHourRow[];
  hourlyFailed: boolean;
  previousStory: BusinessStoryReport | null;
}) {
  const rangeDays = daysBetweenInclusive(story.summary.start_date, story.summary.end_date);
  const points = buildDayPoints(story);
  // Average over every day in the range (zero-sales days included, since points
  // are padded), so the reference line reflects the whole period.
  const average = points.length ? points.reduce((sum, p) => sum + p.value, 0) / points.length : 0;
  const best = bestDayRow(story);
  const bestDayId = best?.date ?? null;
  const srSummary = best
    ? copy.reportsView.salesTrendSrSummary(
        formatDayShort(story.summary.start_date),
        formatDayShort(story.summary.end_date),
        formatDayWithWeekday(best.date),
        formatMoney(best.net_sales),
        formatMoney(String(average)),
      )
    : undefined;

  return (
    <ReportSection
      icon={<Clock3 className="h-5 w-5 text-muted-foreground" />}
      title={copy.reportsView.timingAnalysisTitle}
      description={copy.reportsView.timingAnalysisDescription}
    >
      <div className="space-y-6">
        {rangeDays > 1 ? (
          <SalesTrendChart
            points={points}
            average={average}
            bestDayId={bestDayId}
            rangeDays={rangeDays}
            srSummary={srSummary}
          />
        ) : null}
        <DaypartGrid story={story} previousStory={previousStory} />
        <HourlySection hourly={hourly} hourlyFailed={hourlyFailed} rangeDays={rangeDays} />
      </div>
    </ReportSection>
  );
}
