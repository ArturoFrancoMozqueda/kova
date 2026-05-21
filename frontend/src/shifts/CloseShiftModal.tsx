import { type FormEvent, useState } from "react";
import { copy } from "../i18n/messages";
import type { Shift, ShiftClosePayload } from "./types";

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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Lock, TrendingDown, TrendingUp, Minus } from "lucide-react";

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

  const VarianceIcon =
    variance === 0 ? Minus : variance > 0 ? TrendingUp : TrendingDown;

  return (
    <Dialog open onClose={onCancel}>
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            {copy.closeShiftModal.title}
          </DialogTitle>
          <DialogDescription>
            {copy.closeShiftModal.enterActualCash}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {/* Cash summary */}
          <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {copy.closeShiftModal.openingCash}
              </span>
              <span className="text-sm font-semibold tabular-nums">
                ${openingCash.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {copy.closeShiftModal.expectedCash}
              </span>
              <span className="text-sm font-semibold tabular-nums">
                ${expectedCash.toFixed(2)}
              </span>
            </div>
            {actualCash && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {copy.closeShiftModal.actualCash}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    ${actualAmount.toFixed(2)}
                  </span>
                </div>
                <div className="border-t pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium flex items-center gap-1.5">
                      <VarianceIcon
                        className={cn(
                          "h-4 w-4",
                          variance === 0
                            ? "text-kova-growth"
                            : "text-warning",
                        )}
                      />
                      {copy.closeShiftModal.variance}
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "text-sm font-bold tabular-nums",
                          variance === 0
                            ? "text-kova-growth"
                            : "text-warning",
                        )}
                      >
                        ${variance.toFixed(2)}
                      </span>
                      <Badge
                        variant={variance === 0 ? "success" : "warning"}
                      >
                        {variancePercentage}%
                      </Badge>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Input */}
          <div className="space-y-2">
            <Label htmlFor="actual-cash">{copy.closeShiftModal.enterActualCash}</Label>
            <Input
              id="actual-cash"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={actualCash}
              onChange={(e) => setActualCash(e.target.value)}
              placeholder="0.00"
              disabled={pending}
              required
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            {copy.closeShiftModal.cancel}
          </Button>
          <Button type="submit" disabled={pending || !actualCash}>
            {pending ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                {copy.closeShiftModal.submit}
              </span>
            ) : (
              copy.closeShiftModal.submit
            )}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
