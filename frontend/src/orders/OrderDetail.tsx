import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ORDER_REFUND_PERMISSION,
  ORDER_VOID_PERMISSION,
  usePermission,
} from "../auth/permissions";
import { copy } from "../i18n/messages";
import { createRefund, createVoid, getOrder, getReceipt } from "./api";
import { formatMoney } from "./format";
import { ReceiptDisplay } from "./ReceiptDisplay";
import { RefundModal } from "./RefundModal";
import type { Order, Receipt, RefundPayload } from "./types";
import { VoidModal } from "./VoidModal";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; order: Order; receipt: Receipt };

export default function OrderDetail() {
  const { orderId } = useParams();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [activeModal, setActiveModal] = useState<"refund" | "void" | null>(null);
  const [operationPending, setOperationPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const canRefund = usePermission(ORDER_REFUND_PERMISSION);
  const canVoid = usePermission(ORDER_VOID_PERMISSION);

  const load = useCallback(async () => {
    if (!orderId) {
      setLoadState({ status: "error", message: copy.orderDetail.loadError });
      return;
    }
    setLoadState({ status: "loading" });
    try {
      const [order, receipt] = await Promise.all([getOrder(orderId), getReceipt(orderId)]);
      setLoadState({ status: "loaded", order, receipt });
    } catch {
      setLoadState({ status: "error", message: copy.orderDetail.loadError });
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitRefund = async (payload: RefundPayload) => {
    if (!orderId) {
      return;
    }
    setOperationPending(true);
    setNotice(null);
    try {
      await createRefund(orderId, payload);
      setActiveModal(null);
      setNotice(copy.orderDetail.refundSuccess);
      await load();
    } catch {
      setNotice(copy.orderDetail.operationError);
    } finally {
      setOperationPending(false);
    }
  };

  const submitVoid = async (reason: string) => {
    if (!orderId) {
      return;
    }
    setOperationPending(true);
    setNotice(null);
    try {
      await createVoid(orderId, reason);
      setActiveModal(null);
      setNotice(copy.orderDetail.voidSuccess);
      await load();
    } catch {
      setNotice(copy.orderDetail.operationError);
    } finally {
      setOperationPending(false);
    }
  };

  if (loadState.status === "loading") {
    return <main aria-busy="true">{copy.orderDetail.loading}</main>;
  }

  if (loadState.status === "error") {
    return (
      <main>
        <p role="alert">{loadState.message}</p>
        <button type="button" onClick={() => void load()}>
          {copy.orderDetail.retry}
        </button>
      </main>
    );
  }

  const { order, receipt } = loadState;
  const isVoided = receipt.status === "voided";

  return (
    <main>
      <h1>{copy.orderDetail.title}</h1>
      {notice ? <p role="status">{notice}</p> : null}
      {isVoided ? <p role="status">{copy.orderDetail.voidedBanner}</p> : null}
      <p>{isVoided ? copy.orderDetail.voided : copy.orderDetail.completed}</p>
      <section aria-labelledby="items-title">
        <h2 id="items-title">{copy.orderDetail.items}</h2>
        {order.items.map((item) => (
          <article key={item.id}>
            <h3>{item.product_name}</h3>
            <p>
              x{item.quantity} {formatMoney(item.line_total_amount)}
            </p>
          </article>
        ))}
      </section>
      <section aria-labelledby="actions-title">
        <h2 id="actions-title">{copy.orderDetail.actions}</h2>
        {canRefund && !isVoided ? (
          <button type="button" onClick={() => setActiveModal("refund")}>
            {copy.orderDetail.refund}
          </button>
        ) : (
          <p>{copy.orderDetail.permissionHidden}</p>
        )}
        {canVoid && !isVoided && receipt.refunds.length === 0 ? (
          <button type="button" onClick={() => setActiveModal("void")}>
            {copy.orderDetail.void}
          </button>
        ) : null}
      </section>
      <ReceiptDisplay order={order} receipt={receipt} />
      {activeModal === "refund" ? (
        <RefundModal
          disabled={operationPending}
          items={order.items}
          onCancel={() => setActiveModal(null)}
          onSubmit={submitRefund}
        />
      ) : null}
      {activeModal === "void" ? (
        <VoidModal
          disabled={operationPending}
          onCancel={() => setActiveModal(null)}
          onSubmit={submitVoid}
        />
      ) : null}
    </main>
  );
}
