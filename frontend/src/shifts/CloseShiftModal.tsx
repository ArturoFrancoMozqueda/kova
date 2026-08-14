import { type FormEvent, useState } from "react";
import { copy } from "../i18n/messages";
import { formatMoney } from "../orders/format";
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
import { Lock, TrendingDown, TrendingUp, Minus, AlertTriangle } from "lucide-react";
import { useSyncQueue } from "@/offline/useSyncQueue";

interface CloseShiftModalProps {
  shift: Shift;
  pending: boolean;
  onSubmit: (payload: ShiftClosePayload) => void;
  onCancel: () => void;
}

export function CloseShiftModal({ shift, pending, onSubmit, onCancel }: CloseShiftModalProps) {
  const [actualCash, setActualCash] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const { pendingCount, failedEntries } = useSyncQueue(shift.id);
  // Sales still queued or failed offline aren't on the server yet, so they're
  // not in this shift's expected cash. Warn before closing so the cut isn't
  // silently incomplete. Dead letters are unfinished sales too and need an
  // explicit recovery before the shift can produce a trustworthy close.
  const unsyncedCount = pendingCount + failedEntries.length;
  const closeBlocked = unsyncedCount > 0;

  // Explain that the actual cash count is required to close, instead of only
  // greying the button.
  const cashError = actualCash.trim() === "" ? copy.closeShiftModal.actualCashRequired : null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (cashError || closeBlocked) {
      setSubmitAttempted(true);
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
          {unsyncedCount > 0 && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 p-3"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
              <div>
                <p className="text-sm font-medium text-warning-foreground">
                  {copy.closeShiftModal.pendingSalesTitle}
                </p>
                <p className="mt-0.5 text-xs text-warning-foreground/90">
                  {copy.closeShiftModal.pendingSalesWarning(unsyncedCount)}
                </p>
              </div>
            </div>
          )}

          {/* Cash summary */}
          <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {copy.closeShiftModal.openingCash}
              </span>
              <span className="text-sm font-semibold tabular-nums">
                {formatMoney(openingCash)}
              </span>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {copy.closeShiftModal.expectedCash}
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {formatMoney(expectedCash)}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground/80">
                {copy.closeShiftModal.expectedCashHint}
              </p>
            </div>
            {actualCash && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {copy.closeShiftModal.actualCash}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatMoney(actualAmount)}
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
                            : "text-warning-foreground",
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
                            : "text-warning-foreground",
                        )}
                      >
                        {formatMoney(variance)}
                      </span>
                      <Badge
                        variant={variance === 0 ? "success" : "warning"}
                      >
                        {variancePercentage}%
                      </Badge>
                    </div>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground/80">
                    {copy.closeShiftModal.varianceHint}
                  </p>
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
              aria-invalid={submitAttempted && cashError ? true : undefined}
              aria-describedby={submitAttempted && cashError ? "actual-cash-error" : undefined}
            />
            {submitAttempted && cashError && (
              <p id="actual-cash-error" role="alert" className="text-xs font-medium text-destructive">
                {cashError}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            {copy.closeShiftModal.cancel}
          </Button>
          <Button type="submit" disabled={pending || closeBlocked}>
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
