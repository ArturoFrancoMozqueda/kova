/**
 * Kova's shared visual language ("muéstralo, no lo describas"). Every screen
 * draws quantities, progress, people and mixes with these pieces so the app
 * looks the same everywhere. Lightweight HTML/SVG only: no chart library, no
 * entrance animation (see docs/claude/motion-system.md), always a text
 * equivalent for screen readers, and only real data from the screen's API.
 */
import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { avatarColorFor } from "@/lib/avatarColor";
import { cn } from "@/lib/utils";

export type VisualTone = "ink" | "blue" | "growth" | "warning" | "danger" | "muted";

const toneFill: Record<VisualTone, string> = {
  ink: "bg-kova-ink",
  blue: "bg-kova-blue",
  growth: "bg-kova-growth",
  warning: "bg-warning",
  danger: "bg-kova-danger",
  muted: "bg-kova-tertiary",
};

/** Categorical palette from brand tokens; order is stable for legends. */
export const chartPalette = ["#3563D0", "#0F1117", "#16A37F", "#8659D9", "#B46D12", "#0EA5E9"] as const;

const clampPct = (value: number, max: number) => (max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0);

/**
 * A single quantity against a maximum (stock vs. minimum, received vs.
 * ordered, days used vs. period). `marker` draws a reference line such as the
 * minimum stock.
 */
export function Meter({
  label,
  value,
  max,
  valueLabel,
  marker,
  markerLabel,
  tone = "blue",
  size = "md",
  showLabel = false,
  className,
}: {
  label: string;
  value: number;
  max: number;
  valueLabel: string;
  marker?: number;
  markerLabel?: string;
  tone?: VisualTone;
  size?: "sm" | "md";
  showLabel?: boolean;
  className?: string;
}) {
  // Never render an invalid meter (e.g. a field missing from an older payload).
  if (!Number.isFinite(value) || !Number.isFinite(max)) return null;
  const safeMax = Math.max(max, marker ?? 0, value, 1);
  return (
    <div className={cn("min-w-0", className)}>
      {showLabel && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
          <span className="truncate text-kova-muted">{label}</span>
          <span className="shrink-0 font-semibold tabular-nums text-kova-ink">{valueLabel}</span>
        </div>
      )}
      <div
        role="meter"
        aria-label={`${label}: ${valueLabel}${markerLabel ? ` · ${markerLabel}` : ""}`}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={Math.max(0, value)}
        className={cn("relative overflow-hidden rounded-full bg-kova-mist", size === "sm" ? "h-1.5" : "h-2")}
      >
        <div className={cn("h-full rounded-full", toneFill[tone])} style={{ width: `${clampPct(value, safeMax)}%` }} />
        {marker !== undefined && marker > 0 && (
          <span aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-kova-ink/70" style={{ left: `calc(${clampPct(marker, safeMax)}% - 1px)` }} />
        )}
      </div>
    </div>
  );
}

export type RankRow = { id: string; label: string; value: number; valueLabel: string; detail?: string; leading?: ReactNode };

