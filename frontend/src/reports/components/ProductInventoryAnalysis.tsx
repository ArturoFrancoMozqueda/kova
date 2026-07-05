import { useState } from "react";
import { Package } from "lucide-react";

import { copy } from "@/i18n/messages";
import { formatMoney } from "@/orders/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { InventoryVelocityItem, StockItem } from "../../inventory/types";
import type { BusinessStoryReport, ProductTrendRow } from "../types";
import {
  type InventoryStatus,
  getInventoryStatus,
  parseDaysUntilOut,
} from "../utils/calculations";
import { formatSignedPercent } from "../utils/format";
import { ReportSection } from "./ReportSection";

const COLLAPSED_ROWS = 10;

type ProductRow = {
  productId: string;
  productName: string;
  grossSales: string;
  quantitySold: number;
  salesSharePct: number;
  tracked: boolean;
  stockOnHand: number | null;
  daysUntilOut: number | null;
  status: InventoryStatus;
  trend?: ProductTrendRow;
};

function statusBadgeVariant(kind: InventoryStatus["kind"]) {
  switch (kind) {
    case "riesgo":
      return "destructive" as const;
    case "reabastecer":
    case "en-caida":
      return "warning" as const;
    case "creciendo":
      return "success" as const;
    case "estrella":
      return "default" as const;
    default:
      return "outline" as const;
  }
}

function statusDetail(status: InventoryStatus): string | null {
  switch (status.kind) {
    case "riesgo":
      return copy.reportsView.statusRiesgoDetail(status.stockOnHand);
    case "reabastecer":
      return copy.reportsView.statusReabastecerDetail(status.daysUntilOut);
    case "sobrestock":
      return copy.reportsView.statusSobrestockDetail;
    case "estrella":
      return copy.reportsView.statusEstrellaDetail(status.sharePct);
    case "en-caida":
      return copy.reportsView.statusEnCaidaDetail(status.previousUnits, status.currentUnits);
    case "creciendo":
      return copy.reportsView.statusCreciendoDetail;
    case "baja-rotacion":
      return copy.reportsView.statusBajaRotacionDetail;
    case "sin-vincular":
      return copy.reportsView.statusSinVincularDetail;
    default:
      return null;
  }
}

function TrendChip({ trend }: { trend?: ProductTrendRow }) {
  const chip = trendChip(trend);
  if (!chip) return <span className="text-xs text-kova-muted">{copy.reportsView.trendNone}</span>;
  return (
    <span
      className={cn(
        "text-xs font-medium tabular-nums",
        chip.tone === "up" ? "text-kova-growth" : chip.tone === "down" ? "text-destructive" : "text-kova-muted",
      )}
    >
      {chip.label}
    </span>
  );
}

function trendChip(trend?: ProductTrendRow): { label: string; tone: "up" | "down" | "neutral" } | null {
  if (!trend) return null;
  if (trend.trend === "lost") return { label: copy.reportsView.trendLost, tone: "down" };
  if (trend.trend === "new") return { label: copy.reportsView.trendNew, tone: "up" };
  const tone = trend.current_units >= trend.previous_units ? "up" : "down";
  // Tiny base or extreme swing → absolute units instead of a misleading %.
  if (trend.previous_units < 5 || Number(trend.previous_gross) < 200 || Math.abs(trend.delta_pct) > 300) {
    return { label: copy.reportsView.trendUnitsDelta(trend.previous_units, trend.current_units), tone };
  }
  return { label: formatSignedPercent(trend.delta_pct), tone: trend.delta_pct >= 0 ? "up" : "down" };
}

function inventoryLabel(row: ProductRow): { value: string; muted: boolean } {
  if (!row.tracked) return { value: copy.reportsView.inventoryUnlinked, muted: true };
  return { value: String(row.stockOnHand ?? 0), muted: false };
}

function daysLabel(row: ProductRow): string {
  if (!row.tracked || row.daysUntilOut === null) return copy.reportsView.factEmpty;
  return copy.reportsView.inventoryDaysLeft(Math.max(0, Math.round(row.daysUntilOut)));
}

function buildRows(
  story: BusinessStoryReport,
  stock: StockItem[],
  velocity: InventoryVelocityItem[],
): ProductRow[] {
  const trackedIds = new Set(stock.map((item) => item.product_id));
  const stockByProduct = new Map(stock.map((item) => [item.product_id, item]));
  const velocityByProduct = new Map(velocity.map((item) => [item.product_id, item]));
  const trends = story.product_trends;
  const trendByProduct = new Map<string, ProductTrendRow>();
  for (const row of [...(trends?.growing ?? []), ...(trends?.declining ?? []), ...(trends?.slow_movers ?? [])]) {
    trendByProduct.set(row.product_id, row);
  }
  const slowMoverIds = new Set((trends?.slow_movers ?? []).map((row) => row.product_id));
  const criticalIds = new Set(
    (story.restock_alerts ?? [])
      .filter((alert) => alert.severity === "critical")
      .map((alert) => alert.product_id),
  );
  const driverCount = story.product_drivers.length;

  return story.product_drivers.map((driver) => {
    const tracked = trackedIds.has(driver.product_id);
    const stockItem = stockByProduct.get(driver.product_id);
    const velocityItem = velocityByProduct.get(driver.product_id);
    const trend = trendByProduct.get(driver.product_id);
    const status = getInventoryStatus({
      tracked,
      stock: stockItem,
      velocity: velocityItem,
      trend,
      isSlowMover: slowMoverIds.has(driver.product_id),
      criticalRestock: criticalIds.has(driver.product_id),
      quantitySold: driver.quantity_sold,
      salesSharePct: driver.sales_share_pct,
      driverCount,
    });
    return {
      productId: driver.product_id,
      productName: driver.product_name,
      grossSales: driver.gross_sales,
      quantitySold: driver.quantity_sold,
      salesSharePct: driver.sales_share_pct,
      tracked,
      stockOnHand: tracked ? (stockItem?.stock_on_hand ?? velocityItem?.stock_on_hand ?? 0) : null,
      daysUntilOut: parseDaysUntilOut(velocityItem?.days_until_out),
      status,
      trend,
    };
  });
}

