import { useCallback, useEffect, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { AlertCircle, RotateCcw, Ban, ArrowLeft, Package, Printer } from "lucide-react";
import { Link } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; order: Order; receipt: Receipt };

export default function OrderDetail() {
  useDocumentTitle("Detalle de orden");
  const { orderId } = useParams();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [activeModal, setActiveModal] = useState<"refund" | "void" | null>(null);
  const [operationPending, setOperationPending] = useState(false);
  const canRefund = usePermission(ORDER_REFUND_PERMISSION);
  const canVoid = usePermission(ORDER_VOID_PERMISSION);
  const { toast } = useToast();

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
    if (!orderId) return;
    setOperationPending(true);
    try {
      await createRefund(orderId, payload);
      setActiveModal(null);
      toast(copy.orderDetail.refundSuccess, "success");
      await load();
    } catch (err) {
      let mapped: string | null = null;
      try {
        const body = JSON.parse((err as Error).message);
        const detail = body?.detail;
        if (detail && typeof detail === "object" && detail.code === "REFUND_QTY_EXCEEDS_AVAILABLE") {
          mapped = copy.orderDetail.refundQtyExceeds(detail.available ?? 0);
        }
      } catch {
        // not JSON — fall through
      }
      toast(mapped ?? copy.orderDetail.operationError, "error");
    } finally {
      setOperationPending(false);
    }
  };

  const submitVoid = async (reason: string) => {
    if (!orderId) return;
    setOperationPending(true);
    try {
      await createVoid(orderId, reason);
      setActiveModal(null);
      toast(copy.orderDetail.voidSuccess, "success");
      await load();
    } catch {
      toast(copy.orderDetail.operationError, "error");
    } finally {
      setOperationPending(false);
    }
  };

  if (loadState.status === "loading") {
    return (
      <main className="p-6 lg:p-8 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-48 mb-6" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </main>
    );
  }

  if (loadState.status === "error") {
    return (
      <main className="p-6 lg:p-8 max-w-4xl mx-auto">
        <Card className="border-destructive/50">
          <CardContent className="flex items-center gap-4 p-6">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="font-medium">{loadState.message}</p>
            <Button variant="outline" onClick={() => void load()} className="ml-auto">
              {copy.orderDetail.retry}
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const { order, receipt } = loadState;
  const isVoided = receipt.status === "voided";

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
    <main className="p-6 lg:p-8 max-w-4xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link to="/orders" className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{copy.orderDetail.title}</h1>
          <p className="text-sm text-muted-foreground font-mono">{orderId?.slice(0, 8)}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
                  <span className="text-sm font-semibold">{formatMoney(item.line_total_amount)}</span>
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
              {(canRefund || canVoid) && !isVoided ? (
                <>
                  {canRefund && (
                    <Button variant="outline" onClick={() => setActiveModal("refund")}>
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
                <p className="text-sm text-muted-foreground">{copy.orderDetail.permissionHidden}</p>
              )}
            </CardContent>
          </Card>

          <ReceiptDisplay order={order} receipt={receipt} />
        </div>
      </div>

      {activeModal === "refund" && (
        <RefundModal
          disabled={operationPending}
          items={order.items}
          onCancel={() => setActiveModal(null)}
          onSubmit={submitRefund}
        />
      )}
      {activeModal === "void" && (
        <VoidModal
          disabled={operationPending}
          onCancel={() => setActiveModal(null)}
          onSubmit={submitVoid}
        />
      )}
    </main>
  );
}
