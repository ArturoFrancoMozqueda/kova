import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";

import { ChartCard } from "./ChartCard";
import { ChartDetailPanel } from "./ChartDetailPanel";
import { useChartSelection } from "./useChartSelection";
import type { ChartRow } from "./types";

const ACCENT = "var(--kova-blue)";
const MUTED = "var(--kova-blue-light)";

function truncate(label: string, max = 16): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/**
 * Horizontal magnitude bars for a small set of categories (top hours,
 * employees). Single hue over a full-width rail, so each bar reads as
 * "relative to the leader" at a glance. Every number lives in exactly one
 * place: the value at the bar end, and the extended metadata in the
 * persistent detail card below (live on hover, locked on click/tap) — no
 * tooltip repeating the same figures on top of the chart.
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
          <Bar
            dataKey="value"
            radius={[0, 6, 6, 0]}
            maxBarSize={24}
            background={{ fill: "var(--kova-mist)", radius: 6 }}
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
