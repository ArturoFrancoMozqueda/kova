import type { ReactNode } from "react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { copy } from "@/i18n/messages";
import { cn } from "@/lib/utils";
import { formatMoneyDelta } from "@/orders/format";
import { formatSignedPercent } from "../utils/format";
import type { GrowthResult } from "../utils/calculations";

export type StatTileTone = "blue" | "mint" | "sky";

const TONE_BG: Record<StatTileTone, string> = {
  blue: "bg-kova-grad-blue",
  mint: "bg-kova-grad-mint",
  sky: "bg-kova-grad-sky",
};

/** KPI tile mirroring the dashboard Panel anatomy: uppercase label + icon tile,
 * a large tabular value, and a delta/comparison line below. Each tile carries a
 * soft pastel gradient wash (brand blue / growth mint family) with ink text on
 * top, so the KPI row reads premium without leaving the single-hue system. */
export function StatTile({
  label,
  value,
  icon,
  tone = "sky",
  children,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  tone?: StatTileTone;
  children?: ReactNode;
}) {
  return (
    <div className={`rounded-kova-lg border border-kova-border p-5 shadow-kova-card ${TONE_BG[tone]}`}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wide text-kova-muted">{label}</p>
        <span className="flex h-9 w-9 items-center justify-center rounded-kova-md bg-white/70 text-kova-muted">
          {icon}
        </span>
      </div>
      <p className="mt-3 text-2xl font-bold tabular-nums text-kova-ink">{value}</p>
      <div className="mt-1 min-h-5">{children}</div>
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
