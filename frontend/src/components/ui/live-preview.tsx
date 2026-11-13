import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Side-by-side render of what a draft will produce for customers or staff.
 *
 * The rendered artifact is non-interactive (`inert`): it reuses the real
 * customer-facing components, so their buttons must not become duplicate tab
 * stops. Screen readers get `summary` instead of the visual copy.
 */
export function LivePreview({
  label,
  summary,
  title = "Vista previa · Cambios sin guardar",
  note,
  frame,
  controls,
  selfContained = false,
  className,
  children,
}: {
  /** Accessible name of the landmark, e.g. "Vista previa del menú". */
  label: string;
  /** Plain-language description read by screen readers. */
  summary: string;
  title?: string;
  note?: ReactNode;
  /** Optional caption on top of a bordered page frame, e.g. "Así lo ven tus clientes". */
  frame?: { caption: string; icon?: ReactNode };
  /** Interactive controls that stay outside the inert render, e.g. view tabs. */
  controls?: ReactNode;
  /** The child already isolates itself from focus and clicks (e.g. DevicePreview), so it may scroll. */
  selfContained?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const inert = (selfContained ? {} : { inert: "", "aria-hidden": true }) as HTMLAttributes<HTMLDivElement>;
  const contentClass = selfContained ? undefined : "pointer-events-none select-none";
  return (
    <aside
      aria-label={label}
      className={cn("min-w-0 space-y-3 lg:sticky lg:top-6", className)}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-kova-muted">
        {title}
      </p>
      <p className="sr-only">{summary}</p>
      {controls}
      {frame ? (
        <div className="overflow-hidden rounded-3xl border border-kova-border bg-[#FAFAF7] shadow-kova-card">
          <div className="flex items-center gap-2 border-b border-kova-border bg-white px-4 py-2 text-xs font-medium text-kova-ink">
            <span className="flex gap-1" aria-hidden="true">
              <span className="h-2 w-2 rounded-full bg-kova-border" />
              <span className="h-2 w-2 rounded-full bg-kova-border" />
              <span className="h-2 w-2 rounded-full bg-kova-border" />
            </span>
            <span className="ml-1 flex min-w-0 items-center gap-1.5 truncate [&_svg]:shrink-0">
              {frame.icon}
              {frame.caption}
            </span>
          </div>
          <div {...inert} className={contentClass}>
            {children}
          </div>
        </div>
      ) : (
        <div {...inert} className={contentClass}>
          {children}
        </div>
      )}
      {note && <div className="text-xs text-kova-muted">{note}</div>}
    </aside>
  );
}
