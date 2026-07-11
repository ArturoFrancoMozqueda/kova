import type { ReactNode } from "react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { copy } from "@/i18n/messages";
import { cn } from "@/lib/utils";
import { formatMoneyDelta } from "@/orders/format";
import { formatSignedPercent } from "@/lib/format";
import type { GrowthResult } from "@/lib/growth";

/** KPI tile mirroring the dashboard Panel anatomy: uppercase label + icon tile,
 * a large tabular value, and a delta/comparison line below. Deliberately sober:
 * white surface, thin border, light shadow, strong number — the only color on
 * the tile is the delta's up/down tone. Shared across tabs (Panel, Reportes). */
export function StatTile({
  label,
  value,
  icon,
  children,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  children?: ReactNode;
}) {
  return (
    // Phones get a compact row (value + delta side by side, no icon) so the
    // three KPIs cost about a third of the vertical space before "Qué hacer
    // ahora"; from `sm` up it's the full tile.
    <div className="rounded-kova-lg border border-kova-border bg-white p-4 shadow-kova-card sm:p-5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wide text-kova-tertiary">{label}</p>
        <span className="hidden h-9 w-9 items-center justify-center rounded-kova-md bg-kova-mist text-kova-muted sm:flex">
          {icon}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 sm:mt-3 sm:block">
        <p className="text-xl font-bold tabular-nums text-kova-ink sm:text-2xl">{value}</p>
        <div className="sm:mt-1 sm:min-h-5">{children}</div>
      </div>
    </div>
  );
}

/**
 * Period-over-period delta line for a KPI tile. Renders honestly for each
 * GrowthResult kind: a real signed percentage with the absolute delta in
 * parentheses, an absolute-only delta when the base is too small, "Nuevo",
 * or a neutral "no comparison" note. Never shows a misleading -100%.
 */
export function DeltaChip({
  growth,
  current,
  previous,
  format,
}: {
  growth: GrowthResult;
  current: number;
  previous: number;
  format: "money" | "count";
}) {
  const absDelta = current - previous;
  const absLabel =
    format === "money"
      ? formatMoneyDelta(String(absDelta))
      : `${absDelta > 0 ? "+" : absDelta < 0 ? "−" : ""}${Math.abs(absDelta)}`;

  if (growth.kind === "no-previous") {
    return <span className="text-xs text-kova-muted">{copy.reportsView.deltaNoPrevious}</span>;
  }
  if (growth.kind === "new") {
    return <span className="text-xs text-kova-muted">{copy.reportsView.deltaNew}</span>;
  }
  if (growth.kind === "flat") {
    return (
      <span className="flex items-center gap-0.5 text-xs text-kova-muted">
        <Minus className="h-3 w-3" />
        {copy.reportsView.deltaVsPrevious}
      </span>
    );
  }

  const tone = growth.kind === "pct" ? (growth.value > 0 ? "up" : "down") : absDelta >= 0 ? "up" : "down";
  const pctLabel = growth.kind === "pct" ? `${formatSignedPercent(growth.value)} ` : "";

  return (
    <span
      className={cn(
        "flex items-center gap-1 text-xs font-medium",
        tone === "up" ? "text-kova-growth" : "text-destructive",
      )}
    >
      {tone === "up" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      <span className="tabular-nums">
        {pctLabel}
        <span className="text-kova-muted">({absLabel})</span>
      </span>
    </span>
  );
}
