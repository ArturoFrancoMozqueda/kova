import { useCallback, useEffect, useState } from "react";
import { useAuthContext } from "@/auth/AuthContext";
import { useParams } from "react-router-dom";
import {
  ORDER_REFUND_PERMISSION,
  ORDER_VOID_PERMISSION,
  usePermission,
} from "../auth/permissions";
import { copy } from "../i18n/messages";
import { createRefund, createVoid, getOrder, getReceipt, reconcileRefund } from "./api";
import { formatDateTime, formatMoney, formatMoneyDelta } from "./format";
import { ReceiptDisplay } from "./ReceiptDisplay";
import { RefundModal } from "./RefundModal";
import type { Order, Receipt, RefundPayload } from "./types";
import { VoidModal } from "./VoidModal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiErrorDetail, apiErrorStatus, resolveApiErrorMessage } from "@/lib/apiError";
import { useBillingBlocked } from "@/billing/useBillingBlocked";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { AlertCircle, RotateCcw, Ban, ArrowLeft, Package, Printer } from "lucide-react";
import { Link } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { getActiveBranchId } from "@/branches/activeBranch";
import { clearRefundIntent, prepareRefundIntent, readRefundIntent, refundIntentId, type RefundIntent, type RefundIntentScope } from "./refundIntents";
import { centsToMoney, moneyToCents } from "@/lib/money";
import type { RefundPaymentAllocation } from "./types";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "not-found" }
  | { status: "loaded"; order: Order; receipt: Receipt };

