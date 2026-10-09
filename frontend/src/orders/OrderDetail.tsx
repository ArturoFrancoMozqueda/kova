import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthContext } from "@/auth/AuthContext";
import { useParams } from "react-router-dom";
import {
  ORDER_REFUND_PERMISSION,
  ORDER_VOID_PERMISSION,
  usePermission,
} from "../auth/permissions";
import { copy } from "../i18n/messages";
import { createRefund, createVoid, getOrder, getReceipt } from "./api";
import { formatMoney, formatMoneyDelta } from "./format";
import { ReceiptDisplay } from "./ReceiptDisplay";
import { RefundModal } from "./RefundModal";
import type { Order, Receipt, RefundPayload } from "./types";
import { VoidModal } from "./VoidModal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiErrorDetail, apiErrorStatus, resolveApiErrorMessage } from "@/lib/apiError";
import { useBillingBlocked } from "@/billing/useBillingBlocked";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { AlertCircle, RotateCcw, Ban, ArrowLeft, Package, Printer } from "lucide-react";
import { Link } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "not-found" }
  | { status: "loaded"; order: Order; receipt: Receipt };

type RefundIntent = {
  payload: RefundPayload;
  idempotencyKey: string;
};

export default function OrderDetail() {
  useDocumentTitle(copy.documentTitles.orderDetail);
  const { orderId } = useParams();
  const { state: authState } = useAuthContext();
  const canPrepareInvoice = authState.status === "authenticated" && authState.user.role === "owner";
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [activeModal, setActiveModal] = useState<"refund" | "void" | null>(null);
  const [operationPending, setOperationPending] = useState(false);
  const [refundIntentLocked, setRefundIntentLocked] = useState(false);
  const refundIntentRef = useRef<RefundIntent | null>(null);
  const canRefund = usePermission(ORDER_REFUND_PERMISSION);
  const canVoid = usePermission(ORDER_VOID_PERMISSION);
  const { toast } = useToast();
  const handleBillingBlocked = useBillingBlocked();

  const load = useCallback(async () => {
    if (!orderId) {
      setLoadState({ status: "error", message: copy.orderDetail.loadError });
      return;
    }
    setLoadState({ status: "loading" });
    try {
      const [order, receipt] = await Promise.all([getOrder(orderId), getReceipt(orderId)]);
      setLoadState({ status: "loaded", order, receipt });
    } catch (err) {
      // A missing order (bad link, deleted) is a distinct dead-end, not a
      // transient failure — show a "not found" state with a way back instead of
      // a retry button that will keep 404-ing.
      if (apiErrorStatus(err) === 404) {
        setLoadState({ status: "not-found" });
        return;
      }
      setLoadState({ status: "error", message: resolveApiErrorMessage(err, copy.orderDetail.loadError) });
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitRefund = async (payload: RefundPayload) => {
    if (!orderId) return;
    const intent = refundIntentRef.current ?? {
      payload,
      idempotencyKey: crypto.randomUUID(),
    };
    refundIntentRef.current = intent;
    setOperationPending(true);
    try {
      await createRefund(orderId, intent.payload, intent.idempotencyKey);
      refundIntentRef.current = null;
      setRefundIntentLocked(false);
      setActiveModal(null);
      toast(copy.orderDetail.refundSuccess, "success");
      await load();
    } catch (err) {
      if (handleBillingBlocked(err)) {
        refundIntentRef.current = null;
        setRefundIntentLocked(false);
        return;
      }
      const detail = apiErrorDetail(err);
      const mapped =
        detail?.code === "REFUND_QTY_EXCEEDS_AVAILABLE"
          ? copy.orderDetail.refundQtyExceeds(Number(detail.available) || 0)
          : null;
      const status = apiErrorStatus(err);
      if (status !== null && status < 500) {
        // The server definitively rejected this payload, so the operator may
        // correct it and start a new intent.
        refundIntentRef.current = null;
        setRefundIntentLocked(false);
      } else {
        // A timeout/network/5xx response may have followed a commit. Freeze
        // the payload so retrying can only replay the same backend identity.
        setRefundIntentLocked(true);
      }
      toast(mapped ?? resolveApiErrorMessage(err, copy.orderDetail.operationError), "error");
    } finally {
      setOperationPending(false);
    }
  };

  const submitVoid = async (reason: string, notDelivered?: boolean) => {
    if (!orderId) return;
    setOperationPending(true);
    try {
      await createVoid(orderId, reason, notDelivered);
      setActiveModal(null);
      toast(copy.orderDetail.voidSuccess, "success");
      await load();
    } catch (err) {
      if (handleBillingBlocked(err)) return;
      // 409 = the order already changed underneath us (e.g. voided in another
      // tab). Reconcile by reloading and telling the user, rather than showing a
      // generic error that leaves stale state on screen.
      if (apiErrorStatus(err) === 409) {
        setActiveModal(null);
        toast(copy.orderDetail.conflictReload, "warning");
        await load();
        return;
      }
      toast(resolveApiErrorMessage(err, copy.orderDetail.operationError), "error");
    } finally {
      setOperationPending(false);
    }
  };

  if (loadState.status === "loading") {
    return (
      <ViewLayout width="focused" className="max-w-4xl">
        <Skeleton className="h-8 w-48 mb-6" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </ViewLayout>
    );
  }

  if (loadState.status === "not-found") {
    return (
      <ViewLayout width="focused" className="max-w-4xl">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Package className="mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-base font-semibold">{copy.orderDetail.notFoundTitle}</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {copy.orderDetail.notFoundBody}
            </p>
            <Link to="/orders" className={cn("mt-4", buttonVariants({ variant: "outline", size: "sm" }))}>
              <ArrowLeft className="h-4 w-4" />
              {copy.orderDetail.backToOrders}
            </Link>
          </CardContent>
        </Card>
      </ViewLayout>
    );
  }

  if (loadState.status === "error") {
    return (
      <ViewLayout width="focused" className="max-w-4xl">
        <Card className="border-destructive/50">
          <CardContent className="flex items-center gap-4 p-6">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="font-medium">{loadState.message}</p>
            <Button variant="outline" onClick={() => void load()} className="ml-auto">
              {copy.orderDetail.retry}
            </Button>
          </CardContent>
        </Card>
      </ViewLayout>
    );
  }

  const { order, receipt } = loadState;
  const isVoided = receipt.status === "voided";
  const canManageOrderCorrections = canRefund || canVoid;
  const canShowCorrectionActions = canManageOrderCorrections && !isVoided;

  // Aggregate refunded quantity per line item so we can annotate "x (n devuelta)"
  // and decide whether to surface a partial/full-refund badge alongside the
  // primary status pill.
  const refundedQtyByItem = new Map<string, number>();
  for (const refund of receipt.refunds) {
    for (const refundItem of refund.items) {
      refundedQtyByItem.set(
        refundItem.order_item_id,
        (refundedQtyByItem.get(refundItem.order_item_id) ?? 0) + refundItem.quantity,
      );
    }
  }
  const totalOrderedQty = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const totalRefundedQty = Array.from(refundedQtyByItem.values()).reduce((sum, n) => sum + n, 0);
  const refundState: "none" | "partial" | "full" =
    totalRefundedQty === 0
      ? "none"
      : totalRefundedQty >= totalOrderedQty
        ? "full"
        : "partial";

  return (
    <ViewLayout width="focused" className="max-w-4xl animate-fade-in">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <Link to="/orders" className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <ViewHeader
            title={copy.orderDetail.title}
            meta={<span className="tabular-nums text-sm">{orderId?.slice(0, 8)}</span>}
            actions={
              <div className="flex items-center gap-2 flex-wrap">
                {canPrepareInvoice && order.status === "completed" && receipt.status === "completed" && !receipt.void && receipt.refunds.length === 0 && <Link to={`/settings/integrations?order_id=${encodeURIComponent(order.id)}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Preparar factura</Link>}
                <Badge variant={isVoided ? "destructive" : "success"} className="text-sm">
                  {isVoided ? copy.orderDetail.voided : copy.orderDetail.completed}
                </Badge>
                {!isVoided && refundState === "partial" && (
                  <Badge variant="warning" className="text-sm">{copy.orderDetail.refundedPartial}</Badge>
                )}
                {!isVoided && refundState === "full" && (
                  <Badge variant="destructive" className="text-sm">{copy.orderDetail.refundedFull}</Badge>
                )}
              </div>
            }
          />
        </div>
      </div>

      {isVoided && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive mb-6 animate-fade-in">
          <Ban className="h-4 w-4 shrink-0" />
          {copy.orderDetail.voidedBanner}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Items */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              {copy.orderDetail.items}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {order.items.map((item) => {
              const refundedQty = refundedQtyByItem.get(item.id) ?? 0;
              return (
                <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{item.product_name}</p>
                    {item.lot_allocations?.length ? <p className="text-xs text-muted-foreground">Lotes entregados: {item.lot_allocations.map(part => `${part.code ?? "Lote registrado"} · ${part.quantity} unidades`).join(", ")}</p> : null}
                    {item.modifiers?.map((m) => (
                      <p key={`${m.modifier_group_name}-${m.modifier_option_name}`} className="text-xs text-muted-foreground mt-0.5 pl-2">
                        + {m.modifier_option_name}
                        {parseFloat(m.price_delta_amount) > 0 && ` (${formatMoneyDelta(m.price_delta_amount)})`}
                      </p>
                    ))}
                    <p className="text-xs text-muted-foreground mt-1">
                      x{item.quantity}
                      {refundedQty > 0 && (
                        <span className="ml-1 text-destructive">
                          {" "}({copy.orderDetail.refundedQty(refundedQty)})
                        </span>
                      )}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{formatMoney(item.line_total_amount)}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Actions + Receipt */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{copy.orderDetail.actions}</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="h-4 w-4" />
                {copy.orderDetail.printTicket}
              </Button>
              {canShowCorrectionActions ? (
                <>
                  {canRefund && refundState !== "full" && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        refundIntentRef.current = null;
                        setRefundIntentLocked(false);
                        setActiveModal("refund");
                      }}
                    >
                      <RotateCcw className="h-4 w-4" />
                      {copy.orderDetail.refund}
                    </Button>
                  )}
                  {canVoid && receipt.refunds.length === 0 && (
                    <Button variant="destructive" onClick={() => setActiveModal("void")}>
                      <Ban className="h-4 w-4" />
                      {copy.orderDetail.void}
                    </Button>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {canManageOrderCorrections
                    ? copy.orderDetail.actionsUnavailable
                    : copy.orderDetail.permissionHidden}
                </p>
              )}
            </CardContent>
          </Card>

          {order.items.some(item => item.lot_tracked) && <p className="rounded-lg border p-3 text-sm">Los reembolsos de productos con lotes no reponen inventario. Al anular, confirma si hubo entrega para determinar la reposición.</p>}
          <ReceiptDisplay order={order} receipt={receipt} />
        </div>
      </div>

      {activeModal === "refund" && (
        <RefundModal
          disabled={operationPending}
          fieldsLocked={refundIntentLocked}
          items={order.items
            .map((item) => ({
              ...item,
              quantity: Math.max(0, item.quantity - (refundedQtyByItem.get(item.id) ?? 0)),
            }))
            .filter((item) => item.quantity > 0)}
          onCancel={() => {
            refundIntentRef.current = null;
            setRefundIntentLocked(false);
            setActiveModal(null);
          }}
          onSubmit={submitRefund}
        />
      )}
      {activeModal === "void" && (
        <VoidModal
          hasLots={order.items.some(item => item.lot_tracked)}
          disabled={operationPending}
          onCancel={() => setActiveModal(null)}
          onSubmit={submitVoid}
        />
      )}
    </ViewLayout>
  );
}
