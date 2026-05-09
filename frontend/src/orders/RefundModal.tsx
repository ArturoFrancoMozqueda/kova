import { useMemo, useState } from "react";
import { copy } from "../i18n/messages";
import type { OrderItem, RefundPayload } from "./types";

type RefundModalProps = {
  items: OrderItem[];
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (payload: RefundPayload) => Promise<void>;
};

const refundReasons = ["customer_return", "defective", "wrong_item", "other"];

export function RefundModal({ items, disabled, onCancel, onSubmit }: RefundModalProps) {
  const [reason, setReason] = useState(refundReasons[0]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const selectedItems = useMemo(
    () =>
      items
        .map((item) => ({
          order_item_id: item.id,
          quantity: quantities[item.id] ?? 0,
        }))
        .filter((item) => item.quantity > 0),
    [items, quantities],
  );

  const canSubmit = selectedItems.length > 0 && !disabled;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="refund-title">
      <h2 id="refund-title">{copy.refundModal.title}</h2>
      <label>
        {copy.refundModal.reason}
        <select value={reason} onChange={(event) => setReason(event.target.value)}>
          {refundReasons.map((option) => (
            <option key={option} value={option}>
              {option.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <div>
        {items.map((item) => (
          <label key={item.id}>
            {item.product_name}
            <span>{copy.refundModal.quantity}</span>
            <input
              aria-label={`${item.product_name} ${copy.refundModal.quantity}`}
              min="0"
              max={item.quantity}
              type="number"
              value={quantities[item.id] ?? 0}
              onChange={(event) =>
                setQuantities((current) => ({
                  ...current,
                  [item.id]: Number(event.target.value),
                }))
              }
            />
          </label>
        ))}
      </div>
      <button type="button" onClick={onCancel}>
        {copy.refundModal.cancel}
      </button>
      <button
        type="button"
        disabled={!canSubmit}
        onClick={() => onSubmit({ reason, items: selectedItems })}
      >
        {copy.refundModal.submit}
      </button>
    </div>
  );
}