export default function OrderDetail() {
  useDocumentTitle(copy.documentTitles.orderDetail);
  const { orderId } = useParams();
  const { state: authState } = useAuthContext();
  const canPrepareInvoice = authState.status === "authenticated" && authState.user.role === "owner";
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [activeModal, setActiveModal] = useState<"refund" | "void" | null>(null);
  const [operationPending, setOperationPending] = useState(false);
  const [refundIntentLocked, setRefundIntentLocked] = useState(false);
  const refundScope: RefundIntentScope | null = authState.status === "authenticated" && orderId ? {
    tenantId: authState.tenantId,
    userId: authState.user.id,
    branchId: getActiveBranchId(authState.tenantId, authState.user.id),
    orderId,
  } : null;
  const scopeId = refundScope ? refundIntentId(refundScope) : null;
  const [recovery, setRecovery] = useState<{ scopeId: string | null; ready: boolean; intent: RefundIntent | null; error: boolean }>({ scopeId: null, ready: false, intent: null, error: false });
  const visibleRecovery = recovery.scopeId === scopeId ? recovery : { ready: false, intent: null, error: false };
  const pendingRefund = visibleRecovery.intent;
  const canRefund = usePermission(ORDER_REFUND_PERMISSION);
  const canVoid = usePermission(ORDER_VOID_PERMISSION);
  const { toast } = useToast();
  const handleBillingBlocked = useBillingBlocked();

  useEffect(() => {
    let cancelled = false;
    setRefundIntentLocked(false);
    setActiveModal(null);
    if (!scopeId) return;
    const scope = JSON.parse(scopeId) as [string, string, string, string];
    void readRefundIntent({ tenantId: scope[0], userId: scope[1], branchId: scope[2], orderId: scope[3] }).then((intent) => {
      if (cancelled) return;
      setRefundIntentLocked(Boolean(intent));
      setRecovery({ scopeId, ready: true, intent: intent ?? null, error: false });
    }).catch(() => {
      if (!cancelled) setRecovery({ scopeId, ready: false, intent: null, error: true });
    });
    return () => { cancelled = true; };
  }, [scopeId]);

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
    if (!orderId || !refundScope || !visibleRecovery.ready || operationPending) return;
    let intent: RefundIntent | null = null;
    let isFirstAttempt = false;
    const forgetConfirmedIntent = async (confirmed: RefundIntent | null) => {
      try {
        if (confirmed) await clearRefundIntent(confirmed);
        setRecovery({ scopeId, ready: true, intent: null, error: false });
        setRefundIntentLocked(false);
        return true;
      } catch {
        setRefundIntentLocked(true);
        toast("No pudimos actualizar la confirmación en este dispositivo. Reintenta la misma devolución para recuperar su resultado.", "warning");
        return false;
      }
    };
    setOperationPending(true);
    try {
      const prepared = await prepareRefundIntent(refundScope, payload, pendingRefund);
      intent = prepared.intent;
      isFirstAttempt = prepared.created;
      setRecovery({ scopeId, ready: true, intent, error: false });
      setRefundIntentLocked(true);
      if (!prepared.created && pendingRefund?.idempotencyKey !== intent.idempotencyKey) {
        setActiveModal(null);
        toast("Hay una devolución pendiente de otra pestaña. Revisa sus datos y confirma el reintento.", "warning");
        return;
      }
      await createRefund(orderId, intent.payload, intent.idempotencyKey);
      if (!await forgetConfirmedIntent(intent)) return;
      setActiveModal(null);
      toast(copy.orderDetail.refundSuccess, "success");
      await load();
    } catch (err) {
      if (handleBillingBlocked(err)) {
        // A billing gate says nothing about a previous attempt's commit.
        setRefundIntentLocked(Boolean(intent));
        return;
      }
      const detail = apiErrorDetail(err);
      const mapped =
        detail?.code === "REFUND_QTY_EXCEEDS_AVAILABLE"
          ? copy.orderDetail.refundQtyExceeds(Number(detail.available) || 0)
          : null;
      const status = apiErrorStatus(err);
      if (isFirstAttempt && (status === 400 || status === 422)) {
        // Only a validation rejection of the first attempt proves that this
        // operation was not committed. A later gate/validation rejection cannot
        // resolve an earlier lost response and must keep its original key.
        await forgetConfirmedIntent(intent);
      } else {
        // A timeout/network/5xx response may have followed a commit. Freeze
        // the payload so retrying can only replay the same backend identity.
        setRefundIntentLocked(Boolean(intent));
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

  const resolvePendingRefund = async () => {
    if (!pendingRefund || operationPending) return;
    setOperationPending(true);
    try {
      const result = await reconcileRefund(pendingRefund.orderId, pendingRefund.payload, pendingRefund.idempotencyKey);
      await clearRefundIntent(pendingRefund);
      setRecovery({ scopeId, ready: true, intent: null, error: false });
      setRefundIntentLocked(false);
      setActiveModal(null);
      toast(result.status === "confirmed" ? copy.orderDetail.refundSuccess : "La devolución no se había registrado. Ya puedes preparar una nueva.", "success");
      await load();
    } catch (err) {
      if (!handleBillingBlocked(err)) {
        toast(resolveApiErrorMessage(err, "No pudimos confirmar el resultado. Conservamos la misma devolución para volver a intentarlo."), "error");
      }
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
  const canShowCorrectionActions = canManageOrderCorrections && (!isVoided || Boolean(pendingRefund));

  // Aggregate refunded quantity per line item so we can annotate "x (n devuelta)"
  // and decide whether to surface a partial/full-refund badge alongside the
  // primary status pill.
  const refundedQtyByItem = new Map<string, number>();
  // Units refunded without going back to stock; older refunds (null) restocked automatically.
  const unrestockedQtyByItem = new Map<string, number>();
  for (const refund of receipt.refunds) {
    for (const refundItem of refund.items) {
      refundedQtyByItem.set(
        refundItem.order_item_id,
        (refundedQtyByItem.get(refundItem.order_item_id) ?? 0) + refundItem.quantity,
      );
      if (refundItem.restocked_quantity != null && refundItem.restocked_quantity < refundItem.quantity) {
        unrestockedQtyByItem.set(
          refundItem.order_item_id,
          (unrestockedQtyByItem.get(refundItem.order_item_id) ?? 0) + refundItem.quantity - refundItem.restocked_quantity,
        );
      }
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
  const availableRefundPayments: RefundPaymentAllocation[] = (["cash", "bank_transfer", "manual_card"] as const).flatMap(method => {
    const collected = receipt.payments.filter(payment => payment.method === method).reduce((sum, payment) => sum + moneyToCents(payment.amount_amount), 0);
    const returned = receipt.refunds.flatMap(refund => refund.payments ?? []).filter(payment => payment.method === method).reduce((sum, payment) => sum + moneyToCents(payment.amount), 0);
    return collected > returned ? [{ method, amount: centsToMoney(collected - returned) }] : [];
  });

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
            meta={<span className="tabular-nums text-sm">{formatDateTime(receipt.created_at)} · {formatMoney(order.total_amount)}</span>}
            actions={
              <div className="flex items-center gap-2 flex-wrap">
                {canPrepareInvoice && order.status === "completed" && receipt.status === "completed" && !receipt.void && receipt.refunds.length === 0 && <Link to={`/settings/integrations?order_id=${encodeURIComponent(order.id)}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Preparar factura</Link>}
                <StatusBadge domain="sale" value={isVoided ? "voided" : "completed"} label={isVoided ? copy.orderDetail.voided : copy.orderDetail.completed} className="text-sm" />
                {!isVoided && refundState === "partial" && (
                  <StatusBadge domain="refund" value="partial" label={copy.orderDetail.refundedPartial} className="text-sm" />
                )}
                {!isVoided && refundState === "full" && (
                  <StatusBadge domain="refund" value="full" label={copy.orderDetail.refundedFull} className="text-sm" />
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
              const unrestockedQty = item.stock_consumed && !item.lot_tracked ? unrestockedQtyByItem.get(item.id) ?? 0 : 0;
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
                    {unrestockedQty > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {copy.refundModal.notRestocked}: {unrestockedQty}
                      </p>
                    )}
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
                  {canRefund && (refundState !== "full" || pendingRefund) && (
                    <Button
                      variant="outline"
                      disabled={!visibleRecovery.ready || operationPending}
                      onClick={() => {
                        setRefundIntentLocked(Boolean(pendingRefund));
                        setActiveModal("refund");
                      }}
                    >
                      <RotateCcw className="h-4 w-4" />
                      {pendingRefund ? "Revisar devolución pendiente" : copy.orderDetail.refund}
                    </Button>
                  )}
                  {canVoid && !isVoided && !pendingRefund && receipt.refunds.length === 0 && (
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

          {canRefund && pendingRefund && <p role="status" className="rounded-lg border p-3 text-sm">Hay una devolución por confirmar. Revisa y reintenta la misma operación antes de registrar otra.</p>}
          {canRefund && visibleRecovery.error && <p role="alert" className="rounded-lg border p-3 text-sm">No pudimos recuperar las devoluciones pendientes de este dispositivo. Recarga para volver a intentarlo antes de registrar una devolución.</p>}

          {order.items.some(item => item.lot_tracked) && <p className="rounded-lg border p-3 text-sm">Los reembolsos de productos con lotes no reponen inventario. Al anular, confirma si hubo entrega para determinar la reposición.</p>}
          <ReceiptDisplay order={order} receipt={receipt} />
        </div>
      </div>

      {activeModal === "refund" && (
        <RefundModal
          disabled={operationPending}
          fieldsLocked={refundIntentLocked}
          initialPayload={pendingRefund?.payload}
          availablePayments={availableRefundPayments}
          refundedQuantities={pendingRefund ? {} : Object.fromEntries(refundedQtyByItem)}
          items={pendingRefund ? order.items : order.items
            .map((item) => ({
              ...item,
              quantity: Math.max(0, item.quantity - (refundedQtyByItem.get(item.id) ?? 0)),
            }))
            .filter((item) => item.quantity > 0)}
          onCancel={() => {
            setActiveModal(null);
          }}
          onSubmit={submitRefund}
          onResolve={pendingRefund ? resolvePendingRefund : undefined}
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
