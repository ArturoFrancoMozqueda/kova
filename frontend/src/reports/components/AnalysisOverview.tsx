import { AlertTriangle, CreditCard, PackageSearch, TimerReset } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { WeeklyKpiChart, type WeeklyKpiPoint } from "@/components/ui/weekly-kpi-chart";
import { formatDayWithWeekday } from "@/i18n/date";
import { copy } from "@/i18n/messages";
import { cn } from "@/lib/utils";
import { formatMoney, reasonLabel } from "@/orders/format";
import type { AnalysisHelpfulness } from "@/telemetry/funnel";
import { formatHourRange, topHoursByNetSales } from "../hours";
import type { BusinessStoryReport, SalesByHourRow } from "../types";
import { MIN_MONEY_BASE, calculateSafeGrowth } from "../utils/calculations";
import { activePreset, addDays, daysBetweenInclusive } from "../utils/dateRange";
import { formatSignedPercent } from "../utils/format";
import type { Recommendation } from "../utils/recommendations";
import { PartialFailureNote } from "./ReportSection";
import { PriorityActionCard } from "./PriorityActionCard";

type RankRow = {
  id: string;
  label: string;
  value: number;
  valueLabel: string;
};

function weekdayLabel(date: string): string {
  return formatDayWithWeekday(date).split(" ")[0].slice(0, 2);
}

function chartPoints(story: BusinessStoryReport): WeeklyKpiPoint[] {
  const byDate = new Map(story.sales_by_day.map((row) => [row.date, row]));
  const days = daysBetweenInclusive(story.summary.start_date, story.summary.end_date);
  const points: WeeklyKpiPoint[] = [];
  let cursor = story.summary.start_date;
  for (let index = 0; index < days; index += 1) {
    const row = byDate.get(cursor);
    const value = Number(row?.net_sales ?? 0);
    points.push({
      id: cursor,
      label: weekdayLabel(cursor),
      fullLabel: formatDayWithWeekday(cursor),
      value,
      valueLabel: formatMoney(value),
    });
    cursor = addDays(cursor, 1);
  }
  return points;
}

function periodLabel(story: BusinessStoryReport): string {
  const preset = activePreset(story.summary.start_date, story.summary.end_date, story.summary.timezone);
  if (preset === "today") return copy.reportsView.overviewPeriodToday;
  if (preset === "seven_days") return copy.reportsView.overviewPeriodWeek;
  if (preset === "month") return copy.reportsView.overviewPeriodMonth;
  return copy.reportsView.overviewPeriodCustom;
}

function comparisonInfo({
  story,
  previousStory,
  previousFailed,
}: {
  story: BusinessStoryReport;
  previousStory: BusinessStoryReport | null;
  previousFailed: boolean;
}): { growthLabel: string | null; positive: boolean; text: string } {
  if (previousFailed) {
    return { growthLabel: null, positive: true, text: copy.reportsView.comparisonUnavailable };
  }
  if (!previousStory || previousStory.summary.completed_orders === 0) {
    return { growthLabel: null, positive: true, text: copy.reportsView.deltaNoPrevious };
  }
  const current = Number(story.summary.net_sales);
  const previous = Number(previousStory.summary.net_sales);
  const difference = current - previous;
  const growth = calculateSafeGrowth(current, previous, { minBase: MIN_MONEY_BASE });
  const growthLabel = growth.kind === "pct" ? formatSignedPercent(growth.value) : null;

  return {
    growthLabel,
    positive: growth.kind !== "pct" || growth.value >= 0,
    text: copy.reportsView.overviewComparison(
      formatMoney(previous),
      difference,
      formatMoney(Math.abs(difference)),
    ),
  };
}

