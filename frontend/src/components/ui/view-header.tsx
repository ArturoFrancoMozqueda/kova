import type { ReactNode } from "react";

/**
 * Standard header for a top-level view: optional uppercase-ish eyebrow, a
 * tight-tracked h1, an optional right-aligned actions slot (filters, buttons,
 * a whole form), and an optional small meta line below (e.g. timezone).
 *
 * Extracted from Reportes so every tab leads with the same anatomy. `actions`
 * is rendered as-is (no wrapper) so callers keep full control of its layout —
 * the row aligns items to the baseline and pushes actions to the right on `sm+`.
 */
export function ViewHeader({
  eyebrow,
  title,
  actions,
  meta,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {eyebrow ? (
            <p className="mb-1 text-sm font-medium text-kova-blue/80">{eyebrow}</p>
          ) : null}
          <h1 className="text-3xl font-bold tracking-[-0.035em] text-kova-ink">{title}</h1>
        </div>
        {actions}
      </div>
      {meta ? <p className="text-sm text-muted-foreground">{meta}</p> : null}
    </div>
  );
}
