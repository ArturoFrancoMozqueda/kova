import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, PackageSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { copy } from "@/i18n/messages";
import {
  buildRestockPlan, inventoryProductLink, RESTOCK_HORIZONS, type RestockHorizon,
} from "@/inventory/restockPlan";
import type { InventoryVelocityItem, StockItem } from "@/inventory/types";
import { trackAnalysisActionStarted } from "@/telemetry/funnel";

const formatUnits = (units: number) => units.toLocaleString("es-MX", { maximumFractionDigits: 2 });

export function RestockPlan({
  stock, velocity, stockFailed, velocityFailed, horizon, onHorizonChange, onRetry,
}: {
  stock: StockItem[];
  velocity: InventoryVelocityItem[];
  stockFailed: boolean;
  velocityFailed: boolean;
  horizon: RestockHorizon;
  onHorizonChange: (horizon: RestockHorizon) => void;
  onRetry: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const plan = useMemo(() => buildRestockPlan(stock, velocity, horizon), [stock, velocity, horizon]);
  const text = copy.reportsView.restockPlan;
  const unavailable = stockFailed || velocityFailed;
  const items = expanded ? plan.items : plan.items.slice(0, 5);

  return (
    <Card data-testid="restock-plan" className="border-kova-blue/20">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <PackageSearch className="h-5 w-5 shrink-0 text-kova-blue" aria-hidden />
            {text.title}
          </CardTitle>
          <p className="mt-2 text-sm text-kova-muted">{text.body}</p>
        </div>
        <div className="shrink-0 space-y-2">
          <p className="text-sm font-medium text-kova-ink">{text.horizonLabel}</p>
          <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label={text.horizonLabel} className="flex gap-1">
            {RESTOCK_HORIZONS.map((days) => (
              <Button key={days} type="button" size="sm" className="min-h-11" variant={horizon === days ? "default" : "outline"}
                aria-pressed={horizon === days} onClick={() => onHorizonChange(days)}>
                {text.horizon(days)}
              </Button>
            ))}
          </div>
          {!unavailable ? <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={onRetry}>
            {text.retry}
          </Button> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {unavailable ? (
          <div role="status" className="space-y-2 text-sm text-kova-muted">
            <p>{text.unavailable}</p>
            <Button type="button" variant="outline" onClick={onRetry}>{text.retry}</Button>
          </div>
        ) : plan.trackedCount === 0 ? (
          <div className="space-y-2 text-sm text-kova-muted">
            <p>{text.noInventory}</p>
            <Link className="inline-flex min-h-11 items-center gap-1 rounded-kova-md font-medium text-kova-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue"
              to="/catalog">{text.activate}<ArrowRight className="h-4 w-4" aria-hidden /></Link>
          </div>
        ) : (
          <>
            {items.length === 0 ? <p className="text-sm text-kova-muted">
              {plan.unknownCount === plan.trackedCount ? text.insufficient : text.covered(horizon)}
            </p> : (
              <ul className="divide-y divide-kova-border" aria-label={text.title}>
                {items.map((item) => (
                  <li key={item.productId} className="space-y-2 py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-semibold text-kova-ink">{item.productName}</p>
                      <p className="text-sm font-semibold text-kova-blue">
                        {item.suggestedUnits === null ? text.review
                          : item.suggestedUnits > 0 ? text.suggested(item.suggestedUnits) : text.noPurchase}
                      </p>
                    </div>
                    <p className="text-sm text-kova-muted">
                      {item.available === null || item.reserved === null ? text.countFirst
                        : text.stock(item.stockOnHand, item.reserved, item.available)}
                    </p>
                    {item.suggestedUnits === null ? <p className="text-xs leading-5 text-kova-muted">{text.noEstimate}</p> : null}
                    <Link to={inventoryProductLink(item.productId)}
                      className="inline-flex min-h-11 items-center gap-1 rounded-kova-md text-sm font-medium text-kova-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue"
                      aria-label={text.openProduct(item.productName)}
                      onClick={() => {
                        if (item.suggestedUnits === null || item.suggestedUnits === 0) return;
                        void trackAnalysisActionStarted({
                          template_id: item.coverageDays !== null && item.coverageDays <= 3 ? "R2" : "R4",
                          decision_area: "inventario",
                          priority: item.coverageDays !== null && item.coverageDays <= 3 ? "alta" : "media",
                          surface: "plan",
                        });
                      }}>
                      {text.open}<ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {plan.items.length > 5 ? (
              <Button type="button" variant="ghost" size="sm" className="min-h-11" aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}>
                {expanded ? text.showLess : text.showAll(plan.items.length)}
              </Button>
            ) : null}
            {plan.unknownCount > 0 ? <p className="text-xs text-kova-muted">{text.unknown(plan.unknownCount)}</p> : null}
            <div className="border-t border-kova-border pt-3">
              <p className="text-xs leading-5 text-kova-muted">{text.reminder}</p>
              <Disclosure open={detailsOpen} onOpenChange={setDetailsOpen} trigger={text.details}
                triggerClassName="min-h-11 px-0 text-kova-muted" panelClassName="space-y-2 text-xs leading-5 text-kova-muted">
                <p>{text.window}</p>
                {items.map((item) => item.suggestedUnits !== null && item.unitsPerDay !== null && item.targetUnits !== null && item.available !== null ? (
                  <p key={item.productId}><span className="font-medium">{item.productName}: </span>
                    {text.basis(formatUnits(item.unitsPerDay), horizon, item.targetUnits, item.available)}
                  </p>
                ) : null)}
                <p>{text.note}</p>
              </Disclosure>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
