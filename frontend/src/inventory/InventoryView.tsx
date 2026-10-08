import { LotAllocationEditor, LotsPanel } from "./LotControls";
import { allocationValid, listLots, type Lot, type LotAllocation } from "./lots";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { INVENTORY_ADJUST_PERMISSION, usePermission } from "../auth/permissions";
import { useOptionalAuth } from "../auth/useAuth";
import { copy } from "../i18n/messages";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { adjustStock, listLowStock, listMovements, listStock, listVelocity, recordStockTake, updateLowStockThreshold } from "./api";
import type { InventoryReasonCode, InventoryVelocityItem, MovementHistoryItem, StockItem } from "./types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewEmpty, ViewError } from "@/components/ui/view-states";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { resolveApiErrorMessage } from "@/lib/apiError";
import { useBillingBlocked } from "@/billing/useBillingBlocked";
import { Package, AlertTriangle, AlertCircle, Pencil, ClipboardCheck, Settings2, History, ChevronDown, Search, TrendingDown } from "lucide-react";
import { inventoryVelocityAttention, isActionableInventoryVelocity } from "./attention";
import { ViewLayout } from "@/components/ui/view-layout";
import { listProducts } from "@/catalog/api";
import type { Product } from "@/catalog/types";
import { productImageSrc, productImageSrcSet, productImageStyle } from "@/catalog/imageUrl";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "loaded";
      stock: StockItem[];
      lowStock: StockItem[];
      velocity: InventoryVelocityItem[];
      productsById: Record<string, Product>;
    };

type ModalState =
  | { type: "adjust"; item: StockItem }
  | { type: "stockTake"; item: StockItem }
  | { type: "threshold"; item: StockItem }
  | null;

type StockFilter = "all" | "low" | "healthy";
type StockSort = "name_asc" | "stock_asc" | "stock_desc" | "threshold_asc";

// Match backend/app/shared/validation.py and the persisted INTEGER quantities.
const INVENTORY_QUANTITY_MAX = 2_147_483_647;
const INVENTORY_QUANTITY_MIN = -2_147_483_648;

