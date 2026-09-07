import { type FormEvent, useState } from "react";
import { copy } from "../i18n/messages";
import type { CashMovementPayload } from "./types";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ArrowUpCircle, ArrowDownCircle } from "lucide-react";

interface CashMovementModalProps {
  pending: boolean;
  fieldsLocked?: boolean;
  initialType?: "cash_in" | "cash_out";
  onSubmit: (payload: CashMovementPayload) => void;
  onCancel: () => void;
}

export function CashMovementModal({
  pending,
  fieldsLocked = false,
  initialType = "cash_out",
  onSubmit,
  onCancel,
}: CashMovementModalProps) {
  const [type, setType] = useState<"cash_in" | "cash_out">(initialType);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Explain which field blocks the submit instead of only greying the button.
  const amountError = Number(amount) > 0 ? null : copy.cashMovementModal.amountRequired;
  const reasonError = reason.trim() ? null : copy.cashMovementModal.reasonRequired;
  const isValid = !amountError && !reasonError;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!isValid) {
      setSubmitAttempted(true);
      return;
    }
    onSubmit({
      type,
      amount,
      reason,
    });
  };

  return (
    <Dialog open onClose={onCancel}>
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {type === "cash_in" ? (
              <ArrowUpCircle className="h-5 w-5 text-kova-growth" />
            ) : (
              <ArrowDownCircle className="h-5 w-5 text-destructive" />
            )}
            {copy.cashMovementModal.title}
          </DialogTitle>
          <DialogDescription>
            {type === "cash_in"
              ? copy.cashMovementModal.cashIn
              : copy.cashMovementModal.cashOut}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="movement-type">{copy.cashMovementModal.type}</Label>
            <Select
              id="movement-type"
              value={type}
              onChange={(e) =>
                setType(e.target.value as "cash_in" | "cash_out")
              }
              disabled={pending || fieldsLocked}
            >
              <option value="cash_in">{copy.cashMovementModal.cashIn}</option>
              <option value="cash_out">{copy.cashMovementModal.cashOut}</option>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="movement-amount">{copy.cashMovementModal.amount}</Label>
            <Input
              id="movement-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              disabled={pending || fieldsLocked}
              required
              aria-invalid={submitAttempted && amountError ? true : undefined}
              aria-describedby={submitAttempted && amountError ? "movement-amount-error" : undefined}
            />
            {submitAttempted && amountError && (
              <p id="movement-amount-error" role="alert" className="text-xs font-medium text-destructive">
                {amountError}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="movement-reason">{copy.cashMovementModal.reason}</Label>
            <Input
              id="movement-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={copy.cashMovementModal.reasonPlaceholder}
              disabled={pending || fieldsLocked}
              required
              aria-invalid={submitAttempted && reasonError ? true : undefined}
              aria-describedby={submitAttempted && reasonError ? "movement-reason-error" : undefined}
            />
            {submitAttempted && reasonError && (
              <p id="movement-reason-error" role="alert" className="text-xs font-medium text-destructive">
                {reasonError}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            {copy.cashMovementModal.cancel}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                {copy.cashMovementModal.submit}
              </span>
            ) : (
              copy.cashMovementModal.submit
            )}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
