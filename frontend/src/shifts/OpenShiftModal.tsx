import { useState } from "react";
import { copy } from "../i18n/messages";
import type { ShiftOpenPayload } from "./types";

interface OpenShiftModalProps {
  pending: boolean;
  onSubmit: (payload: ShiftOpenPayload) => void;
  onCancel: () => void;
}

export function OpenShiftModal({ pending, onSubmit, onCancel }: OpenShiftModalProps) {
  const [amount, setAmount] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      opening_cash_amount: amount || undefined,
    });
  };

  return (
    <dialog open>
      <article>
        <h2>{copy.openShiftModal.title}</h2>
        <form onSubmit={handleSubmit}>
          <label>
            <span>{copy.openShiftModal.openingCash}</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              disabled={pending}
            />
          </label>
          <p>{copy.openShiftModal.optional}</p>
          <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
            <button type="button" onClick={onCancel} disabled={pending}>
              {copy.openShiftModal.cancel}
            </button>
            <button type="submit" disabled={pending} aria-busy={pending}>
              {copy.openShiftModal.submit}
            </button>
          </div>
        </form>
      </article>
    </dialog>
  );
}
