import { copy } from "@/i18n/messages";
import { formatDayLong, formatDayShort, formatDayWithWeekday } from "@/i18n/date";
import { formatMoney } from "@/orders/format";
import { SalesTrendChart, type SalesDayPoint } from "../charts/SalesTrendChart";
import type { BusinessStoryReport } from "../types";
import { bestDayRow } from "../utils/calculations";
import { addDays, daysBetweenInclusive } from "../utils/dateRange";
import { formatSignedPercent } from "../utils/format";

function buildDayPoints(
  story: BusinessStoryReport,
  previousStory: BusinessStoryReport | null,
): SalesDayPoint[] {
  const byDate = new Map(story.sales_by_day.map((row) => [row.date, row]));
  const totalNet = story.sales_by_day.reduce((sum, row) => sum + Number(row.net_sales), 0);
  const start = story.summary.start_date;
  const end = story.summary.end_date;
  const days = daysBetweenInclusive(start, end);

  // The previous comparable range has the same length, so day i of the current
  // range aligns with day i of the previous one (same weekday on 7/28-day
  // ranges). Zero-sales days are padded on both sides, mirroring the bars.
  const prevHasSales = (previousStory?.summary.completed_orders ?? 0) > 0;
  const prevByDate = prevHasSales
    ? new Map(previousStory!.sales_by_day.map((row) => [row.date, row]))
    : null;
  let prevCursor = previousStory?.summary.start_date ?? null;

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
    const point: SalesDayPoint = {
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
    };
    if (prevByDate && prevCursor) {
      const prevValue = Number(prevByDate.get(prevCursor)?.net_sales ?? 0);
      point.prevValue = prevValue;
      point.prevValueLabel = formatMoney(prevValue);
      prevCursor = addDays(prevCursor, 1);
    }
    points.push(point);
    previousValue = value;
    cursor = addDays(cursor, 1);
  }
  return points;
}

/** When more than half of the range is zero-days before the first sale, the
 * chart looks broken instead of "young business" — one caption explains it. */
function firstSaleNote(points: SalesDayPoint[]): string | null {
  const firstSaleIndex = points.findIndex((point) => !point.isZero);
  if (firstSaleIndex <= 0) return null;
  if (firstSaleIndex / points.length <= 0.5) return null;
  return copy.reportsView.salesTrendStartedNote(points[firstSaleIndex].fullLabel);
}

function trendSrSummary(
  source: BusinessStoryReport,
  average: number,
  previousStory: BusinessStoryReport | null,
): string | undefined {
  const best = bestDayRow(source);
  if (!best) return undefined;
  const base = copy.reportsView.salesTrendSrSummary(
    formatDayShort(source.summary.start_date),
    formatDayShort(source.summary.end_date),
    formatDayWithWeekday(best.date),
    formatMoney(best.net_sales),
    formatMoney(String(average)),
  );
  if (previousStory && previousStory.summary.completed_orders > 0) {
    return `${base} ${copy.reportsView.salesTrendSrPrevTotal(formatMoney(previousStory.summary.net_sales))}`;
  }
  return base;
}

/**
 * The report's main chart: daily net sales as bars. Previous-period values stay
 * available in the selected-day detail without adding another visual series.
 * On single-day ranges it draws from the trailing-7-days story because those
 * dates don't align with the previous comparable day.
 */
export function MainTrendPanel({
  story,
  previousStory,
  trendStory = null,
  subtitle,
  height,
}: {
  story: BusinessStoryReport;
  previousStory: BusinessStoryReport | null;
  trendStory?: BusinessStoryReport | null;
  /** Overrides the default chart subtitle (Phase 4 passes the headline). */
  subtitle?: string;
  height?: number;
}) {
  const rangeDays = daysBetweenInclusive(story.summary.start_date, story.summary.end_date);
  const trendSource = rangeDays > 1 ? story : trendStory;
  const comparison = rangeDays > 1 ? previousStory : null;
  const points = trendSource ? buildDayPoints(trendSource, comparison) : [];
  // Average over every day in the range (zero-sales days included, since points
  // are padded), so the reference line reflects the whole period.
  const average = points.length ? points.reduce((sum, p) => sum + p.value, 0) / points.length : 0;
  const bestDayId = trendSource ? (bestDayRow(trendSource)?.date ?? null) : null;

  if (!trendSource || points.length <= 1) return null;

  return (
    <SalesTrendChart
      points={points}
      average={average}
      bestDayId={bestDayId}
      rangeDays={daysBetweenInclusive(trendSource.summary.start_date, trendSource.summary.end_date)}
      srSummary={trendSrSummary(trendSource, average, comparison)}
      note={firstSaleNote(points)}
      subtitle={subtitle ?? (rangeDays === 1 ? copy.reportsView.salesTrendContextSubtitle : undefined)}
      initialSelectedId={rangeDays === 1 ? story.summary.end_date : undefined}
      height={height}
    />
  );
}