function CriticalRestockStrip({ story }: { story: BusinessStoryReport }) {
  const critical = (story.restock_alerts ?? []).filter((a) => a.severity === "critical").slice(0, 3);
  if (critical.length === 0) return null;
  return (
    <div className="mb-4 space-y-2">
      {critical.map((alert) => (
        <div
          key={alert.product_id}
          className="flex items-baseline justify-between gap-3 rounded-kova-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
        >
          <div className="min-w-0">
            <p className="truncate font-medium">{alert.product_name}</p>
            <p className="text-xs text-muted-foreground">{alert.detail}</p>
          </div>
          <Badge variant="destructive">{copy.reportsView.restockSeverityCritical}</Badge>
        </div>
      ))}
    </div>
  );
}

export function ProductInventoryAnalysis({
  story,
  stock,
  velocity,
}: {
  story: BusinessStoryReport;
  stock: StockItem[];
  velocity: InventoryVelocityItem[];
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = buildRows(story, stock, velocity);
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
  const hasMore = rows.length > COLLAPSED_ROWS;

  return (
    <ReportSection
      icon={<Package className="h-5 w-5 text-muted-foreground" />}
      title={copy.reportsView.productInventoryTitle}
      description={copy.reportsView.productInventoryDescription}
    >
      <CriticalRestockStrip story={story} />
      {rows.length === 0 ? (
        <p className="rounded-kova-md border border-dashed bg-muted/30 p-5 text-sm text-muted-foreground">
          {copy.reportsView.noProducts}
        </p>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="space-y-3 sm:hidden">
            {visible.map((row) => {
              const inventory = inventoryLabel(row);
              const detail = statusDetail(row.status);
              return (
                <div key={row.productId} className="space-y-2 rounded-kova-md border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="line-clamp-2 flex-1 text-sm font-medium leading-snug" title={row.productName}>
                      {row.productName}
                    </p>
                    <Badge variant={statusBadgeVariant(row.status.kind)} className="shrink-0">
                      {copy.reportsView.inventoryStatusLabel(row.status.kind)}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {copy.reportsView.salesColumn}
                      </p>
                      <p className="font-semibold tabular-nums">{formatMoney(row.grossSales)}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {copy.reportsView.chartShare(row.salesSharePct)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {copy.reportsView.unitsColumn}
                      </p>
                      <p className="font-semibold tabular-nums">{row.quantitySold}</p>
                      <p className={cn("text-[11px]", inventory.muted && "text-muted-foreground")}>
                        {copy.reportsView.inventoryColumn}: {inventory.value}
                      </p>
                    </div>
                  </div>
                  {detail ? (
                    <p className="border-t pt-2 text-xs leading-5 text-muted-foreground">{detail}</p>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* Tablet/desktop: table (Tendencia column hidden below lg) */}
          <div className="hidden overflow-x-auto rounded-kova-md border sm:block">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">{copy.reportsView.productColumn}</th>
                  <th className="px-4 py-3 font-medium">{copy.reportsView.salesColumn}</th>
                  <th className="px-4 py-3 font-medium">{copy.reportsView.unitsColumn}</th>
                  <th className="px-4 py-3 font-medium">{copy.reportsView.inventoryColumn}</th>
                  <th className="px-4 py-3 font-medium">{copy.reportsView.daysLeftColumn}</th>
                  <th className="hidden px-4 py-3 font-medium lg:table-cell">{copy.reportsView.trendColumn}</th>
                  <th className="px-4 py-3 font-medium">{copy.reportsView.statusColumn}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map((row) => {
                  const inventory = inventoryLabel(row);
                  const detail = statusDetail(row.status);
                  return (
                    <tr key={row.productId} className="align-top">
                      <td className="max-w-[220px] px-4 py-3 font-medium">
                        <span className="line-clamp-2" title={row.productName}>
                          {row.productName}
                        </span>
                        <span className="mt-1 block lg:hidden">
                          <TrendChip trend={row.trend} />
                        </span>
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {formatMoney(row.grossSales)}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {copy.reportsView.chartShare(row.salesSharePct)}
                        </span>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{row.quantitySold}</td>
                      <td className={cn("px-4 py-3 tabular-nums", inventory.muted && "text-muted-foreground")}>
                        {inventory.value}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">{daysLabel(row)}</td>
                      <td className="hidden px-4 py-3 lg:table-cell">
                        <TrendChip trend={row.trend} />
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={statusBadgeVariant(row.status.kind)}>
                          {copy.reportsView.inventoryStatusLabel(row.status.kind)}
                        </Badge>
                        {detail ? (
                          <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">{detail}</p>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {hasMore ? (
            <div className="mt-3">
              <Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
                {expanded ? copy.reportsView.productsShowLess : copy.reportsView.productsShowAll(rows.length)}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </ReportSection>
  );
}