export default function InventoryView() {
  useDocumentTitle(copy.documentTitles.inventory);
  const canAdjust = usePermission(INVENTORY_ADJUST_PERMISSION);
  const auth = useOptionalAuth();
  const identity = auth?.state.status === "authenticated"
    ? `${auth.state.tenantId}:${auth.state.user.id}` : null;
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [modal, setModal] = useState<ModalState>(null);
  const [pending, setPending] = useState(false);
  const submissionPending = useRef(false);
  // Retain the last ambiguous write across modal closes; a changed operation,
  // confirmed success, identity change or unmount starts a new attempt.
  const writeAttempt = useRef<{ identity: string; payload: string; key: string } | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const focusedProductId = searchParams.get("product");
  const [stockSearch, setStockSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>(() => {
    const initial = searchParams.get("filter");
    return initial === "low" || initial === "healthy" ? initial : "all";
  });
  const [stockSort, setStockSort] = useState<StockSort>("name_asc");
  const { toast } = useToast();
  const handleBillingBlocked = useBillingBlocked();

  useEffect(() => {
    writeAttempt.current = null;
    setModal(null);
  }, [identity]);

  const load = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
      const [stock, lowStock, velocity, products] = await Promise.all([
        listStock(),
        listLowStock(),
        listVelocity().catch(() => [] as InventoryVelocityItem[]),
        listProducts().catch(() => [] as Product[]),
      ]);
      setLoadState({
        status: "loaded",
        stock,
        lowStock,
        velocity,
        productsById: Object.fromEntries(products.map((product) => [product.id, product])),
      });
    } catch {
      setLoadState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleStock = useMemo(() => {
    if (loadState.status !== "loaded") return [];
    const query = stockSearch.trim().toLowerCase();
    const filtered = loadState.stock.filter((item) => {
      if (focusedProductId) return item.product_id === focusedProductId;
      const matchesSearch = query
        ? [item.product_name, item.sku ?? ""].some((value) => value.toLowerCase().includes(query))
        : true;
      const matchesFilter =
        stockFilter === "low"
          ? item.is_low_stock || item.stock_on_hand <= 0
          : stockFilter === "healthy"
            ? !item.is_low_stock && item.stock_on_hand > 0
            : true;
      return matchesSearch && matchesFilter;
    });

    return [...filtered].sort((a, b) => {
      if (stockSort === "stock_asc") return a.stock_on_hand - b.stock_on_hand;
      if (stockSort === "stock_desc") return b.stock_on_hand - a.stock_on_hand;
      if (stockSort === "threshold_asc") {
        return (a.low_stock_threshold ?? Number.MAX_SAFE_INTEGER)
          - (b.low_stock_threshold ?? Number.MAX_SAFE_INTEGER);
      }
      return a.product_name.localeCompare(b.product_name, "es-MX");
    });
  }, [loadState, stockFilter, stockSearch, stockSort, focusedProductId]);

  const submitModal = async (values: { amount: number; reason: string; reasonCode: InventoryReasonCode | null; lotAllocations?: LotAllocation[]; lotCounts?: { lot_id: string; counted_quantity: number }[] }) => {
    if (!modal || submissionPending.current) return;
    submissionPending.current = true;
    const payload = JSON.stringify({ productId: modal.item.product_id, type: modal.type, ...values });
    const idempotencyKey = writeAttempt.current?.identity === identity && writeAttempt.current.payload === payload
      ? writeAttempt.current.key : crypto.randomUUID();
    if (identity) writeAttempt.current = { identity, payload, key: idempotencyKey };
    setPending(true);
    try {
      if (modal.type === "adjust") {
        if (values.lotAllocations) await adjustStock(modal.item.product_id, values.amount, values.reason, values.reasonCode, idempotencyKey, values.lotAllocations);
        else await adjustStock(modal.item.product_id, values.amount, values.reason, values.reasonCode, idempotencyKey);
        toast(copy.inventoryView.adjustmentSuccess, "success");
      }
      if (modal.type === "stockTake") {
        if (values.lotCounts) await recordStockTake(modal.item.product_id, values.amount, values.reason, idempotencyKey, values.lotCounts);
        else await recordStockTake(modal.item.product_id, values.amount, values.reason, idempotencyKey);
        toast(copy.inventoryView.stockTakeSuccess, "success");
      }
      if (modal.type === "threshold") {
        await updateLowStockThreshold(modal.item.product_id, values.amount, idempotencyKey);
        toast(copy.inventoryView.thresholdSuccess, "success");
      }
      if (writeAttempt.current?.key === idempotencyKey) writeAttempt.current = null;
      setModal(null);
      await load();
    } catch (err) {
      if (handleBillingBlocked(err)) return;
      toast(resolveApiErrorMessage(err, copy.inventoryView.operationError), "error");
    } finally {
      submissionPending.current = false;
      setPending(false);
    }
  };

  if (loadState.status === "loading") {
    return (
      <ViewLayout width="standard" className="space-y-6" aria-busy="true">
        <ViewHeader title={copy.inventoryView.title} meta={copy.inventoryView.loading} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </ViewLayout>
    );
  }

  if (loadState.status === "error") {
    return (
      <ViewLayout width="standard">
        <ViewError
          message={copy.inventoryView.loadError}
          onRetry={() => void load()}
          retryLabel={copy.inventoryView.retry}
        />
      </ViewLayout>
    );
  }

  const outOfStockCount = loadState.stock.filter((item) => item.stock_on_hand <= 0).length;
  const lowStockCount = loadState.stock.filter((item) => item.is_low_stock && item.stock_on_hand > 0).length;
  const healthyStockCount = loadState.stock.length - outOfStockCount - lowStockCount;
  const focusedProduct = focusedProductId
    ? loadState.stock.find((item) => item.product_id === focusedProductId) : null;
  const attentionStock = focusedProductId
    ? loadState.lowStock.filter((item) => item.product_id === focusedProductId) : loadState.lowStock;
  const attentionVelocity = focusedProductId
    ? loadState.velocity.filter((item) => item.product_id === focusedProductId) : loadState.velocity;

  return (
    <ViewLayout width="wide" className="animate-fade-in">
      <div className="mb-6">
        <ViewHeader
          title={copy.inventoryView.title}
          meta={copy.inventoryView.trackedProducts(loadState.stock.length)}
          actions={
            loadState.lowStock.length > 0 ? (
              <Badge variant="warning" className="text-sm gap-1.5 py-1 px-3 shrink-0">
                <AlertTriangle className="h-3.5 w-3.5" />
                {loadState.lowStock.length} {copy.inventoryView.lowStock}
              </Badge>
            ) : undefined
          }
        />
      </div>

      {!canAdjust && (
        <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground mb-6">
          <AlertCircle className="h-4 w-4" />
          {copy.inventoryView.permissionHidden}
        </div>
      )}

      {focusedProductId ? (
        <div role="status" className="mb-6 space-y-2 rounded-kova-lg border border-kova-blue/20 bg-kova-blue/5 p-4">
          <p className="text-sm font-semibold text-kova-ink">
            {focusedProduct ? copy.inventoryView.focusedProduct(focusedProduct.product_name)
              : copy.inventoryView.focusedMissing}
          </p>
          {focusedProduct ? <p className="text-sm text-kova-muted">{copy.inventoryView.focusedProductBody}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete("product");
              next.delete("filter");
              setSearchParams(next, { replace: true });
              setStockSearch("");
              setStockFilter("all");
            }}>{copy.inventoryView.clearFocus}</Button>
            <Link className="inline-flex min-h-11 items-center rounded-kova-md text-sm font-medium text-kova-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue" to="/reports">
              {copy.inventoryView.backToAnalysis}
            </Link>
          </div>
        </div>
      ) : null}

      <div className="mb-6 grid overflow-hidden rounded-kova-lg border border-kova-border bg-white shadow-kova-card sm:grid-cols-3">
        <div className="border-b border-kova-border px-5 py-4 sm:border-b-0 sm:border-r">
          <p className="text-sm text-muted-foreground">En existencia</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{healthyStockCount}</p>
        </div>
        <div className="border-b border-kova-border px-5 py-4 sm:border-b-0 sm:border-r">
          <p className="text-sm text-muted-foreground">{copy.inventoryView.lowStock}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-warning-foreground tabular-nums">{lowStockCount}</p>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-muted-foreground">Agotados</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-destructive tabular-nums">{outOfStockCount}</p>
        </div>
      </div>

      {(attentionStock.length > 0 || attentionVelocity.some(isActionableInventoryVelocity)) && (
        <Card className="border-warning/30 bg-warning/5 mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-warning-strong" />
              {copy.inventoryView.attentionTitle}
            </CardTitle>
            <p className="text-sm text-muted-foreground">{copy.inventoryView.attentionBody}</p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ...attentionStock.map((item) => ({
                  id: `low-${item.product_id}`,
                  productId: item.product_id,
                  title: item.product_name,
                  detail: copy.inventoryView.lowStockDetail(item.stock_on_hand, item.low_stock_threshold),
                  tone: item.stock_on_hand <= 0 ? "destructive" as const : "warning" as const,
                  stockItem: item,
                })),
                ...attentionVelocity
                  .filter(isActionableInventoryVelocity)
                  .map((item) => ({
                    id: `velocity-${item.product_id}`,
                    productId: item.product_id,
                    title: item.product_name,
                    detail: item.stock_on_hand <= 0
                      ? copy.inventoryView.alreadyOut
                      : copy.inventoryView.daysUntilOut(
                          item.product_name,
                          Math.ceil(Number(item.days_until_out)),
                        ),
                    tone: inventoryVelocityAttention(item) === "critical"
                      ? "destructive" as const
                      : "secondary" as const,
                    stockItem: loadState.stock.find((stock) => stock.product_id === item.product_id),
                  })),
              ]
                .filter((item, index, items) => items.findIndex((candidate) => candidate.productId === item.productId) === index)
                .slice(0, 3)
                .map((item) => (
                  <div key={item.id} className="rounded-kova-md border border-kova-border bg-kova-mist/60 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold">{item.title}</p>
                      <Badge
                        variant={item.tone}
                        title={item.id.startsWith("velocity-") ? copy.inventoryView.velocityBasis : undefined}
                      >
                        {item.id.startsWith("velocity-") ? copy.inventoryView.stockVelocity : copy.inventoryView.lowStock}
                      </Badge>
                    </div>
                    <p className="mt-1 flex items-center gap-1 text-xs leading-5 text-muted-foreground">
                      {item.id.startsWith("velocity-") && <TrendingDown className="h-3 w-3 shrink-0 text-kova-blue" />}
                      {item.detail}
                    </p>
                    {item.id.startsWith("velocity-") && (
                      <p className="mt-1 text-[11px] text-muted-foreground/70">{copy.inventoryView.velocityBasis}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">{copy.inventoryView.reorderSuggestion}</p>
                      {canAdjust && item.stockItem ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-kova-blue hover:bg-kova-blue/10 hover:text-kova-blue"
                          aria-label={`${copy.inventoryModal.adjustmentTitle}: ${item.title}`}
                          onClick={() => setModal({ type: "adjust", item: item.stockItem! })}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          {copy.inventoryView.adjust}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stock grid */}
      {loadState.stock.length === 0 ? (
        <ViewEmpty
          icon={<Package className="h-6 w-6" />}
          title={copy.inventoryView.noStock}
          body={copy.inventoryView.noStockBody}
          primaryCta={{ label: copy.inventoryView.activateInventory, to: "/catalog?inventory=activate" }}
        />
      ) : (
        <>
          <div className="mb-5 grid gap-3 rounded-kova-lg border border-kova-border bg-white p-4 shadow-kova-card md:grid-cols-[minmax(0,1fr)_180px_220px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Label className="sr-only" htmlFor="inventory-search">
                {copy.inventoryView.searchStock}
              </Label>
              <Input
                id="inventory-search"
                disabled={Boolean(focusedProductId)}
                value={stockSearch}
                onChange={(event) => setStockSearch(event.target.value)}
                placeholder={copy.inventoryView.searchStockPlaceholder}
                className="pl-9"
              />
            </div>
            <div>
              <Label className="sr-only" htmlFor="inventory-filter">
                {copy.inventoryView.filterStock}
              </Label>
              <Select
                id="inventory-filter"
                disabled={Boolean(focusedProductId)}
                value={stockFilter}
                onChange={(event) => setStockFilter(event.target.value as StockFilter)}
                aria-label={copy.inventoryView.filterStock}
              >
                <option value="all">{copy.inventoryView.filterAll}</option>
                <option value="low">{copy.inventoryView.filterLow}</option>
                <option value="healthy">{copy.inventoryView.filterHealthy}</option>
              </Select>
            </div>
            <div>
              <Label className="sr-only" htmlFor="inventory-sort">
                {copy.inventoryView.sortStock}
              </Label>
              <Select
                id="inventory-sort"
                value={stockSort}
                onChange={(event) => setStockSort(event.target.value as StockSort)}
                aria-label={copy.inventoryView.sortStock}
              >
                <option value="name_asc">{copy.inventoryView.sortNameAsc}</option>
                <option value="stock_asc">{copy.inventoryView.sortStockAsc}</option>
                <option value="stock_desc">{copy.inventoryView.sortStockDesc}</option>
                <option value="threshold_asc">{copy.inventoryView.sortThresholdAsc}</option>
              </Select>
            </div>
          </div>
          {visibleStock.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center px-6 py-10 text-center">
                <Package className="mb-3 h-10 w-10 text-muted-foreground/30" />
                <p className="font-semibold">{copy.inventoryView.noFilteredStock}</p>
                <p className="mt-1 text-sm text-muted-foreground">{copy.inventoryView.noFilteredStockBody}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-hidden rounded-kova-lg border border-kova-border bg-white shadow-kova-card">
              <div className="hidden grid-cols-[minmax(240px,2fr)_120px_120px_minmax(280px,1fr)] items-center gap-4 bg-kova-blue/[0.075] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground lg:grid">
                <span>Producto</span>
                <span className="text-right">Stock</span>
                <span className="text-right">Mínimo</span>
                <span className="text-right">Acciones</span>
              </div>
              {visibleStock.map((item) => (
                <StockCard
                  key={item.product_id}
                  item={item}
                  product={loadState.productsById[item.product_id]}
                  canAdjust={canAdjust}
                  onModal={setModal}
                />
              ))}
            </div>
          )}
        </>
      )}

      {modal && (
        <InventoryModal modal={modal} pending={pending} onCancel={() => {
          if (!submissionPending.current) setModal(null);
        }} onSubmit={submitModal} />
      )}
    </ViewLayout>
  );
}

function movementTypeLabel(type: string): string {
  const map: Record<string, string> = {
    sale: copy.inventoryView.movementTypeSale,
    adjustment: copy.inventoryView.movementTypeAdjustment,
    stock_take: copy.inventoryView.movementTypeStockTake,
    refund: copy.inventoryView.movementTypeRefund,
    void: copy.inventoryView.movementTypeVoid,
  };
  return map[type] ?? copy.inventoryView.movementTypeUnknown;
}

function reasonCodeLabel(code: InventoryReasonCode): string {
  return copy.inventoryModal.reasonCodes[code];
}

function StockCard({
  item,
  product,
  canAdjust,
  onModal,
}: {
  item: StockItem;
  product?: Product;
  canAdjust: boolean;
  onModal: (modal: ModalState) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<MovementHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);

  const loadHistory = async () => {
    if (historyOpen) { setHistoryOpen(false); return; }
    setHistoryOpen(true);
    if (history.length > 0) return; // already loaded
    setHistoryLoading(true);
    setHistoryError(false);
    try {
      const result = await listMovements(item.product_id, 20, 0);
      setHistory(result.items);
    } catch {
      setHistoryError(true);
    } finally {
      setHistoryLoading(false);
    }
  };

  const isOut = item.stock_on_hand <= 0;
  const isLow = item.is_low_stock && !isOut;

  return (
    <Card
      className={cn(
        "rounded-none border-x-0 border-t-0 shadow-none transition-colors last:border-b-0 hover:bg-kova-mist/45",
        isOut && "border-l-4 border-l-destructive",
        isLow && "border-l-4 border-l-warning",
      )}
    >
      <CardContent className="grid gap-3 p-4 lg:grid-cols-[minmax(240px,2fr)_120px_120px_minmax(280px,1fr)] lg:items-center lg:gap-4">
        <div className="flex items-start justify-between gap-3 lg:items-center">
          <div className="flex min-w-0 items-center gap-3">
            {product?.image_url ? (
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-kova-md bg-kova-mist">
                <img
                  src={productImageSrc(product.image_url, 160)}
                  srcSet={productImageSrcSet(product.image_url)}
                  sizes="48px"
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full"
                  style={productImageStyle(product)}
                />
              </div>
            ) : null}
            <div className="min-w-0">
              <h3 className="truncate font-semibold text-sm">{item.product_name}</h3>
              <p className="truncate text-xs text-muted-foreground">{item.sku ?? copy.inventoryView.noSku}</p>
            </div>
          </div>
          {isOut ? (
            <Badge variant="destructive">{copy.inventoryView.outBadge}</Badge>
          ) : isLow ? (
            <Badge variant="warning">{copy.inventoryView.lowBadge}</Badge>
          ) : null}
        </div>
        <div className="flex items-baseline gap-2 lg:justify-end">
          <span
            className={cn(
              "text-3xl font-bold tabular-nums lg:text-lg",
              isOut ? "text-destructive" : isLow ? "text-warning-foreground" : "text-kova-ink",
            )}
          >
            {item.stock_on_hand}
          </span>
          <span className="text-sm text-muted-foreground lg:sr-only">{copy.inventoryView.onHand}</span>
        </div>
        <p className="text-xs text-muted-foreground lg:text-right lg:text-sm lg:tabular-nums">
          <span className="lg:sr-only">{copy.inventoryView.threshold}: </span>{item.low_stock_threshold ?? "—"}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap lg:justify-end">
          {canAdjust && (
            <>
              <Button variant="outline" size="sm" onClick={() => onModal({ type: "adjust", item })}>
                <Pencil className="h-3 w-3" />
                {copy.inventoryView.adjust}
              </Button>
              <Button variant="outline" size="sm" aria-label={copy.inventoryView.stockTake} onClick={() => onModal({ type: "stockTake", item })}>
                <ClipboardCheck className="h-3 w-3" />
              </Button>
              <Button variant="outline" size="sm" aria-label={copy.inventoryView.setThreshold} onClick={() => onModal({ type: "threshold", item })}>
                <Settings2 className="h-3 w-3" />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void loadHistory()}
            className="ml-auto text-muted-foreground gap-1"
          >
            <History className="h-3 w-3" />
            {historyOpen ? copy.inventoryView.hideHistory : copy.inventoryView.viewHistory}
            <ChevronDown className={cn("h-3 w-3 transition-transform", historyOpen && "rotate-180")} />
          </Button>
        </div>

        {item.track_lots && <div className="lg:col-span-full"><LotsPanel productId={item.product_id} canAdjust={canAdjust} /></div>}
        {historyOpen && (
          <div className="mt-3 border-t pt-3 animate-fade-in lg:col-span-full">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              {copy.inventoryView.movementHistory}
            </p>
            {historyLoading && (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 rounded-kova-md" />
                ))}
              </div>
            )}
            {historyError && (
              <p className="text-xs text-destructive">{copy.inventoryView.movementHistoryLoadError}</p>
            )}
            {!historyLoading && !historyError && history.length === 0 && (
              <p className="text-xs text-muted-foreground">{copy.inventoryView.movementHistoryEmpty}</p>
            )}
            {!historyLoading && history.length > 0 && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {history.map((m) => (
                  <div key={m.id} className="flex items-center justify-between text-xs gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-1.5 py-0.5 font-medium text-[10px] uppercase",
                          m.quantity_delta > 0
                            ? "bg-kova-growth/10 text-kova-growth"
                            : "bg-destructive/10 text-destructive",
                        )}
                      >
                        {m.quantity_delta > 0 ? `+${m.quantity_delta}` : m.quantity_delta}
                      </span>
                      <span className="text-muted-foreground truncate">{movementTypeLabel(m.movement_type)}</span>
                      {m.lot_allocations?.length ? <span className="text-xs text-muted-foreground">{m.lot_allocations.map(part => `${part.code ?? "Lote registrado"}: ${part.quantity}`).join(", ")}</span> : null}
                      {m.reason_code ? <Badge variant="secondary">{reasonCodeLabel(m.reason_code)}</Badge> : null}
                    </div>
                    <div className="shrink-0 text-right">
                      {m.stock_on_hand_after !== null && (
                        <span className="font-medium">{m.stock_on_hand_after}</span>
                      )}
                      <span className="text-muted-foreground ml-1">
                        {new Intl.DateTimeFormat("es-MX", { month: "short", day: "numeric" }).format(new Date(m.created_at))}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type InventoryModalProps = {
  modal: Exclude<ModalState, null>;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: { amount: number; reason: string; reasonCode: InventoryReasonCode | null; lotAllocations?: LotAllocation[]; lotCounts?: { lot_id: string; counted_quantity: number }[] }) => Promise<void>;
};

function InventoryModal({ modal, pending, onCancel, onSubmit }: InventoryModalProps) {
  const [lotAllocations, setLotAllocations] = useState<LotAllocation[]>([]);
  const [countRows, setCountRows] = useState<Lot[]>([]);
  const [lotCounts, setLotCounts] = useState<Record<string, number>>({});
  const [lotError, setLotError] = useState("");
  useEffect(() => {
    if (!modal.item.track_lots || modal.type !== "stockTake") return;
    let alive = true;
    void listLots(modal.item.product_id).then(rows => { if (alive) { setCountRows(rows); setLotCounts(Object.fromEntries(rows.map(lot => [lot.id, lot.stock_on_hand]))); } }).catch(err => { if (alive) setLotError(err instanceof Error ? err.message : "No pudimos cargar los lotes."); });
    return () => { alive = false; };
  }, [modal.item.product_id, modal.item.track_lots, modal.type]);
  const [amount, setAmount] = useState(
    modal.type === "threshold" ? String(modal.item.low_stock_threshold ?? "") : "0",
  );
  const [reason, setReason] = useState("");
  const [reasonCode, setReasonCode] = useState<InventoryReasonCode | "">("");
  const title =
    modal.type === "adjust"
      ? copy.inventoryModal.adjustmentTitle
      : modal.type === "stockTake"
        ? copy.inventoryModal.stockTakeTitle
        : copy.inventoryModal.thresholdTitle;
  const amountLabel =
    modal.type === "adjust"
      ? copy.inventoryModal.quantityDelta
      : modal.type === "stockTake"
        ? copy.inventoryModal.countedQuantity
        : copy.inventoryModal.threshold;

  // Explain *why* the action is blocked instead of only disabling the button:
  // an empty/NaN amount, a stock-take/threshold that went negative, or an
  // adjustment that would drive stock below zero.
  const numeric = modal.item.track_lots && modal.type === "stockTake" ? Object.values(lotCounts).reduce((sum, q) => sum + q, 0) : Number(amount);
  const amountMissing = amount.trim() === "" || !Number.isFinite(numeric);
  let validationError: string | null = null;
  if (amountMissing) {
    validationError = copy.inventoryModal.amountRequired;
  } else if (!Number.isSafeInteger(numeric)) {
    validationError = "Ingresa una cantidad entera válida.";
  } else if (numeric > INVENTORY_QUANTITY_MAX || numeric < INVENTORY_QUANTITY_MIN) {
    validationError = modal.type === "adjust"
      ? "La cantidad supera el límite permitido. Ingresa un valor entre -2,147,483,648 y 2,147,483,647."
      : "La cantidad supera el límite permitido. Ingresa un valor entre 0 y 2,147,483,647.";
  } else if (modal.type === "adjust") {
    const resulting = modal.item.stock_on_hand + numeric;
    if (numeric === 0) validationError = "Ingresa una cantidad distinta de 0 para ajustar el stock.";
    else if (resulting < 0) validationError = copy.inventoryModal.wouldLeaveNegative(resulting);
    else if (resulting > INVENTORY_QUANTITY_MAX) validationError = "Este ajuste superaría el stock máximo de 2,147,483,647 unidades. Reduce la cantidad a agregar.";
    else if (numeric < 0 && !reasonCode) validationError = copy.inventoryModal.reasonCodeRequired;
  } else if (modal.type === "stockTake" && numeric < 0) {
    validationError = copy.inventoryModal.negativeCount;
  } else if (modal.type === "threshold" && numeric < 0) {
    validationError = copy.inventoryModal.negativeThreshold;
  }
  if (modal.item.track_lots && modal.type === "adjust" && !allocationValid(lotAllocations, Math.abs(numeric))) validationError = "La cantidad debe estar asignada a sus lotes.";
  if (modal.item.track_lots && modal.type === "stockTake" && (!countRows.length || Object.values(lotCounts).reduce((sum, q) => sum + q, 0) !== numeric)) validationError = "El total debe coincidir con el conteo de todos los lotes.";
  const reasonError = modal.type !== "threshold" && !reason.trim()
    ? "Escribe el motivo del movimiento."
    : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending || validationError || reasonError) return;
    void onSubmit({
      amount: numeric,
      reason: modal.type === "threshold" ? "threshold_update" : reason.trim(),
      reasonCode: modal.type === "adjust" && numeric < 0 ? reasonCode || null : null,
      ...(modal.item.track_lots && modal.type === "adjust" ? { lotAllocations } : {}),
      ...(modal.item.track_lots && modal.type === "stockTake" ? { lotCounts: Object.entries(lotCounts).map(([lot_id, counted_quantity]) => ({ lot_id, counted_quantity })) } : {}),
    });
  };

  return (
    <Dialog open onClose={pending ? () => undefined : onCancel}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <p className="text-sm text-muted-foreground">{modal.item.product_name}</p>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="inv-amount">{amountLabel}</Label>
          <Input
            id="inv-amount"
            type="number"
            inputMode="numeric"
            step={1}
            min={modal.type === "adjust" ? Math.max(INVENTORY_QUANTITY_MIN, -modal.item.stock_on_hand) : 0}
            max={modal.type === "adjust" ? Math.min(INVENTORY_QUANTITY_MAX, INVENTORY_QUANTITY_MAX - modal.item.stock_on_hand) : INVENTORY_QUANTITY_MAX}
            disabled={pending}
            value={modal.item.track_lots && modal.type === "stockTake" ? Object.values(lotCounts).reduce((sum, q) => sum + q, 0) : amount}
              readOnly={Boolean(modal.item.track_lots && modal.type === "stockTake")}
            onChange={(event) => setAmount(event.target.value)}
            aria-invalid={validationError ? true : undefined}
            aria-describedby={
              validationError ? "inv-amount-error" : modal.type === "threshold" ? "inv-amount-help" : undefined
            }
          />
          {validationError ? (
            <p id="inv-amount-error" role="alert" className="text-xs font-medium text-destructive">
              {validationError}
            </p>
          ) : modal.type === "threshold" ? (
            <p id="inv-amount-help" className="text-xs text-muted-foreground">
              {copy.inventoryModal.thresholdHint}
            </p>
          ) : null}
        </div>
        {modal.type !== "threshold" && (
          <>
            {modal.type === "adjust" && numeric < 0 ? (
              <div className="space-y-2">
                <Label htmlFor="inv-reason-code">{copy.inventoryModal.reasonCode}</Label>
                <Select
                  id="inv-reason-code"
                  value={reasonCode}
                  onChange={(event) => setReasonCode(event.target.value as InventoryReasonCode | "")}
                  required
                  disabled={pending}
                >
                  <option value="">{copy.inventoryModal.reasonCodePlaceholder}</option>
                  {Object.entries(copy.inventoryModal.reasonCodes).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </Select>
              </div>
            ) : null}
            {modal.item.track_lots && modal.type === "adjust" && <LotAllocationEditor productId={modal.item.product_id} quantity={Math.abs(numeric)} value={lotAllocations} onChange={setLotAllocations} incoming={numeric > 0} physical={numeric < 0} canCreate />}
            {modal.item.track_lots && modal.type === "stockTake" && <fieldset className="space-y-2"><legend>Conteo físico por lote</legend>{lotError && <p role="alert">{lotError}</p>}{countRows.map(lot => <div key={lot.id}><Label htmlFor={`count-${lot.id}`}>{lot.code}</Label><Input id={`count-${lot.id}`} type="number" min={0} step={1} value={lotCounts[lot.id] ?? 0} onChange={e => setLotCounts(previous => ({ ...previous, [lot.id]: Number(e.target.value) }))} /></div>)}</fieldset>}
            <div className="space-y-2">
              <Label htmlFor="inv-reason">{copy.inventoryModal.reason}</Label>
              <Input
                id="inv-reason"
                value={reason}
                placeholder={copy.inventoryModal.reasonPlaceholder}
                onChange={(event) => setReason(event.target.value)}
                required
                maxLength={255}
                disabled={pending}
                aria-invalid={reason.trim() === "" && reason !== "" ? true : undefined}
                aria-describedby={reason.trim() === "" && reason !== "" ? "inv-reason-error" : undefined}
              />
              {reason.trim() === "" && reason !== "" ? (
                <p id="inv-reason-error" role="alert" className="text-xs font-medium text-destructive">
                  {reasonError}
                </p>
              ) : null}
            </div>
          </>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>{copy.inventoryModal.cancel}</Button>
          <Button type="submit" disabled={pending || validationError !== null || reasonError !== null}>{copy.inventoryModal.submit}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
