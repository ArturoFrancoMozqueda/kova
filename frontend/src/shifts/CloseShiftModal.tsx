import { type FormEvent, useState } from "react";
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

  const handleSubmit = (e: FormEvent) => {
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
    <div className="modal">
      <form onSubmit={handleSubmit}>
        <h2>{copy.closeShiftModal.title}</h2>
        <div style={{ marginBottom: "1.5rem", paddingBottom: "1rem", borderBottom: "1px solid #d8d0c2" }}>
          <div style={{ marginBottom: "0.75rem" }}>
            <p className="eyebrow">{copy.closeShiftModal.openingCash}</p>
            <p style={{ margin: "0.25rem 0 0", fontSize: "1.1rem" }}>
              <strong>${openingCash.toFixed(2)}</strong>
            </p>
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <p className="eyebrow">{copy.closeShiftModal.expectedCash}</p>
            <p style={{ margin: "0.25rem 0 0", fontSize: "1.1rem" }}>
              <strong>${expectedCash.toFixed(2)}</strong>
            </p>
          </div>
          {actualCash && (
            <>
              <div style={{ marginBottom: "0.75rem" }}>
                <p className="eyebrow">{copy.closeShiftModal.actualCash}</p>
                <p style={{ margin: "0.25rem 0 0", fontSize: "1.1rem" }}>
                  <strong>${actualAmount.toFixed(2)}</strong>
                </p>
              </div>
              <div className={variance === 0 ? "notice" : "status-warn"} style={{ marginTop: "0.75rem" }}>
                <p className="eyebrow" style={{ margin: 0 }}>{copy.closeShiftModal.variance}</p>
                <p style={{ margin: "0.25rem 0 0", fontSize: "1rem" }}>
                  <strong>${variance.toFixed(2)}</strong> ({variancePercentage}%)
                </p>
              </div>
            </>
          )}
        </div>
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
        <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end", marginTop: "1.5rem" }}>
          <button type="button" onClick={onCancel} disabled={pending}>
            {copy.closeShiftModal.cancel}
          </button>
          <button type="submit" disabled={pending || !actualCash} aria-busy={pending}>
            {copy.closeShiftModal.submit}
          </button>
        </div>
      </form>
    </div>
  );
}
