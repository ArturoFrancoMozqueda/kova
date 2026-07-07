import {
  Bar,
  Cell,
  ComposedChart,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import { copy } from "@/i18n/messages";
import { formatMoney } from "@/orders/format";
import { formatCompactMoney } from "../utils/format";
import { ChartCard } from "./ChartCard";
import { useChartSelection } from "./useChartSelection";

const ACCENT = "var(--kova-blue)";
const MUTED = "var(--kova-blue-light)";

export type SalesDayPoint = {
  id: string;
  axisLabel: string;
  fullLabel: string;
  value: number;
  valueLabel: string;
  orderCount: number;
  avgTicketLabel: string;
  vsPrevLabel: string | null;
  sharePct: number;
  isZero: boolean;
};

function tickInterval(rangeDays: number): number {
  if (rangeDays <= 8) return 0;
  if (rangeDays > 31) return 6;
  return Math.max(0, Math.ceil(rangeDays / 6) - 1);
}

/**
 * Daily net sales as bars with a dashed average reference line. Single hue; the
 * selected day is solid, the rest de-emphasized. The best day carries the only
 * direct value label and is pre-selected so the detail card is always populated
 * (no "tap a bar" hint). A single-bar range should use the hourly chart instead.
 */
export function SalesTrendChart({
  points,
  average,
  bestDayId,
  rangeDays,
  srSummary,
  note,
}: {
  points: SalesDayPoint[];
  average: number;
  bestDayId: string | null;
  rangeDays: number;
  srSummary?: string;
  note?: string | null;
}) {
  const { activeId, toggle, preview } = useChartSelection(bestDayId);
  const hasSales = points.some((point) => point.value > 0);
  const activePoint = points.find((point) => point.id === activeId) ?? null;

  const data = points.map((point) => ({
    ...point,
    bestLabel: point.id === bestDayId ? point.valueLabel : "",
  }));

  return (
    <ChartCard
      title={copy.reportsView.salesTrendChartTitle}
      subtitle={copy.reportsView.salesTrendChartSubtitle}
      srSummary={srSummary}
      isEmpty={!hasSales}
      emptyLabel={copy.reportsView.salesTrendChartTitle}
    >
      <ResponsiveContainer width="100%" height={256}>
        {/* No accessibilityLayer: on touch devices it pins a tooltip over the
            chart on load (focus shows index 0, often an empty day). The
            sr-only summary + persistent detail card carry accessibility. */}
        <ComposedChart data={data} margin={{ top: 24, right: 8, bottom: 4, left: 4 }}>
          <XAxis
            dataKey="axisLabel"
            interval={tickInterval(rangeDays)}
            tickLine={false}
            axisLine={{ stroke: "var(--kova-border)" }}
            tick={{ fontSize: 11, fill: "var(--kova-muted)" }}
            height={20}
          />
          <YAxis
            width={52}
            tickCount={4}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "var(--kova-muted)" }}
            tickFormatter={(value: number) => formatCompactMoney(value)}
          />
          {/* No Tooltip: hovering a bar already previews it into the detail
              card below, so a floating box would repeat the same numbers on
              top of the chart. */}
          <ReferenceLine
            y={average}
            stroke="var(--kova-tertiary)"
            strokeDasharray="4 4"
            label={{
              value: copy.reportsView.salesTrendAverageLabel(formatMoney(String(average))),
              position: "right",
              fill: "var(--kova-muted)",
              fontSize: 10,
            }}
          />
          <Bar
            dataKey="value"
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
            isAnimationActive={false}
            onClick={(entry: unknown) => {
              const id = (entry as { id?: string })?.id;
              if (id) toggle(id);
            }}
            onMouseEnter={(entry: unknown) => preview((entry as { id?: string })?.id ?? null)}
            onMouseLeave={() => preview(null)}
            className="cursor-pointer"
          >
            {data.map((point) => (
              <Cell key={point.id} fill={point.id === activeId ? ACCENT : MUTED} />
            ))}
            <LabelList
              dataKey="bestLabel"
              position="top"
              className="fill-kova-ink"
              fontSize={11}
              fontWeight={600}
            />
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
      {note ? <p className="mt-2 text-xs text-kova-muted">{note}</p> : null}
      {activePoint ? (
        <div className="mt-4 rounded-kova-md border border-kova-border bg-white p-3" role="status">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-kova-ink">
              {activePoint.id === bestDayId ? copy.reportsView.salesTrendBestDayLabel : activePoint.fullLabel}
            </p>
            <p className="text-sm font-bold tabular-nums text-kova-ink">{activePoint.valueLabel}</p>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-kova-muted">
            <span>{copy.reportsView.salesTrendShare(activePoint.sharePct)}</span>
            <span>
              {copy.reportsView.salesTrendTooltipOrders}: {activePoint.orderCount}
            </span>
            <span>
              {copy.reportsView.salesTrendTooltipTicket}: {activePoint.avgTicketLabel}
            </span>
            {activePoint.vsPrevLabel ? (
              <span>{copy.reportsView.salesTrendVsPrevDay(activePoint.vsPrevLabel)}</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </ChartCard>
  );
}
