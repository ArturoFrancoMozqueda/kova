import { CircleDollarSign, PackageCheck, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { copy } from "@/i18n/messages";
import { formatMoney } from "@/orders/format";
import { RankBars } from "@/components/visual";
import type { BusinessStoryReport } from "../types";

type MarginDay = NonNullable<BusinessStoryReport["margin"]>["by_day"][number];

const formatPct = (value: string) =>
  `${Number(value).toLocaleString("es-MX", { maximumFractionDigits: 1 })}%`;
const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/** Exact gross profit per day as light bars. Days with sold products without
 * cost have no exact profit: they keep their slot as an empty column instead
 * of being drawn as $0. */
function MarginTrend({ days }: { days: MarginDay[] }) {
  if (days.length < 2) return null;
  const exact = days.filter((day) => day.complete && day.gross_profit !== null);
  if (exact.length === 0) return null;
  const values = exact.map((day) => Number(day.gross_profit));
  const high = Math.max(1, ...values);
  const low = Math.min(0, ...values);
  const span = high - low;
  const width = 100 / days.length;
  const zero = (high / span) * 100;
  const best = exact.reduce((top, day) => (Number(day.gross_profit) > Number(top.gross_profit) ? day : top));
  const incomplete = days.length - exact.length;
  const summary = `Utilidad bruta por día. Mejor día ${shortDate(best.date)} con ${formatMoney(best.gross_profit!)}`
    + (incomplete > 0 ? `; ${incomplete} ${incomplete === 1 ? "día sin" : "días sin"} costo completo.` : ".");
  return (
    <div className="mt-4 rounded-kova-md border border-kova-border p-3" data-testid="margin-trend">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-kova-ink">Utilidad bruta por día</p>
        <p className="text-xs text-kova-muted">Mejor día: {shortDate(best.date)} · {formatMoney(best.gross_profit!)}</p>
      </div>
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="mt-3 h-24 w-full" role="img" aria-label={summary}>
        <line x1="0" x2="100" y1={(zero / 100) * 60} y2={(zero / 100) * 60} stroke="var(--kova-border)" vectorEffect="non-scaling-stroke" />
        {days.map((day, index) => {
          const x = index * width + width * 0.15;
          const barWidth = width * 0.7;
          if (!day.complete || day.gross_profit === null) {
            return <rect key={day.date} x={x} y={2} width={barWidth} height={56} rx={1} fill="none" stroke="var(--kova-border)" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />;
          }
          const value = Number(day.gross_profit);
          const top = ((high - Math.max(0, value)) / span) * 60;
          const height = (Math.abs(value) / span) * 60;
          return <rect key={day.date} x={x} y={value >= 0 ? top : (zero / 100) * 60} width={barWidth} height={Math.max(0.5, height)} rx={1}
            fill={value < 0 ? "var(--kova-danger)" : day.date === best.date ? "var(--kova-growth)" : "color-mix(in srgb, var(--kova-growth) 45%, white)"} />;
        })}
      </svg>
      <div aria-hidden="true" className="mt-1 flex justify-between text-[11px] tabular-nums text-kova-muted">
        <span>{shortDate(days[0].date)}</span><span>{shortDate(days[days.length - 1].date)}</span>
      </div>
      {incomplete > 0 ? <p className="mt-1 text-[11px] text-kova-muted">Las columnas punteadas son días con productos sin costo.</p> : null}
    </div>
  );
}

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
            <div className="rounded-kova-md border border-warning/30 bg-warning/10 p-4">
              <div className="flex items-start gap-3">
                <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning-strong" />
                <div>
                  <p className="font-semibold text-kova-ink">{copy.reportsView.marginUnavailable}</p>
                  <p className="mt-1 text-sm text-kova-muted">
                    {copy.reportsView.marginMissingCost(summary.sold_products_without_cost)}
                  </p>
                  <Link className="mt-2 inline-flex text-sm font-semibold text-kova-blue hover:underline" to="/catalog">
                    {copy.reportsView.marginOpenCatalog}
                  </Link>
                  {margin.by_product.some(product => product.missing_cost) && <details className="mt-3 text-sm">
                    <summary className="min-h-11 cursor-pointer py-2 font-medium text-kova-ink">Revisar los productos sin costo</summary>
                    <p className="mb-2 text-xs leading-relaxed text-kova-muted">Completar el costo actual sirve para las próximas ventas que registres. Las ventas anteriores conservan su costo histórico.</p>
                    <ul className="space-y-1">{margin.by_product.filter(product => product.missing_cost).map(product => <li key={product.product_id}><Link className="inline-flex min-h-11 items-center text-kova-blue underline" to={`/catalog?edit=${encodeURIComponent(product.product_id)}`}>Revisar costo de {product.product_name}</Link></li>)}</ul>
                  </details>}
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
          <MarginTrend days={margin.by_day} />
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
              <div className="rounded-kova-md border border-kova-border p-3">
                <RankBars
                  label={copy.reportsView.marginByProduct}
                  emptyLabel={copy.reportsView.notAvailable}
                  tone="growth"
                  rows={rankedProducts.map((product) => ({
                    id: product.product_id,
                    label: product.product_name,
                    value: Number(product.gross_profit ?? 0),
                    valueLabel: product.gross_profit === null
                      ? copy.reportsView.productWithoutCost
                      : formatMoney(product.gross_profit),
                    detail: product.gross_margin_pct === null
                      ? undefined
                      : `Margen ${formatPct(product.gross_margin_pct)}`,
                  }))}
                />
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
