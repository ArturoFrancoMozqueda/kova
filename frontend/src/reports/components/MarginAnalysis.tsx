import { CircleDollarSign, PackageCheck, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { copy } from "@/i18n/messages";
import { formatMoney } from "@/orders/format";
import type { BusinessStoryReport } from "../types";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-kova-md border border-kova-border bg-kova-mist px-3 py-2.5">
      <p className="text-xs text-kova-muted">{label}</p>
      <p className="mt-0.5 font-semibold tabular-nums text-kova-ink">{value}</p>
    </div>
  );
}

export function MarginAnalysis({ story }: { story: BusinessStoryReport }) {
  const margin = story.margin;
  const valuation = story.inventory_valuation;
  if (!margin || !valuation) return null;

  const summary = margin.summary;
  const complete = summary.complete && summary.gross_profit !== null;
  const rankedProducts = margin.by_product.slice(0, 3);

  return (
    <Card className="overflow-hidden border-kova-blue/20" data-testid="margin-analysis">
      <CardHeader className="gap-3 border-b border-kova-border bg-kova-blue/[0.03] sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold leading-none tracking-tight flex items-center gap-2">
            <CircleDollarSign className="h-5 w-5 text-kova-blue" />
            {copy.reportsView.marginTitle}
          </h2>
          <p className="mt-2 text-sm text-kova-muted">{copy.reportsView.marginBody}</p>
        </div>
        <Badge variant={complete ? "success" : "warning"}>
          {complete
            ? copy.reportsView.marginComplete
            : copy.reportsView.marginIncompleteBadge(summary.sold_products_without_cost)}
        </Badge>
      </CardHeader>
      <CardContent className="grid gap-5 pt-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <div>
          {complete ? (
            <>
              <p className="text-xs font-medium uppercase tracking-wide text-kova-tertiary">
                {copy.reportsView.grossProfit}
              </p>
              <div className="mt-1 flex flex-wrap items-end gap-3">
                <p className="text-3xl font-bold tabular-nums text-kova-ink">
                  {formatMoney(summary.gross_profit!)}
                </p>
                {summary.gross_margin_pct !== null ? (
                  <Badge variant="secondary">
                    {copy.reportsView.grossMarginPct(summary.gross_margin_pct)}
                  </Badge>
                ) : null}
              </div>
            </>
          ) : (
            <div className="rounded-kova-md border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                <div>
                  <p className="font-semibold text-kova-ink">{copy.reportsView.marginUnavailable}</p>
                  <p className="mt-1 text-sm text-kova-muted">
                    {copy.reportsView.marginMissingCost(summary.sold_products_without_cost)}
                  </p>
                  <Link className="mt-2 inline-flex text-sm font-semibold text-kova-blue hover:underline" to="/catalog">
                    {copy.reportsView.marginOpenCatalog}
                  </Link>
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Metric label={copy.reportsView.marginNetSales} value={formatMoney(summary.net_sales)} />
            <Metric
              label={copy.reportsView.cogs}
              value={summary.cogs === null ? copy.reportsView.notAvailable : formatMoney(summary.cogs)}
            />
          </div>
          <p className="mt-3 text-xs text-kova-muted">{copy.reportsView.marginMethodNote}</p>
        </div>

        <div className="space-y-4">
          <div className="rounded-kova-md border border-kova-border p-4">
            <div className="flex items-start gap-3">
              <PackageCheck className="mt-0.5 h-5 w-5 shrink-0 text-kova-blue" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-kova-ink">{copy.reportsView.inventoryValuation}</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-kova-ink">
                  {valuation.value === null
                    ? copy.reportsView.inventoryValuationIncomplete
                    : formatMoney(valuation.value)}
                </p>
                {valuation.value === null ? (
                  <p className="mt-1 text-xs text-kova-muted">
                    {copy.reportsView.inventoryKnownValue(
                      formatMoney(valuation.known_value),
                      valuation.products_without_cost,
                    )}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {rankedProducts.length > 0 ? (
            <div>
              <p className="mb-2 text-sm font-semibold text-kova-ink">
                {copy.reportsView.marginByProduct}
              </p>
              <div className="divide-y divide-kova-border rounded-kova-md border border-kova-border">
                {rankedProducts.map((product) => (
                  <div key={product.product_id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <span className="truncate text-sm text-kova-ink">{product.product_name}</span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-kova-ink">
                      {product.gross_profit === null
                        ? copy.reportsView.productWithoutCost
                        : formatMoney(product.gross_profit)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
