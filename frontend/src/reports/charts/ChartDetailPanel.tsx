import { copy } from "@/i18n/messages";
import type { ChartRow } from "./types";
import { percentOfTotal } from "./types";

/**
 * Persistent detail card shown below a chart for the actively selected row.
 * Renders nothing when there is no active row — the placeholder hint that used
 * to repeat on every chart is gone; the chart affordance and the pre-selected
 * best day carry the interaction instead.
 */
export function ChartDetailPanel({
  row,
  total,
  detailId,
}: {
  row: ChartRow | null;
  total: number;
  detailId?: string;
}) {
  if (!row) return null;
  return (
    <div id={detailId} className="mt-4 rounded-kova-md border border-kova-border bg-white p-3" role="status">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-kova-ink">{row.label}</p>
        <p className="text-sm font-bold tabular-nums text-kova-ink">{row.valueLabel}</p>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-kova-muted">
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
