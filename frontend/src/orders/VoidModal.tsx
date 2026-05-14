import { useState } from "react";
import { copy } from "../i18n/messages";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Ban, AlertTriangle } from "lucide-react";

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
    <Dialog open onClose={onCancel}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-destructive">
          <Ban className="h-4 w-4" />
          {copy.voidModal.title}
        </DialogTitle>
        <DialogDescription>This action cannot be undone.</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg bg-destructive/10 border border-destructive/20 p-3">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{copy.voidModal.confirmation}</p>
        </div>

        <div className="space-y-2">
          <Label>{copy.voidModal.reason}</Label>
          <Select value={reason} onChange={(event) => setReason(event.target.value)}>
            {voidReasons.map((option) => (
              <option key={option} value={option}>
                {option.replaceAll("_", " ")}
              </option>
            ))}
          </Select>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="rounded border-input text-destructive focus:ring-destructive"
          />
          <span className="text-sm">{copy.voidModal.confirmation}</span>
        </label>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>{copy.voidModal.cancel}</Button>
        <Button
          variant="destructive"
          disabled={!confirmed || disabled}
          onClick={() => onSubmit(reason)}
        >
          <Ban className="h-4 w-4" />
          {copy.voidModal.submit}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
