import { copy } from "@/i18n/messages";
import { cn } from "@/lib/utils";
import { formatDateTime, formatMoney, reasonLabel } from "./format";
import type { HTMLAttributes } from "react";

type ReceiptModifier = {
  modifier_group_name?: string;
  modifier_option_name: string;
  price_delta_amount: string;
};

type ReceiptItem = {
  product_name: string;
  quantity: number;
  unit_price_amount: string;
  line_total_amount: string;
  modifiers?: ReceiptModifier[];
};

type ReceiptPayment = {
  method: string;
  amount_amount: string;
};

export type ReceiptTemplateRefund = {
  id: string;
  reason: string;
  refunded_amount: string;
  items?: Array<{
    label: string;
    quantity: number;
  }>;
};

type ReceiptTemplateProps = {
  businessName: string;
  receiptNumber?: string;
  createdAt: string | Date;
  logoUrl?: string;
  taxContactText?: string;
  footer?: string;
  items: ReceiptItem[];
  subtotalAmount: string;
  totalAmount: string;
  payments: ReceiptPayment[];
  totalTendered?: string;
  totalChange?: string;
  refundedTotal?: string;
  netAmount?: string;
  refunds?: ReceiptTemplateRefund[];
  voidReason?: string;
  className?: string;
} & HTMLAttributes<HTMLDivElement>;

export function ReceiptTemplate({
  businessName,
  receiptNumber,
  createdAt,
  logoUrl,
  taxContactText,
  footer,
  items,
  subtotalAmount,
  totalAmount,
  payments,
  totalTendered,
  totalChange,
  refundedTotal,
  netAmount,
  refunds = [],
  voidReason,
  className,
  ...containerProps
}: ReceiptTemplateProps) {
  const showCashSettlement = Number(totalTendered ?? "0") > 0;

  return (
    <div
      {...containerProps}
      className={cn(
        "receipt-template rounded-[var(--radius-lg)] border border-[color:var(--kova-border)] bg-white p-4 font-mono text-[11px] leading-snug text-[color:var(--kova-ink)] shadow-sm",
        className,
      )}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={copy.settings.receiptPreviewLogoAlt}
            className="h-10 w-auto object-contain"
            onError={(event) => {
              (event.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}
        <p className="text-sm font-semibold tracking-tight">{businessName}</p>
        {taxContactText ? (
          <p className="whitespace-pre-line text-[10px] text-muted-foreground">{taxContactText}</p>
        ) : null}
        {receiptNumber ? <p className="text-[10px] text-muted-foreground">{receiptNumber}</p> : null}
        <p className="text-[10px] text-muted-foreground">{formatDateTime(createdAt)}</p>
      </div>

      <ReceiptSeparator />

      <div className="space-y-1">
        {items.map((item, index) => (
          <div key={`${item.product_name}-${index}`} className="space-y-0.5">
            <div className="flex justify-between gap-3">
              <span className="truncate">
                {item.quantity} x {item.product_name}
              </span>
              <span>{formatMoney(item.line_total_amount)}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {formatMoney(item.unit_price_amount)} c/u
            </p>
            {(item.modifiers ?? []).map((modifier) => (
              <p
                className="pl-2 text-[10px] text-muted-foreground"
                key={`${modifier.modifier_group_name ?? "modifier"}-${modifier.modifier_option_name}`}
              >
                + {modifier.modifier_option_name}
                {Number.parseFloat(modifier.price_delta_amount) > 0
                  ? ` +${formatMoney(modifier.price_delta_amount)}`
                  : ""}
              </p>
            ))}
          </div>
        ))}
      </div>

      <ReceiptSeparator />

      <div className="space-y-1">
        <ReceiptLine label={copy.orderDetail.subtotal} value={formatMoney(subtotalAmount)} />
        <ReceiptLine label={copy.orderDetail.total} value={formatMoney(totalAmount)} strong />
        {payments.map((payment, index) => (
          <ReceiptLine
            key={`${payment.method}-${index}`}
            label={reasonLabel(payment.method)}
            value={formatMoney(payment.amount_amount)}
            muted
          />
        ))}
        {showCashSettlement ? (
          <>
            <ReceiptLine label={copy.orderDetail.totalTendered} value={formatMoney(totalTendered ?? "0")} muted />
            <ReceiptLine label={copy.orderDetail.change} value={formatMoney(totalChange ?? "0")} muted />
          </>
        ) : null}
        {refundedTotal && Number(refundedTotal) > 0 ? (
          <ReceiptLine label={copy.orderDetail.refundedAmount} value={`-${formatMoney(refundedTotal)}`} muted />
        ) : null}
        {netAmount ? <ReceiptLine label={copy.orderDetail.netAmount} value={formatMoney(netAmount)} strong /> : null}
      </div>

      {refunds.length > 0 ? (
        <>
          <ReceiptSeparator />
          <div className="space-y-2">
            <p className="font-semibold">{copy.orderDetail.refunds}</p>
            {refunds.map((refund) => (
              <div key={refund.id}>
                <ReceiptLine label={reasonLabel(refund.reason)} value={`-${formatMoney(refund.refunded_amount)}`} />
                {(refund.items ?? []).map((item) => (
                  <p key={`${refund.id}-${item.label}`} className="text-[10px] text-muted-foreground">
                    {item.label} x{item.quantity}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </>
      ) : null}

      {voidReason ? (
        <>
          <ReceiptSeparator />
          <p className="text-center font-semibold text-destructive">{copy.orderDetail.voided}</p>
          <p className="text-center text-[10px] text-muted-foreground">{reasonLabel(voidReason)}</p>
        </>
      ) : null}

      <ReceiptSeparator />
      <p className="whitespace-pre-line text-center text-[10px] text-muted-foreground">
        {footer || copy.settings.receiptPreviewThanks}
      </p>
    </div>
  );
}

function ReceiptSeparator() {
  return <div className="my-3 border-t border-dashed border-[color:var(--kova-border)]" />;
}

function ReceiptLine({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={cn("flex justify-between gap-3", strong && "font-semibold", muted && "text-muted-foreground")}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
