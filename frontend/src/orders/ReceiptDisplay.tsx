import { copy } from "../i18n/messages";
import { formatMoney, reasonLabel } from "./format";
import type { Order, Receipt } from "./types";

type ReceiptDisplayProps = {
  order: Order;
  receipt: Receipt;
};

export function ReceiptDisplay({ order, receipt }: ReceiptDisplayProps) {
  const itemNames = new Map(order.items.map((item) => [item.id, item.product_name]));

  return (
    <section aria-labelledby="receipt-title">
      <h2 id="receipt-title">{copy.orderDetail.receipt}</h2>
      <p>{receipt.tenant_name}</p>
      <p>{receipt.receipt_number}</p>
      <dl>
        <div>
          <dt>{copy.orderDetail.subtotal}</dt>
          <dd>{formatMoney(receipt.subtotal_amount)}</dd>
        </div>
        <div>
          <dt>{copy.orderDetail.total}</dt>
          <dd>{formatMoney(receipt.total_amount)}</dd>
        </div>
        <div>
          <dt>{copy.orderDetail.totalTendered}</dt>
          <dd>{formatMoney(receipt.total_tendered)}</dd>
        </div>
        <div>
          <dt>{copy.orderDetail.change}</dt>
          <dd>{formatMoney(receipt.total_change)}</dd>
        </div>
      </dl>
      <section aria-labelledby="receipt-payments-title">
        <h3 id="receipt-payments-title">{copy.orderDetail.payments}</h3>
        {receipt.payments.map((payment, index) => (
          <p key={`${payment.method}-${index}`}>
            {reasonLabel(payment.method)} {formatMoney(payment.amount_amount)}
          </p>
        ))}
      </section>
      <section aria-labelledby="receipt-refunds-title">
        <h3 id="receipt-refunds-title">{copy.orderDetail.refunds}</h3>
        {receipt.refunds.length === 0 ? <p>{copy.orderDetail.noRefunds}</p> : null}
        {receipt.refunds.map((refund) => (
          <article key={refund.id}>
            <h4>
              {reasonLabel(refund.reason)} {formatMoney(refund.refunded_amount)}
            </h4>
            {refund.items.map((item) => (
              <p key={`${refund.id}-${item.order_item_id}`}>
                {itemNames.get(item.order_item_id) ?? item.order_item_id} x{item.quantity}
              </p>
            ))}
          </article>
        ))}
      </section>
      {receipt.void ? (
        <section aria-label={copy.orderDetail.voidedBanner}>
          <h3>{copy.orderDetail.voided}</h3>
          <p>{reasonLabel(receipt.void.reason)}</p>
        </section>
      ) : null}
    </section>
  );
}
