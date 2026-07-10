import type { ReactNode } from "react";

/**
 * Presentational shell for a report chart: title, one-line purpose subtitle,
 * an empty state, and a visually-hidden text summary that gives screen readers
 * (and tests) a stable, geometry-free view of the data. The chart itself is
 * passed as children.
 */
export function ChartCard({
  title,
  subtitle,
  srSummary,
  isEmpty,
  emptyLabel,
  children,
}: {
  title?: string;
  subtitle?: string;
  srSummary?: string;
  isEmpty: boolean;
  emptyLabel: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 tabular-nums">
      {title || subtitle ? (
        <div>
          {title ? <h3 className="text-sm font-semibold text-kova-ink">{title}</h3> : null}
          {subtitle ? <p className="mt-0.5 text-xs leading-5 text-kova-muted">{subtitle}</p> : null}
        </div>
      ) : null}
      {isEmpty ? (
        <div className="flex min-h-32 items-center justify-center rounded-kova-md border border-dashed border-kova-border bg-kova-mist/40 p-6 text-center text-sm text-kova-muted">
          {emptyLabel}
        </div>
      ) : (
        <>
          {srSummary ? <p className="sr-only tabular-nums">{srSummary}</p> : null}
          {children}
        </>
      )}
    </section>
  );
}
