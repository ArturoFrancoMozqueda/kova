import { useEffect, useState } from "react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { copy } from "@/i18n/messages";
import { formatMoney } from "@/orders/format";
import { getTopProducts } from "@/reports/api";
import { listStock } from "@/inventory/api";
import { daysAgoInTimezone, todayInTimezone } from "@/i18n/date";
import { useTenantTimezone } from "@/hooks/useTenantTimezone";
import type { Product } from "./types";
import type { StockItem } from "@/inventory/types";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Package,
  AlertTriangle,
  AlertCircle,
  Sparkles,
} from "lucide-react";

type Props = {
  product: Product;
  open: boolean;
  onClose: () => void;
};

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "loaded";
      units: number;
      gross: string;
      prevUnits: number | null;
      stock: StockItem | null;
    };

function pctRound(pct: number): number {
  const abs = Math.abs(pct);
  return abs < 1 ? 1 : Math.round(abs);
}

export function ProductStoryCard({ product, open, onClose }: Props) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const { timezone: tz } = useTenantTimezone();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setState({ status: "loading" });
      try {
        const end = todayInTimezone(tz);
        const start = daysAgoInTimezone(tz, 29);
        const prevEnd = daysAgoInTimezone(tz, 30);
        const prevStart = daysAgoInTimezone(tz, 59);
        const [current, previous, stock] = await Promise.all([
          getTopProducts(start, end, 50),
          getTopProducts(prevStart, prevEnd, 50),
          product.track_inventory
            ? listStock().catch(() => [] as StockItem[])
            : Promise.resolve([] as StockItem[]),
        ]);
        if (cancelled) return;
        const curr = current.products.find((p) => p.product_id === product.id);
        const prev = previous.products.find((p) => p.product_id === product.id);
        const stockItem = stock.find((s) => s.product_id === product.id) ?? null;
        setState({
          status: "loaded",
          units: curr?.quantity_sold ?? 0,
          gross: curr?.gross_sales ?? "0",
          prevUnits: prev ? prev.quantity_sold : null,
          stock: stockItem,
        });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, product.id, product.track_inventory, tz]);

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-kova-blue" />
          {copy.productStory.title}
        </DialogTitle>
        <DialogDescription>
          {product.name} · {copy.productStory.last30}
        </DialogDescription>
      </DialogHeader>

      {state.status === "loading" && (
        <div className="space-y-3 py-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {state.status === "error" && (
        <div className="flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
          <p className="text-sm text-destructive">{copy.reportsView.loadError}</p>
        </div>
      )}

      {state.status === "loaded" && (
        <ProductStoryContent
          units={state.units}
          gross={state.gross}
          prevUnits={state.prevUnits}
          stock={state.stock}
          tracked={product.track_inventory}
        />
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {copy.productStory.close}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function ProductStoryContent({
  units,
  gross,
  prevUnits,
  stock,
  tracked,
}: {
  units: number;
  gross: string;
  prevUnits: number | null;
  stock: StockItem | null;
  tracked: boolean;
}) {
  // Delta vs prior 30 days
  let deltaPct: number | null = null;
  let deltaState: "up" | "down" | "flat" | "none" = "none";
  if (prevUnits == null || prevUnits === 0) {
    deltaState = units > 0 ? "up" : "none";
  } else {
    deltaPct = ((units - prevUnits) / prevUnits) * 100;
    if (deltaPct > 5) deltaState = "up";
    else if (deltaPct < -5) deltaState = "down";
    else deltaState = "flat";
  }

  const stockLow = stock?.is_low_stock ?? false;
  const stockEmpty = (stock?.stock_on_hand ?? 0) === 0;

  let suggestion = copy.productStory.suggestionSteady;
  if (units === 0) suggestion = copy.productStory.suggestionInactive;
  else if (tracked && (stockEmpty || stockLow) && deltaState !== "down")
    suggestion = copy.productStory.suggestionRestock;
  else if (deltaState === "up") suggestion = copy.productStory.suggestionPromote;
  else if (deltaState === "down") suggestion = copy.productStory.suggestionWatch;

  return (
    <div className="space-y-4">
      {/* Headline metrics */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-kova-border bg-kova-mist/40 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-kova-tertiary">
            {copy.productStory.unitsSold}
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-kova-ink">
            {units}
          </p>
        </div>
        <div className="rounded-lg border border-kova-border bg-kova-mist/40 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-kova-tertiary">
            {copy.productStory.grossSales}
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-kova-ink">
            {formatMoney(gross)}
          </p>
        </div>
      </div>

      {/* Delta */}
      <div className="flex items-center gap-2 text-sm">
        {deltaState === "up" && (
          <span className="flex items-center gap-1 font-medium text-emerald-700">
            <TrendingUp className="h-4 w-4" />
            {deltaPct != null
              ? copy.productStory.deltaUp(pctRound(deltaPct))
              : copy.productStory.deltaUp(100)}
          </span>
        )}
        {deltaState === "down" && (
          <span className="flex items-center gap-1 font-medium text-destructive">
            <TrendingDown className="h-4 w-4" />
            {copy.productStory.deltaDown(pctRound(deltaPct!))}
          </span>
        )}
        {deltaState === "flat" && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Minus className="h-4 w-4" />
            {copy.productStory.deltaFlat}
          </span>
        )}
        {deltaState === "none" && (
          <span className="text-muted-foreground">
            {units === 0
              ? copy.productStory.noSales
              : copy.productStory.deltaNoPrev}
          </span>
        )}
      </div>

      {/* Stock */}
      <div className="flex items-center gap-3 rounded-lg border border-kova-border p-3">
        <Package className="h-4 w-4 text-kova-muted shrink-0" />
        <div className="flex-1 min-w-0">
          {!tracked ? (
            <p className="text-sm text-kova-muted">
              {copy.productStory.notTracked}
            </p>
          ) : stock == null ? (
            <p className="text-sm text-kova-muted">
              {copy.productStory.notTracked}
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">
                <span className="font-semibold tabular-nums">
                  {stock.stock_on_hand}
                </span>{" "}
                <span className="text-kova-muted">
                  {copy.productStory.stockOnHand.toLowerCase()}
                </span>
              </span>
              {stock.low_stock_threshold != null && (
                <span className="text-xs text-kova-muted">
                  · {copy.productStory.threshold(stock.low_stock_threshold)}
                </span>
              )}
              {stockEmpty && (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {copy.productStory.out}
                </Badge>
              )}
              {!stockEmpty && stockLow && (
                <Badge variant="warning">{copy.inventoryView.lowBadge}</Badge>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Suggestion */}
      <div className="rounded-lg border border-kova-blue/20 bg-kova-blue/5 p-3">
        <div className="flex items-start gap-2">
          <Sparkles className="h-4 w-4 text-kova-blue shrink-0 mt-0.5" />
          <p className="text-sm text-kova-ink leading-relaxed">{suggestion}</p>
        </div>
      </div>
    </div>
  );
}
