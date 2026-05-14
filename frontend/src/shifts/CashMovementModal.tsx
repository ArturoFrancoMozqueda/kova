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
    <Dialog open onClose={onCancel}>
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {type === "cash_in" ? (
              <ArrowUpCircle className="h-5 w-5 text-emerald-600" />
            ) : (
              <ArrowDownCircle className="h-5 w-5 text-red-500" />
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
              disabled={pending}
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
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              disabled={pending}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="movement-reason">{copy.cashMovementModal.reason}</Label>
            <Input
              id="movement-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={copy.cashMovementModal.reasonPlaceholder}
              disabled={pending}
              required
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            {copy.cashMovementModal.cancel}
          </Button>
          <Button type="submit" disabled={pending || !isValid}>
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
