import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { INVENTORY_ADJUST_PERMISSION, usePermission } from "../auth/permissions";
import { copy } from "../i18n/messages";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { adjustStock, listLowStock, listMovements, listStock, listVelocity, recordStockTake, updateLowStockThreshold } from "./api";
import type { InventoryVelocityItem, MovementHistoryItem, StockItem } from "./types";
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
import { Package, AlertTriangle, AlertCircle, Pencil, ClipboardCheck, Settings2, History, ChevronDown, Search } from "lucide-react";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; stock: StockItem[]; lowStock: StockItem[]; velocity: InventoryVelocityItem[] };

type ModalState =
  | { type: "adjust"; item: StockItem }
  | { type: "stockTake"; item: StockItem }
  | { type: "threshold"; item: StockItem }
  | null;

type StockFilter = "all" | "low" | "healthy";
type StockSort = "name_asc" | "stock_asc" | "stock_desc" | "threshold_asc";

export default function InventoryView() {
  useDocumentTitle(copy.documentTitles.inventory);
  const canAdjust = usePermission(INVENTORY_ADJUST_PERMISSION);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [modal, setModal] = useState<ModalState>(null);
  const [pending, setPending] = useState(false);
  const [searchParams] = useSearchParams();
  const [stockSearch, setStockSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>(() => {
    const initial = searchParams.get("filter");
    return initial === "low" || initial === "healthy" ? initial : "all";
  });
  const [stockSort, setStockSort] = useState<StockSort>("name_asc");
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
      const [stock, lowStock, velocity] = await Promise.all([
        listStock(),
        listLowStock(),
        listVelocity().catch(() => [] as InventoryVelocityItem[]),
      ]);
      setLoadState({ status: "loaded", stock, lowStock, velocity });
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
      const matchesSearch = query
        ? [item.product_name, item.sku ?? ""].some((value) => value.toLowerCase().includes(query))
        : true;
      const matchesFilter =
        stockFilter === "low"
          ? item.is_low_stock
          : stockFilter === "healthy"
            ? !item.is_low_stock
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
  }, [loadState, stockFilter, stockSearch, stockSort]);

  const submitModal = async (values: { amount: number; reason: string }) => {
    if (!modal) return;
    setPending(true);
    try {
      if (modal.type === "adjust") {
        await adjustStock(modal.item.product_id, values.amount, values.reason);
        toast(copy.inventoryView.adjustmentSuccess, "success");
      }
      if (modal.type === "stockTake") {
        await recordStockTake(modal.item.product_id, values.amount, values.reason);
        toast(copy.inventoryView.stockTakeSuccess, "success");
      }
      if (modal.type === "threshold") {
        await updateLowStockThreshold(modal.item.product_id, values.amount);
        toast(copy.inventoryView.thresholdSuccess, "success");
      }
      setModal(null);
      await load();
    } catch (err) {
      toast(resolveApiErrorMessage(err, copy.inventoryView.operationError), "error");
    } finally {
      setPending(false);
    }
  };

  if (loadState.status === "loading") {
    return (
      <main className="p-6 lg:p-8 max-w-6xl mx-auto">
        <Skeleton className="h-8 w-48 mb-6" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </main>
    );
  }

  if (loadState.status === "error") {
    return (
      <main className="p-6 lg:p-8 max-w-6xl mx-auto">
        <ViewError
          message={copy.inventoryView.loadError}
          onRetry={() => void load()}
          retryLabel={copy.inventoryView.retry}
        />
      </main>
    );
  }

  return (
    <main className="p-6 lg:p-8 max-w-6xl mx-auto animate-fade-in">
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

      {(loadState.lowStock.length > 0 || loadState.velocity.some((item) => item.days_until_out !== null)) && (
        <Card className="border-warning/30 bg-warning/5 mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-warning" />
              {copy.inventoryView.attentionTitle}
            </CardTitle>
            <p className="text-sm text-muted-foreground">{copy.inventoryView.attentionBody}</p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ...loadState.lowStock.map((item) => ({
                  id: `low-${item.product_id}`,
                  title: item.product_name,
                  detail: copy.inventoryView.lowStockDetail(item.stock_on_hand, item.low_stock_threshold),
                  tone: item.stock_on_hand <= 0 ? "destructive" as const : "warning" as const,
                })),
                ...loadState.velocity
                  .filter((item) => item.days_until_out !== null)
                  .map((item) => ({
                    id: `velocity-${item.product_id}`,
                    title: item.product_name,
                    detail: item.stock_on_hand <= 0
                      ? copy.inventoryView.alreadyOut
                      : copy.inventoryView.daysUntilOut(
                          item.product_name,
                          Math.ceil(Number(item.days_until_out)),
                        ),
                    tone: "secondary" as const,
                  })),
              ]
                .filter((item, index, items) => items.findIndex((candidate) => candidate.title === item.title) === index)
                .slice(0, 3)
                .map((item) => (
                  <div key={item.id} className="rounded-lg border bg-background p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold">{item.title}</p>
                      <Badge
                        variant={item.tone}
                        title={item.tone === "secondary" ? copy.inventoryView.velocityBasis : undefined}
                      >
                        {item.tone === "secondary" ? copy.inventoryView.stockVelocity : copy.inventoryView.lowStock}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
                    {item.tone === "secondary" && (
                      <p className="mt-1 text-[11px] text-muted-foreground/70">{copy.inventoryView.velocityBasis}</p>
                    )}
                    <p className="mt-2 text-xs font-medium text-kova-blue">
                      {copy.inventoryView.reorderSuggestion}
                    </p>
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
          <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_220px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Label className="sr-only" htmlFor="inventory-search">
                {copy.inventoryView.searchStock}
              </Label>
              <Input
                id="inventory-search"
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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleStock.map((item) => (
                <StockCard
                  key={item.product_id}
                  item={item}
                  canAdjust={canAdjust}
                  onModal={setModal}
                />
              ))}
            </div>
          )}
        </>
      )}

      {modal && (
        <InventoryModal modal={modal} pending={pending} onCancel={() => setModal(null)} onSubmit={submitModal} />
      )}
    </main>
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

