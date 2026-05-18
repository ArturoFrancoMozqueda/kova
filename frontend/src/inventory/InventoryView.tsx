import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { INVENTORY_ADJUST_PERMISSION, usePermission } from "../auth/permissions";
import { copy } from "../i18n/messages";
import { adjustStock, listLowStock, listMovements, listStock, listVelocity, recordStockTake, updateLowStockThreshold } from "./api";
import type { InventoryVelocityItem, MovementHistoryItem, StockItem } from "./types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { Package, AlertTriangle, AlertCircle, Pencil, ClipboardCheck, Settings2, History, ChevronDown } from "lucide-react";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; stock: StockItem[]; lowStock: StockItem[]; velocity: InventoryVelocityItem[] };

type ModalState =
  | { type: "adjust"; item: StockItem }
  | { type: "stockTake"; item: StockItem }
  | { type: "threshold"; item: StockItem }
  | null;

export default function InventoryView() {
  const canAdjust = usePermission(INVENTORY_ADJUST_PERMISSION);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [modal, setModal] = useState<ModalState>(null);
  const [pending, setPending] = useState(false);
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
    } catch {
      toast(copy.inventoryView.operationError, "error");
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
        <Card className="border-destructive/50">
          <CardContent className="flex items-center gap-4 p-6">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="font-medium">{copy.inventoryView.loadError}</p>
            <Button variant="outline" onClick={() => void load()} className="ml-auto">{copy.inventoryView.retry}</Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="p-6 lg:p-8 max-w-6xl mx-auto animate-fade-in">
      <div className="flex items-start justify-between gap-3 mb-6 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{copy.inventoryView.title}</h1>
          <p className="text-sm text-muted-foreground">{copy.inventoryView.trackedProducts(loadState.stock.length)}</p>
        </div>
        {loadState.lowStock.length > 0 && (
          <Badge variant="warning" className="text-sm gap-1.5 py-1 px-3 shrink-0">
            <AlertTriangle className="h-3.5 w-3.5" />
            {loadState.lowStock.length} {copy.inventoryView.lowStock}
          </Badge>
        )}
      </div>

      {!canAdjust && (
        <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground mb-6">
          <AlertCircle className="h-4 w-4" />
          {copy.inventoryView.permissionHidden}
        </div>
      )}

      {/* Low stock alerts */}
      {loadState.velocity.some((item) => item.days_until_out !== null) && (
        <Card className="border-kova-blue/20 bg-kova-blue/5 mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Package className="h-4 w-4 text-kova-blue" />
              {copy.inventoryView.stockVelocity}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {loadState.velocity
                .filter((item) => item.days_until_out !== null)
                .slice(0, 3)
                .map((item) => (
                  <div key={item.product_id} className="rounded-lg border bg-background p-3">
                    <p className="text-sm font-semibold">{item.product_name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {copy.inventoryView.daysUntilOut(
                        item.product_name,
                        Math.ceil(Number(item.days_until_out)),
                      )}
                    </p>
                    <p className="mt-2 text-xs font-medium text-kova-blue">
                      {copy.inventoryView.reorderSuggestion}
                    </p>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {loadState.lowStock.length > 0 && (
        <Card className="border-warning/30 mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-warning" />
              {copy.inventoryView.lowStock}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {loadState.lowStock.map((item) => (
                <Badge key={item.product_id} variant="warning">
                  {item.product_name}: {item.stock_on_hand}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stock grid */}
      {loadState.stock.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16">
            <Package className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">{copy.inventoryView.noStock}</p>
            <Link className={cn("mt-4", buttonVariants())} to="/catalog?inventory=activate">
              {copy.inventoryView.activateInventory}
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loadState.stock.map((item) => (
            <StockCard
              key={item.product_id}
              item={item}
              canAdjust={canAdjust}
              onModal={setModal}
            />
          ))}
        </div>
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
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-semibold text-sm">{item.product_name}</h3>
            <p className="text-xs text-muted-foreground">{item.sku ?? copy.inventoryView.noSku}</p>
          </div>
          {item.is_low_stock && <Badge variant="warning">{copy.inventoryView.lowBadge}</Badge>}
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
          <Input id="inv-amount" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} />
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
