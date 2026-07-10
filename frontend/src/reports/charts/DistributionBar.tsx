import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";

import { ChartCard } from "./ChartCard";

/** One slice of a 100% composition (e.g. a payment method). */
export type DistributionSegment = {
  id: string;
  label: string;
  value: number;
  valueLabel: string;
  /** Share of the total in percent, as reported by the backend. */
  sharePct: number;
  /** Optional muted annotation for the legend row (e.g. "6 transacciones"). */
  meta?: string;
};

// Single-hue ramp (brand blue family), strongest share first.
const SEGMENT_FILLS = [
  "var(--kova-blue)",
  "var(--kova-blue-light)",
  "#A9C6FF",
  "#C9D9FF",
  "var(--kova-tertiary)",
];

function segmentRadius(index: number, count: number): [number, number, number, number] {
  if (count === 1) return [6, 6, 6, 6];
  if (index === 0) return [6, 0, 0, 6];
  if (index === count - 1) return [0, 6, 6, 0];
  return [0, 0, 0, 0];
}

/**
 * A single stacked 100% bar for composition data ("how the whole splits"),
 * plus a legend where each slice appears exactly once: color swatch, label,
 * share, amount and optional meta. No tooltip and no detail panel — the bar
 * shows proportion, the legend carries the precise numbers.
 */
export function DistributionBar({
  segments,
  emptyLabel,
  srSummary,
  subtitle,
}: {
  segments: DistributionSegment[];
  emptyLabel: string;
  srSummary?: string;
  subtitle?: string;
}) {
  const visible = [...segments]
    .filter((segment) => segment.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = visible.reduce((sum, segment) => sum + segment.value, 0);
  const data = [
    Object.fromEntries([["name", "mix"], ...visible.map((segment) => [segment.id, segment.value])]),
  ];

  return (
    <ChartCard subtitle={subtitle} srSummary={srSummary} isEmpty={visible.length === 0} emptyLabel={emptyLabel}>
      <ResponsiveContainer width="100%" height={40}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 0, bottom: 4, left: 0 }}>
          <XAxis type="number" hide domain={[0, total]} />
          <YAxis type="category" dataKey="name" hide />
          {visible.map((segment, index) => (
            <Bar
              key={segment.id}
              dataKey={segment.id}
              stackId="mix"
              fill={SEGMENT_FILLS[index % SEGMENT_FILLS.length]}
              radius={segmentRadius(index, visible.length)}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <ul className="mt-1 space-y-2">
        {visible.map((segment, index) => (
          <li key={segment.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: SEGMENT_FILLS[index % SEGMENT_FILLS.length] }}
              />
              <span className="font-medium text-kova-ink">{segment.label}</span>
            </span>
            <span className="font-semibold tabular-nums text-kova-ink">{segment.sharePct}%</span>
            <span className="tabular-nums text-kova-muted">{segment.valueLabel}</span>
            {segment.meta ? <span className="text-xs text-kova-muted">{segment.meta}</span> : null}
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}
