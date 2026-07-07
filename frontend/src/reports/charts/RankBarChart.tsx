import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { copy } from "@/i18n/messages";
import { ChartCard } from "./ChartCard";
import { ChartDetailPanel } from "./ChartDetailPanel";
import { useChartSelection } from "./useChartSelection";
import type { ChartRow } from "./types";
import { percentOfTotal } from "./types";

const ACCENT = "var(--kova-blue)";
const MUTED = "var(--kova-blue-light)";

function truncate(label: string, max = 16): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function RankTooltip({
  active,
  payload,
  total,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
  total: number;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-kova-md border border-kova-border bg-white p-2.5 shadow-kova-card">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-kova-ink">{row.label}</span>
        <span className="text-sm font-bold tabular-nums text-kova-ink">{row.valueLabel}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-kova-muted">
        <span>{copy.reportsView.chartShare(percentOfTotal(row.value, total))}</span>
        {row.meta?.map((item) => (
          <span key={`${item.label}-${item.value}`}>
            {item.label}: {item.value}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Horizontal magnitude bars for a small set of categories (payment methods,
 * employees, refund reasons). Single hue; the selected/hovered row keeps the
 * accent while the rest de-emphasize. Amounts are labeled at the bar end; a
 * persistent detail card and an sr-only summary carry the rest.
 */
export function RankBarChart({
  title,
  subtitle,
  rows,
  emptyLabel,
  srSummary,
  valueFormatter,
}: {
  title?: string;
  subtitle?: string;
  rows: ChartRow[];
  emptyLabel: string;
  srSummary?: string;
  valueFormatter?: (value: number) => string;
}) {
  const { selectedId, activeId, toggle, preview } = useChartSelection();
  const visible = rows.filter((row) => row.value > 0);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const activeRow = rows.find((row) => row.id === activeId) ?? null;
  const somethingSelected = selectedId !== null;
  const height = Math.max(120, visible.length * 48 + 16);

  return (
    <ChartCard title={title} subtitle={subtitle} srSummary={srSummary} isEmpty={visible.length === 0} emptyLabel={emptyLabel}>
      <ResponsiveContainer width="100%" height={height}>
        {/* No accessibilityLayer — see SalesTrendChart: it pins a tooltip on
            touch/focus. The sr-only summary + detail panel stay accessible. */}
        <BarChart
          data={visible}
          layout="vertical"
          margin={{ top: 4, right: 72, bottom: 4, left: 4 }}
        >
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis
            type="category"
            dataKey="label"
            width={96}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: "var(--kova-muted)" }}
            tickFormatter={(value: string) => truncate(value)}
          />
          <Tooltip
            content={<RankTooltip total={total} />}
            cursor={{ fill: "var(--kova-mist)" }}
          />
          <Bar
            dataKey="value"
            radius={[0, 4, 4, 0]}
            maxBarSize={24}
            isAnimationActive={false}
            onClick={(entry: unknown) => {
              const id = (entry as { id?: string })?.id;
              if (id) toggle(id);
            }}
            onMouseEnter={(entry: unknown) => preview((entry as { id?: string })?.id ?? null)}
            onMouseLeave={() => preview(null)}
            className="cursor-pointer"
          >
            {visible.map((row) => {
              const isActive = row.id === activeId;
              const fill = somethingSelected ? (isActive ? ACCENT : MUTED) : ACCENT;
              return <Cell key={row.id} fill={fill} />;
            })}
            <LabelList
              dataKey="value"
              position="right"
              formatter={(value) => (valueFormatter ? valueFormatter(Number(value)) : String(value ?? ""))}
              className="fill-kova-muted"
              fontSize={11}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <ChartDetailPanel row={activeRow} total={total} />
    </ChartCard>
  );
}