function StockCard({
  item,
  canAdjust,
  onModal,
}: {
  item: StockItem;
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

  return (
    <Card className="shadow-kova-card hover:shadow-kova-card-hover transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-semibold text-sm">{item.product_name}</h3>
            <p className="text-xs text-muted-foreground">{item.sku ?? copy.inventoryView.noSku}</p>
          </div>
          {item.stock_on_hand <= 0 ? (
            <Badge variant="destructive">{copy.inventoryView.outBadge}</Badge>
          ) : item.is_low_stock ? (
            <Badge variant="warning">{copy.inventoryView.lowBadge}</Badge>
          ) : null}
        </div>
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-3xl font-bold">{item.stock_on_hand}</span>
          <span className="text-sm text-muted-foreground">{copy.inventoryView.onHand}</span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          {copy.inventoryView.threshold}: {item.low_stock_threshold ?? "—"}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
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

        {historyOpen && (
          <div className="mt-3 border-t pt-3 animate-fade-in">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              {copy.inventoryView.movementHistory}
            </p>
            {historyLoading && (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-8 rounded bg-muted animate-pulse" />
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
  onSubmit: (values: { amount: number; reason: string }) => Promise<void>;
};

function InventoryModal({ modal, pending, onCancel, onSubmit }: InventoryModalProps) {
  const [amount, setAmount] = useState(
    modal.type === "threshold" ? String(modal.item.low_stock_threshold ?? "") : "0",
  );
  const [reason, setReason] = useState("");
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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit({ amount: Number(amount), reason: reason || "threshold_update" });
  };

  return (
    <Dialog open onClose={onCancel}>
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
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-describedby={modal.type === "threshold" ? "inv-amount-help" : undefined}
          />
          {modal.type === "threshold" && (
            <p id="inv-amount-help" className="text-xs text-muted-foreground">
              {copy.inventoryModal.thresholdHint}
            </p>
          )}
        </div>
        {modal.type !== "threshold" && (
          <div className="space-y-2">
            <Label htmlFor="inv-reason">{copy.inventoryModal.reason}</Label>
            <Input
              id="inv-reason"
              value={reason}
              placeholder={copy.inventoryModal.reasonPlaceholder}
              onChange={(event) => setReason(event.target.value)}
              required
            />
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>{copy.inventoryModal.cancel}</Button>
          <Button type="submit" disabled={pending}>{copy.inventoryModal.submit}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
