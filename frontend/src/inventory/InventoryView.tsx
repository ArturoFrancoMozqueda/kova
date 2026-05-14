import { FormEvent, useCallback, useEffect, useState } from "react";
import { INVENTORY_ADJUST_PERMISSION, usePermission } from "../auth/permissions";
import { copy } from "../i18n/messages";
import { adjustStock, listLowStock, listStock, recordStockTake, updateLowStockThreshold } from "./api";
import type { StockItem } from "./types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { Package, AlertTriangle, AlertCircle, Pencil, ClipboardCheck, Settings2 } from "lucide-react";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; stock: StockItem[]; lowStock: StockItem[] };

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
      const [stock, lowStock] = await Promise.all([listStock(), listLowStock()]);
      setLoadState({ status: "loaded", stock, lowStock });
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{copy.inventoryView.title}</h1>
          <p className="text-sm text-muted-foreground">{copy.inventoryView.trackedProducts(loadState.stock.length)}</p>
        </div>
        {loadState.lowStock.length > 0 && (
          <Badge variant="warning" className="text-sm gap-1.5 py-1 px-3">
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
      {loadState.lowStock.length > 0 && (
        <Card className="border-warning/30 mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
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
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loadState.stock.map((item) => (
            <Card key={item.product_id} className="hover:shadow-md transition-shadow">
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
                {canAdjust && (
                  <div className="flex gap-1.5">
                    <Button variant="outline" size="sm" onClick={() => setModal({ type: "adjust", item })}>
                      <Pencil className="h-3 w-3" />
                      {copy.inventoryView.adjust}
                    </Button>
                    <Button variant="outline" size="sm" aria-label={copy.inventoryView.stockTake} onClick={() => setModal({ type: "stockTake", item })}>
                      <ClipboardCheck className="h-3 w-3" />
                    </Button>
                    <Button variant="outline" size="sm" aria-label={copy.inventoryView.setThreshold} onClick={() => setModal({ type: "threshold", item })}>
                      <Settings2 className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {modal && (
        <InventoryModal modal={modal} pending={pending} onCancel={() => setModal(null)} onSubmit={submitModal} />
      )}
    </main>
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
