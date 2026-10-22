import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { copy } from "@/i18n/messages";

/** Snapshot counts keep their backend scope: catalog/inventory are current;
 * closed shifts are the most recent 50, never a selected-period total. */
export function BusinessActivityRecap({ activeCatalogCount, trackedInventoryCount, closedShiftCount }: {
  activeCatalogCount: number;
  trackedInventoryCount: number;
  closedShiftCount: number;
}) {
  const metrics = [
    { label: copy.dashboard.activityCatalog, value: activeCatalogCount, to: "/catalog" },
    { label: copy.dashboard.activityInventory, value: trackedInventoryCount, to: "/inventory" },
    { label: copy.dashboard.activityShifts, value: closedShiftCount, to: "/shifts" },
  ];
  return (
    <section aria-labelledby="business-activity-title" className="border-t border-kova-border pt-6">
      <h2 id="business-activity-title" className="text-lg font-semibold tracking-tight">{copy.dashboard.activityTitle}</h2>
      <p className="mt-1 text-sm text-kova-muted">{copy.dashboard.activityBody}</p>
      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        {metrics.map(metric => (
          <div key={metric.to}>
            <dt>
              <Link to={metric.to} className="group flex min-h-11 items-center justify-between gap-3 rounded-kova-md pr-2 text-sm text-kova-muted hover:text-kova-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue">
                {metric.label}
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </dt>
            <dd className="text-2xl font-semibold tracking-tight tabular-nums">{metric.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-kova-muted">{copy.dashboard.activityCurrentScope} {copy.dashboard.activityShiftsScope}</p>
    </section>
  );
}
