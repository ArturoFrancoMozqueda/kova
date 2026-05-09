import { type FormEvent, useState } from "react";
import { copy } from "../i18n/messages";
import type { CashMovementPayload } from "./types";

interface CashMovementModalProps {
  pending: boolean;
  initialType?: "cash_in" | "cash_out";
  onSubmit: (payload: CashMovementPayload) => void;
  onCancel: () => void;
}

export function CashMovementModal({
  pending,
  initialType = "cash_out",
  onSubmit,
  onCancel,
}: CashMovementModalProps) {
  const [type, setType] = useState<"cash_in" | "cash_out">(initialType);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!amount || !reason) {
      return;
    }
    onSubmit({
      type,
      amount,
      reason,
    });
  };

  const isValid = amount && reason;

  return (
    <dialog open>
      <article>
        <h2>{copy.cashMovementModal.title}</h2>
        <form onSubmit={handleSubmit}>
          <label>
            <span>{copy.cashMovementModal.type}</span>
            <select value={type} onChange={(e) => setType(e.target.value as "cash_in" | "cash_out")} disabled={pending}>
              <option value="cash_in">{copy.cashMovementModal.cashIn}</option>
              <option value="cash_out">{copy.cashMovementModal.cashOut}</option>
            </select>
          </label>
          <label>
            <span>{copy.cashMovementModal.amount}</span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              disabled={pending}
              required
            />
          </label>
          <label>
            <span>{copy.cashMovementModal.reason}</span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={copy.cashMovementModal.reasonPlaceholder}
              disabled={pending}
              required
            />
          </label>
          <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
            <button type="button" onClick={onCancel} disabled={pending}>
              {copy.cashMovementModal.cancel}
            </button>
            <button type="submit" disabled={pending || !isValid} aria-busy={pending}>
              {copy.cashMovementModal.submit}
            </button>
          </div>
        </form>
      </article>
    </dialog>
  );
}