function RankListCard({
  title,
  icon,
  rows,
  emptyLabel,
  failure,
  action,
}: {
  title: string;
  icon: ReactNode;
  rows: RankRow[];
  emptyLabel: string;
  failure?: string | null;
  action?: ReactNode;
}) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="border-b border-kova-border px-5 py-4">
        <h2 className="font-semibold leading-none tracking-tight flex items-center gap-2 text-base">
          {icon}
          {title}
        </h2>
      </CardHeader>
      <CardContent className="p-5">
        {failure ? (
          <PartialFailureNote message={failure} />
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-kova-muted">{emptyLabel}</p>
        ) : (
          <ol className="space-y-5">
            {rows.map((row) => {
              const pct = Math.max(3, (row.value / max) * 100);
              return (
                <li key={row.id}>
                  <div className="mb-2 flex items-baseline justify-between gap-4">
                    <span className="truncate text-sm font-medium text-kova-ink" title={row.label}>
                      {row.label}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-kova-ink">
                      {row.valueLabel}
                    </span>
                  </div>
                  <div
                    className="h-2 overflow-hidden rounded-full bg-kova-mist"
                    role="meter"
                    aria-label={`${row.label}: ${row.valueLabel}`}
                    aria-valuemin={0}
                    aria-valuemax={max}
                    aria-valuenow={row.value}
                  >
                    <div className="h-full rounded-full bg-kova-ink" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {action ? <div className="mt-4 border-t border-kova-border pt-3">{action}</div> : null}
      </CardContent>
    </Card>
  );
}

function PaymentMixCard({ story }: { story: BusinessStoryReport }) {
  const payments = [...story.payment_mix]
    .filter((row) => Number(row.amount) > 0)
    .sort((a, b) => b.sales_share_pct - a.sales_share_pct);
  const colors = ["bg-kova-ink", "bg-kova-blue", "bg-kova-growth", "bg-kova-tertiary"];
  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="border-b border-kova-border px-5 py-4">
        <h2 className="font-semibold leading-none tracking-tight flex items-center gap-2 text-base">
          <CreditCard className="h-4 w-4 text-kova-tertiary" aria-hidden />
          {copy.reportsView.paymentBreakdown}
        </h2>
      </CardHeader>
      <CardContent className="p-5">
        {payments.length === 0 ? (
          <p className="py-8 text-center text-sm text-kova-muted">{copy.reportsView.noPayments}</p>
        ) : (
          <>
            <div className="mb-5 flex h-2.5 overflow-hidden rounded-full bg-kova-mist" aria-hidden>
              {payments.map((payment, index) => (
                <span
                  key={payment.method}
                  className={colors[index % colors.length]}
                  style={{ width: `${payment.sales_share_pct}%` }}
                />
              ))}
            </div>
            <ul className="space-y-3">
              {payments.map((payment, index) => (
                <li key={payment.method} className="flex items-center gap-3 text-sm">
                  <span className={cn("h-2.5 w-2.5 rounded-sm", colors[index % colors.length])} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-kova-ink">
                    {reasonLabel(payment.method)}
                  </span>
                  <span className="tabular-nums text-kova-muted">{formatMoney(payment.amount)}</span>
                  <span className="w-11 text-right font-semibold tabular-nums text-kova-ink">
                    {payment.sales_share_pct}%
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 border-t border-kova-border pt-3 text-xs leading-5 text-kova-muted">
              {copy.reportsView.grossVsNetNote}
              {Number(story.summary.refund_total) > 0 ? (
                <span className="mt-1 block tabular-nums">
                  {copy.reportsView.paymentReconciliation(
                    formatMoney(story.summary.gross_sales),
                    formatMoney(story.summary.refund_total),
                    formatMoney(story.summary.net_sales),
                  )}
                </span>
              ) : null}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function AnalysisOverview({
  story,
  previousStory,
  previousFailed,
  trendStory,
  hourly,
  hourlyFailed,
  priority,
  priorityDone,
  priorityFeedback,
  onTogglePriority,
  onPriorityFeedback,
}: {
  story: BusinessStoryReport;
  previousStory: BusinessStoryReport | null;
  previousFailed: boolean;
  trendStory: BusinessStoryReport | null;
  hourly: SalesByHourRow[];
  hourlyFailed: boolean;
  priority: Recommendation | null;
  priorityDone: boolean;
  priorityFeedback?: AnalysisHelpfulness;
  onTogglePriority: () => void;
  onPriorityFeedback: (value: AnalysisHelpfulness) => void;
}) {
  const rangeDays = daysBetweenInclusive(story.summary.start_date, story.summary.end_date);
  const chartStory = rangeDays === 1 && trendStory ? trendStory : story;
  const points = chartPoints(chartStory);
  const previousAverage = previousStory
    ? Number(previousStory.summary.net_sales) /
      daysBetweenInclusive(previousStory.summary.start_date, previousStory.summary.end_date)
    : 0;
  const productRows: RankRow[] = story.product_drivers.slice(0, 5).map((product) => ({
    id: product.product_id,
    label: product.product_name,
    value: Number(product.gross_sales),
    valueLabel: formatMoney(product.gross_sales),
  }));
  const hourRows: RankRow[] = topHoursByNetSales(hourly, 5).map((hour) => ({
    id: String(hour.hour),
    label: formatHourRange(hour.hour),
    value: Number(hour.net_sales),
    valueLabel: formatMoney(hour.net_sales),
  }));
  const comparison = comparisonInfo({ story, previousStory, previousFailed });

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardContent className="p-5 sm:p-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-kova-tertiary">
            <span>{copy.reportsView.kpiNetSalesLabel}</span>
            <span> · {periodLabel(story)}</span>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <p className="text-4xl font-bold tracking-[-0.045em] text-kova-ink sm:text-5xl">
              {formatMoney(story.summary.net_sales)}
            </p>
            {comparison.growthLabel ? (
              <span
                className={cn(
                  "inline-flex h-7 items-center rounded-full px-3 text-sm font-semibold tabular-nums",
                  comparison.positive
                    ? "bg-kova-growth/10 text-emerald-700"
                    : "bg-destructive/10 text-destructive",
                )}
              >
                {comparison.growthLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm tabular-nums text-kova-muted">{comparison.text}</p>
          {rangeDays === 1 && trendStory ? (
            <p className="mt-5 text-sm text-kova-muted">
              {copy.reportsView.overviewDailyTrend(
                formatDayWithWeekday(chartStory.summary.start_date),
                formatDayWithWeekday(chartStory.summary.end_date),
                daysBetweenInclusive(chartStory.summary.start_date, chartStory.summary.end_date),
              )}
            </p>
          ) : null}
          <WeeklyKpiChart
            className={rangeDays === 1 && trendStory ? "mt-2" : "mt-5"}
            data={points}
            referenceValue={previousAverage}
            referenceLabel={
              previousAverage > 0
                ? copy.reportsView.overviewPreviousAverage(formatMoney(previousAverage))
                : undefined
            }
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RankListCard
          title={copy.reportsView.overviewTopProducts}
          icon={<PackageSearch className="h-4 w-4 text-kova-tertiary" aria-hidden />}
          rows={productRows}
          emptyLabel={copy.reportsView.noProducts}
          action={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => document.getElementById("reporte-productos")?.scrollIntoView({ block: "start" })}
            >
              {copy.reportsView.productsPanelViewTable}
            </Button>
          }
        />
        <RankListCard
          title={copy.reportsView.overviewTopHours}
          icon={<TimerReset className="h-4 w-4 text-kova-tertiary" aria-hidden />}
          rows={hourRows}
          emptyLabel={copy.reportsView.noHourlySales}
          failure={hourlyFailed ? copy.reportsView.hourlyUnavailable : null}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PaymentMixCard story={story} />
        <Card className="h-full overflow-hidden">
          <CardHeader className="border-b border-kova-border px-5 py-4">
            <h2 className="font-semibold leading-none tracking-tight flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-warning-foreground" aria-hidden />
              {copy.reportsView.overviewPriorities}
            </h2>
          </CardHeader>
          <CardContent className="p-5">
            <PriorityActionCard
              recommendation={priority}
              done={priorityDone}
              feedback={priorityFeedback}
              onToggleDone={onTogglePriority}
              onFeedback={onPriorityFeedback}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
