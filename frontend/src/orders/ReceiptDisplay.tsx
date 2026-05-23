import { copy } from "../i18n/messages";
import { formatMoney, formatDateTime, reasonLabel } from "./format";
import { formatTenantName } from "@/lib/formatTenantName";
import type { Order, Receipt } from "./types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Receipt as ReceiptIcon, CreditCard, RotateCcw, Ban } from "lucide-react";

type ReceiptDisplayProps = {
  order: Order;
  receipt: Receipt;
};

export function ReceiptDisplay({ order, receipt }: ReceiptDisplayProps) {
  const itemNames = new Map(order.items.map((item) => [item.id, item.product_name]));
  const hasCashPayment = receipt.payments.some((payment) => payment.method === "cash");
  const showCashSettlement = hasCashPayment && Number(receipt.total_tendered) > 0;

  const refundedTotal = receipt.refunds.reduce(
    (sum, refund) => sum + Number(refund.refunded_amount),
    0,
  );
  const showNet = refundedTotal > 0 && receipt.status !== "voided";
  const netAmount = Math.max(0, Number(receipt.total_amount) - refundedTotal);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ReceiptIcon className="h-4 w-4" />
          {copy.orderDetail.receipt}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{formatTenantName(receipt.tenant_name)} &middot; {receipt.receipt_number}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{formatDateTime(receipt.created_at)}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-muted-foreground text-xs">{copy.orderDetail.subtotal}</p>
            <p className="font-semibold">{formatMoney(receipt.subtotal_amount)}</p>
          </div>
          <div className="rounded-lg bg-primary/5 p-3">
            <p className="text-muted-foreground text-xs">{copy.orderDetail.total}</p>
            <p className="font-bold text-primary">{formatMoney(receipt.total_amount)}</p>
          </div>
          {showCashSettlement ? (
            <>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-muted-foreground text-xs">{copy.orderDetail.totalTendered}</p>
                <p className="font-semibold">{formatMoney(receipt.total_tendered)}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-muted-foreground text-xs">{copy.orderDetail.change}</p>
                <p className="font-semibold">{formatMoney(receipt.total_change)}</p>
              </div>
            </>
          ) : null}
          {showNet && (
            <>
              <div className="rounded-lg bg-destructive/5 p-3">
                <p className="text-destructive text-xs">{copy.orderDetail.refundedAmount}</p>
                <p className="font-semibold text-destructive">−{formatMoney(refundedTotal.toFixed(2))}</p>
              </div>
              <div className="rounded-lg bg-kova-growth/10 p-3">
                <p className="text-muted-foreground text-xs">{copy.orderDetail.netAmount}</p>
                <p className="font-bold">{formatMoney(netAmount.toFixed(2))}</p>
              </div>
            </>
          )}
        </div>

        {/* Items */}
        <div>
          <h3 className="text-sm font-semibold mb-2">{copy.orderDetail.items}</h3>
          <div className="space-y-2">
            {receipt.items.map((item, index) => (
              <div key={`${item.product_name}-${index}`} className="flex items-start justify-between gap-3 text-sm">
                <div className="flex-1">
                  <p className="font-medium">{item.product_name}</p>
                  <p className="text-xs text-muted-foreground">{item.quantity} x {formatMoney(item.unit_price_amount)}</p>
                  {(item.modifiers ?? []).map((modifier) => (
                    <p className="text-xs text-muted-foreground pl-2" key={`${modifier.modifier_group_name}-${modifier.modifier_option_name}`}>
                      + {modifier.modifier_option_name}
                      {Number.parseFloat(modifier.price_delta_amount) > 0 ? ` +${formatMoney(modifier.price_delta_amount)}` : ""}
                    </p>
                  ))}
                </div>
                <span className="font-semibold">{formatMoney(item.line_total_amount)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Payments */}
        <div>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <CreditCard className="h-3.5 w-3.5" />
            {copy.orderDetail.payments}
          </h3>
          <div className="space-y-1">
            {receipt.payments.map((payment, index) => (
              <div key={`${payment.method}-${index}`} className="flex justify-between text-sm">
                <span className="text-muted-foreground capitalize">{reasonLabel(payment.method)}</span>
                <span className="font-medium">{formatMoney(payment.amount_amount)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Refunds */}
        <div>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <RotateCcw className="h-3.5 w-3.5" />
            {copy.orderDetail.refunds}
          </h3>
          {receipt.refunds.length === 0 ? (
            <p className="text-sm text-muted-foreground">{copy.orderDetail.noRefunds}</p>
          ) : (
            <div className="space-y-2">
              {receipt.refunds.map((refund) => (
                <div key={refund.id} className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm">
                  <div className="flex justify-between mb-1">
                    <Badge variant="destructive" className="text-[10px]">{reasonLabel(refund.reason)}</Badge>
                    <span className="font-semibold text-destructive">{formatMoney(refund.refunded_amount)}</span>
                  </div>
                  {refund.items.map((item) => (
                    <p key={`${refund.id}-${item.order_item_id}`} className="text-xs text-muted-foreground">
                      {itemNames.get(item.order_item_id) ?? item.order_item_id} x{item.quantity}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {receipt.void && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
            <div className="flex items-center gap-2 text-sm">
              <Ban className="h-4 w-4 text-destructive" />
              <span className="font-semibold text-destructive">{copy.orderDetail.voided}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{reasonLabel(receipt.void.reason)}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
