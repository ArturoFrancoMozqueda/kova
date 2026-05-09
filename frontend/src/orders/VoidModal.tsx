import { useState } from "react";
import { copy } from "../i18n/messages";

type VoidModalProps = {
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => Promise<void>;
};

const voidReasons = ["operator_error", "wrong_product", "system_issue", "other"];

export function VoidModal({ disabled, onCancel, onSubmit }: VoidModalProps) {
  const [reason, setReason] = useState(voidReasons[0]);
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="void-title">
      <h2 id="void-title">{copy.voidModal.title}</h2>
      <label>
        {copy.voidModal.reason}
        <select value={reason} onChange={(event) => setReason(event.target.value)}>
          {voidReasons.map((option) => (
            <option key={option} value={option}>
              {option.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        {copy.voidModal.confirmation}
      </label>
      <button type="button" onClick={onCancel}>
        {copy.voidModal.cancel}
      </button>
      <button
        type="button"
        disabled={!confirmed || disabled}
        onClick={() => onSubmit(reason)}
      >
        {copy.voidModal.submit}
      </button>
    </div>
  );
}