/** Ranked horizontal bars (top products, reasons, categories). The first row is emphasised. */
export function RankBars({ rows, label, emptyLabel, tone = "blue", className }: {
  rows: RankRow[];
  label: string;
  emptyLabel: string;
  tone?: VisualTone;
  className?: string;
}) {
  if (!rows.length) return <p className={cn("py-4 text-sm text-kova-muted", className)}>{emptyLabel}</p>;
  const max = Math.max(1, ...rows.map(row => row.value));
  return (
    <ol aria-label={label} className={cn("space-y-3.5", className)}>
      {rows.map((row, index) => (
        <li key={row.id} className="flex items-center gap-3">
          {row.leading}
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate" title={row.label}>{row.label}</span>
              <strong className="shrink-0 font-semibold tabular-nums">{row.valueLabel}</strong>
            </div>
            <div aria-hidden="true" className="h-2 rounded-full bg-kova-mist">
              <div className={cn("h-full rounded-full", index === 0 ? toneFill[tone] : `${toneFill[tone]} opacity-40`)} style={{ width: `${clampPct(Math.max(0, row.value), max)}%` }} />
            </div>
            {row.detail && <p className="mt-1 text-[11px] text-kova-muted">{row.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export type Slice = { id: string; label: string; value: number; valueLabel: string };

/** Share of a whole (payment mix, expense categories). Legend always lists text values. */
export function DonutChart({ slices, label, centerLabel, centerValue, emptyLabel }: {
  slices: Slice[];
  label: string;
  centerLabel: string;
  centerValue: string;
  emptyLabel: string;
}) {
  const positive = slices.filter(slice => slice.value > 0);
  const total = positive.reduce((sum, slice) => sum + slice.value, 0);
  if (!total) return <p className="py-4 text-sm text-kova-muted">{emptyLabel}</p>;
  let offset = 0;
  const gradient = positive.map((slice, index) => {
    const start = offset;
    offset += (slice.value / total) * 100;
    return `${chartPalette[index % chartPalette.length]} ${start}% ${offset}%`;
  }).join(",");
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div role="img" aria-label={`${label}: ${positive.map(slice => `${slice.label} ${Math.round((slice.value / total) * 100)}%`).join(", ")}`}
        className="relative h-28 w-28 shrink-0 rounded-full" style={{ background: `conic-gradient(${gradient})` }}>
        <div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-white text-center">
          <span className="text-[10px] text-kova-muted">{centerLabel}</span>
          <strong className="text-xs tabular-nums">{centerValue}</strong>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-2">
        {positive.map((slice, index) => (
          <li key={slice.id} className="flex items-center gap-2 text-xs">
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: chartPalette[index % chartPalette.length] }} />
            <span className="min-w-0 flex-1 truncate">{slice.label}</span>
            <strong className="tabular-nums">{Math.round((slice.value / total) * 100)}%</strong>
            <span className="tabular-nums text-kova-muted">{slice.valueLabel}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Stacked segments of one total (available / reserved / incoming). */
export function StackedBar({ segments, label }: {
  segments: { id: string; label: string; value: number; tone: VisualTone }[];
  label: string;
}) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  return (
    <div className="min-w-0">
      <div role="img" aria-label={`${label}: ${segments.map(segment => `${segment.label} ${segment.value}`).join(", ")}`}
        className="flex h-2.5 overflow-hidden rounded-full bg-kova-mist">
        {total > 0 && segments.map(segment => segment.value > 0 && (
          <span key={segment.id} className={cn("h-full", toneFill[segment.tone])} style={{ width: `${(segment.value / total) * 100}%` }} />
        ))}
      </div>
      <ul aria-hidden="true" className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-kova-muted">
        {segments.map(segment => (
          <li key={segment.id} className="inline-flex items-center gap-1">
            <span className={cn("h-2 w-2 rounded-full", toneFill[segment.tone])} />{segment.label} <span className="tabular-nums text-kova-ink">{segment.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const initials = (name: string) => {
  const words = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  const letters = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2));
  return letters.toLocaleUpperCase("es-MX");
};

/** Person without a photo: stable color per name, initials, decorative. */
export function InitialsAvatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span aria-hidden="true" style={{ backgroundColor: avatarColorFor(name || "?") }}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        size === "sm" ? "h-7 w-7 text-[11px]" : size === "lg" ? "h-12 w-12 text-base" : "h-9 w-9 text-xs", className)}>
      {initials(name)}
    </span>
  );
}

/** Compact progress through ordered steps (order lifecycle, onboarding). */
export function StepStrip({ steps, current, label }: { steps: { id: string; label: string }[]; current: number; label: string }) {
  return (
    <ol aria-label={label} className="flex min-w-0 items-center gap-1">
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step.id} className="flex min-w-0 flex-1 items-center gap-1" aria-current={active ? "step" : undefined}>
            <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
              done && "border-kova-growth bg-kova-growth text-white",
              active && "border-kova-blue bg-kova-blue",
              !done && !active && "border-kova-border bg-white")}>
              {done && <Check className="h-2.5 w-2.5" aria-hidden="true" />}
            </span>
            <span className="sr-only">{step.label}{done ? " (completado)" : active ? " (actual)" : ""}</span>
            {index < steps.length - 1 && <span aria-hidden="true" className={cn("h-0.5 flex-1 rounded-full", done ? "bg-kova-growth" : "bg-kova-border")} />}
          </li>
        );
      })}
    </ol>
  );
}

/** Small KPI card: label, value, optional icon and footnote. Same look as Panel's KPI row. */
export function KpiCard({ label, value, icon, note, emphasis = false, className }: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  note?: ReactNode;
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-kova-xl border p-3 sm:p-4", emphasis ? "border-kova-ink bg-kova-ink text-white" : "border-kova-border bg-white", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className={cn("text-xs font-medium", emphasis ? "text-white/80" : "text-kova-muted")}>{label}</p>
        {icon && <span aria-hidden="true" className="[&_svg]:h-4 [&_svg]:w-4">{icon}</span>}
      </div>
      <p className="mt-2 break-words text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">{value}</p>
      {note && <div className={cn("mt-1 text-[11px]", emphasis ? "text-white/80" : "text-kova-muted")}>{note}</div>}
    </div>
  );
}
