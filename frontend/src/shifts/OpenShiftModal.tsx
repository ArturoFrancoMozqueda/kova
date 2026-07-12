import { type FormEvent, useState } from "react";
import { copy } from "../i18n/messages";
import type { ShiftOpenPayload } from "./types";

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
import { DollarSign } from "lucide-react";

interface OpenShiftModalProps {
  pending: boolean;
  onSubmit: (payload: ShiftOpenPayload) => void;
  onCancel: () => void;
}

export function OpenShiftModal({ pending, onSubmit, onCancel }: OpenShiftModalProps) {
  const [amount, setAmount] = useState("");

  // Opening cash is optional, but if provided it can't be negative — say so
  // inline rather than silently coercing or relying on the number input alone.
  const amountError = amount.trim() !== "" && Number(amount) < 0 ? copy.openShiftModal.negativeAmount : null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (amountError) return;
    onSubmit({
      opening_cash_amount: amount || undefined,
    });
  };

  return (
    <Dialog open onClose={onCancel}>
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            {copy.openShiftModal.title}
          </DialogTitle>
          <DialogDescription>
            {copy.openShiftModal.optional}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="opening-cash">{copy.openShiftModal.openingCash}</Label>
            <Input
              id="opening-cash"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              disabled={pending}
              aria-invalid={amountError ? true : undefined}
              aria-describedby={amountError ? "opening-cash-error" : undefined}
            />
            {amountError && (
              <p id="opening-cash-error" role="alert" className="text-xs font-medium text-destructive">
                {amountError}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            {copy.openShiftModal.cancel}
          </Button>
          <Button type="submit" disabled={pending || amountError !== null}>
            {pending ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                {copy.openShiftModal.submit}
              </span>
            ) : (
              copy.openShiftModal.submit
            )}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
