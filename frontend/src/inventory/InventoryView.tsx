import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  INVENTORY_ADJUST_PERMISSION,
  permissionsFromSearch,
} from "../auth/permissions";
import { copy } from "../i18n/messages";
import {
  adjustStock,
  listLowStock,
  listStock,
  recordStockTake,
  updateLowStockThreshold,
} from "./api";
import type { StockItem } from "./types";

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
  const location = useLocation();
  const permissions = useMemo(() => permissionsFromSearch(location.search), [location.search]);
  const canAdjust = permissions.has(INVENTORY_ADJUST_PERMISSION);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [modal, setModal] = useState<ModalState>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
    if (!modal) {
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      if (modal.type === "adjust") {
        await adjustStock(modal.item.product_id, values.amount, values.reason);
        setNotice(copy.inventoryView.adjustmentSuccess);
      }
      if (modal.type === "stockTake") {
        await recordStockTake(modal.item.product_id, values.amount, values.reason);
        setNotice(copy.inventoryView.stockTakeSuccess);
      }
      if (modal.type === "threshold") {
        await updateLowStockThreshold(modal.item.product_id, values.amount);
        setNotice(copy.inventoryView.thresholdSuccess);
      }
      setModal(null);
      await load();
    } catch {
      setNotice(copy.inventoryView.operationError);
    } finally {
      setPending(false);
    }
  };

  if (loadState.status === "loading") {
    return <main aria-busy="true">{copy.inventoryView.loading}</main>;
  }

  if (loadState.status === "error") {
    return (
      <main>
        <p role="alert">{copy.inventoryView.loadError}</p>
        <button type="button" onClick={() => void load()}>
          {copy.inventoryView.retry}
        </button>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{copy.app.dashboard}</p>
          <h1>{copy.inventoryView.title}</h1>
        </div>
        <div className="metric-strip" aria-label={copy.inventoryView.lowStock}>
          <strong>{loadState.lowStock.length}</strong>
          <span>{copy.inventoryView.lowStock}</span>
        </div>
      </header>
      {notice ? <p role="status" className="notice">{notice}</p> : null}
      {!canAdjust ? <p className="muted">{copy.inventoryView.permissionHidden}</p> : null}
      <section className="panel" aria-labelledby="low-stock-title">
        <h2 id="low-stock-title">{copy.inventoryView.lowStock}</h2>
        {loadState.lowStock.length === 0 ? <p>{copy.inventoryView.noLowStock}</p> : null}
        <div className="compact-list">
          {loadState.lowStock.map((item) => (
            <span key={item.product_id}>
              {item.product_name}: {item.stock_on_hand}
            </span>
          ))}
        </div>
      </section>
      <section className="panel" aria-labelledby="stock-title">
        <h2 id="stock-title">{copy.inventoryView.stockOnHand}</h2>
        {loadState.stock.length === 0 ? <p>{copy.inventoryView.noStock}</p> : null}
        <div className="data-grid">
          {loadState.stock.map((item) => (
            <article key={item.product_id} className="data-card">
              <div>
                <h3>{item.product_name}</h3>
                <p>{item.sku ?? "No SKU"}</p>
              </div>
              <strong>{item.stock_on_hand}</strong>
              <p>
                {copy.inventoryView.threshold}: {item.low_stock_threshold ?? "-"}
              </p>
              {item.is_low_stock ? (
                <span className="status-warn">{copy.inventoryView.lowStock}</span>
              ) : null}
              {canAdjust ? (
                <div className="button-row" aria-label={copy.inventoryView.actions}>
                  <button type="button" onClick={() => setModal({ type: "adjust", item })}>
                    {copy.inventoryView.adjust}
                  </button>
                  <button type="button" onClick={() => setModal({ type: "stockTake", item })}>
                    {copy.inventoryView.stockTake}
                  </button>
                  <button type="button" onClick={() => setModal({ type: "threshold", item })}>
                    {copy.inventoryView.setThreshold}
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>
      {modal ? (
        <InventoryModal
          modal={modal}
          pending={pending}
          onCancel={() => setModal(null)}
          onSubmit={submitModal}
        />
      ) : null}
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
    <div role="dialog" aria-modal="true" aria-labelledby="inventory-modal-title" className="modal">
      <form onSubmit={submit}>
        <h2 id="inventory-modal-title">{title}</h2>
        <p>{modal.item.product_name}</p>
        <label>
          {amountLabel}
          <input
            aria-label={amountLabel}
            type="number"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        {modal.type !== "threshold" ? (
          <label>
            {copy.inventoryModal.reason}
            <input
              aria-label={copy.inventoryModal.reason}
              value={reason}
              placeholder={copy.inventoryModal.reasonPlaceholder}
              onChange={(event) => setReason(event.target.value)}
              required
            />
          </label>
        ) : null}
        <div className="button-row">
          <button type="button" onClick={onCancel}>
            {copy.inventoryModal.cancel}
          </button>
          <button type="submit" disabled={pending}>
            {copy.inventoryModal.submit}
          </button>
        </div>
      </form>
    </div>
  );
}
