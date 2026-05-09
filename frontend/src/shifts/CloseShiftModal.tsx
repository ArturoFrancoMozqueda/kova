import { useState } from "react";
import { copy } from "../i18n/messages";
import type { Shift, ShiftClosePayload } from "./types";

interface CloseShiftModalProps {
  shift: Shift;
  pending: boolean;
  onSubmit: (payload: ShiftClosePayload) => void;
  onCancel: () => void;
}

export function CloseShiftModal({ shift, pending, onSubmit, onCancel }: CloseShiftModalProps) {
  const [actualCash, setActualCash] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!actualCash) {
      return;
    }
    onSubmit({
      actual_cash_amount: actualCash,
    });
  };

  const openingCash = shift.opening_cash_amount ? parseFloat(shift.opening_cash_amount) : 0;
  const expectedCash = shift.expected_cash_amount ? parseFloat(shift.expected_cash_amount) : 0;
  const actualAmount = actualCash ? parseFloat(actualCash) : 0;
  const variance = actualAmount - expectedCash;
  const variancePercentage = expectedCash > 0 ? ((variance / expectedCash) * 100).toFixed(2) : "0.00";

  return (
    <dialog open>
      <article>
        <h2>{copy.closeShiftModal.title}</h2>
        <div style={{ marginBottom: "1rem" }}>
          <p>
            <strong>{copy.closeShiftModal.openingCash}:</strong> ${openingCash.toFixed(2)}
          </p>
          <p>
            <strong>{copy.closeShiftModal.expectedCash}:</strong> ${expectedCash.toFixed(2)}
          </p>
          {actualCash && (
            <>
              <p>
                <strong>{copy.closeShiftModal.actualCash}:</strong> ${actualAmount.toFixed(2)}
              </p>
              <p>
                <strong>{copy.closeShiftModal.variance}:</strong> ${variance.toFixed(2)} ({variancePercentage}%)
              </p>
            </>
          )}
        </div>
        <form onSubmit={handleSubmit}>
          <label>
            <span>{copy.closeShiftModal.enterActualCash}</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={actualCash}
              onChange={(e) => setActualCash(e.target.value)}
              placeholder="0.00"
              disabled={pending}
              required
            />
          </label>
          <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
            <button type="button" onClick={onCancel} disabled={pending}>
              {copy.closeShiftModal.cancel}
            </button>
            <button type="submit" disabled={pending || !actualCash} aria-busy={pending}>
              {copy.closeShiftModal.submit}
            </button>
          </div>
        </form>
      </article>
    </dialog>
  );
}
