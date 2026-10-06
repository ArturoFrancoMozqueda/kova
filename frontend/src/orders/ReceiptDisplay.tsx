import { copy } from "../i18n/messages";
import { formatTenantName } from "@/lib/formatTenantName";
import type { Order, Receipt } from "./types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Receipt as ReceiptIcon } from "lucide-react";
import { ReceiptTemplate, type ReceiptTemplateRefund } from "./ReceiptTemplate";
import { TicketPaper } from "@/components/ui/ticket";

type ReceiptDisplayProps = {
  order: Order;
  receipt: Receipt;
};

export function ReceiptDisplay({ order, receipt }: ReceiptDisplayProps) {
  const itemNames = new Map(order.items.map((item) => [item.id, item.product_name]));
  const refundedTotal = receipt.refunds.reduce(
    (sum, refund) => sum + Number(refund.refunded_amount),
    0,
  );
  const showNet = refundedTotal > 0 && receipt.status !== "voided";
  const netAmount = Math.max(0, Number(receipt.total_amount) - refundedTotal);
  const templateRefunds: ReceiptTemplateRefund[] = receipt.refunds.map((refund) => ({
    id: refund.id,
    reason: refund.reason,
    refunded_amount: refund.refunded_amount,
    items: refund.items.map((item) => ({
      label: itemNames.get(item.order_item_id) ?? item.order_item_id,
      quantity: item.quantity,
    })),
  }));

  return (
    <Card>
      <CardHeader className="no-print">
        <CardTitle className="flex items-center gap-2">
          <ReceiptIcon className="h-4 w-4" />
          {copy.orderDetail.receipt}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {formatTenantName(receipt.tenant_name)} &middot; {receipt.receipt_number}
        </p>
      </CardHeader>
      <CardContent>
        <TicketPaper className="mx-auto max-w-sm">
          <ReceiptTemplate
            businessName={formatTenantName(receipt.tenant_name)}
            receiptNumber={receipt.receipt_number}
            createdAt={receipt.created_at}
            paperWidthMm={receipt.paper_width_mm ?? 80}
            items={receipt.items}
            discountAmount={receipt.discount_amount}
            taxRate={receipt.tax_rate}
            taxAmount={receipt.tax_amount}
            subtotalAmount={receipt.subtotal_amount}
            totalAmount={receipt.total_amount}
            payments={receipt.payments}
            totalTendered={receipt.total_tendered}
            totalChange={receipt.total_change}
            refundedTotal={showNet ? refundedTotal.toFixed(2) : undefined}
            netAmount={showNet ? netAmount.toFixed(2) : undefined}
            refunds={templateRefunds}
            voidReason={receipt.void?.reason}
            className="print-receipt-root"
          />
        </TicketPaper>
      </CardContent>
    </Card>
  );
}
