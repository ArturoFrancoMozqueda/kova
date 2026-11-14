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
import { LivePreview } from "@/components/ui/live-preview";
import { TicketPaper } from "@/components/ui/ticket";
import type { ReceiptPaperWidth } from "@/lib/receiptPaper";
import { CorteTemplate } from "./CorteTemplate";

interface CloseShiftModalProps {
  shift: Shift;
  /** When present, the modal shows the corte that will be printed. */
  businessName?: string;
  paperWidthMm?: ReceiptPaperWidth;
  pending: boolean;
  onSubmit: (payload: ShiftClosePayload) => void;
  onCancel: () => void;
}

export function CloseShiftModal({ shift, businessName, paperWidthMm = 80, pending, onSubmit, onCancel }: CloseShiftModalProps) {
  const [actualCash, setActualCash] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // Blind count: the cashier records what is in the drawer first; expected
  // cash and the difference are revealed only on the review step.
  const [step, setStep] = useState<"count" | "review">("count");
  const reviewing = step === "review";
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
    if (!reviewing) {
      setStep("review");
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

  // Preview of the corte with the counted cash, using the server's rule
  // (shifts/calculator.py): variance = actual − expected, in centavos.
  const toCents = (value: string | null | undefined) => Math.round(Number(value ?? 0) * 100);
  const previewVarianceCents = toCents(actualCash) - toCents(shift.expected_cash_amount);
  const previewShift: Shift = {
    ...shift,
    actual_cash_amount: actualCash,
    variance_amount: (previewVarianceCents / 100).toFixed(2),
    reconciliation_status: previewVarianceCents === 0 ? "balanced" : previewVarianceCents > 0 ? "overage" : "shortage",
  };

  const VarianceIcon =
    variance === 0 ? Minus : variance > 0 ? TrendingUp : TrendingDown;

  return (
    <Dialog open onClose={onCancel} className={businessName ? "lg:max-w-4xl" : undefined}>
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            {copy.closeShiftModal.title}
          </DialogTitle>
          <DialogDescription>
            {reviewing ? copy.closeShiftModal.reviewStepDescription : copy.closeShiftModal.countStepDescription}
          </DialogDescription>
        </DialogHeader>

        <div className={cn("py-4", businessName && "grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]")}>
        <div className="min-w-0 space-y-4">
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
            {reviewing && <div>
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
            </div>}
            {reviewing && actualCash && (
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
                            ? "text-kova-growth-strong"
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
              readOnly={reviewing}
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
        {businessName && reviewing && (
          <LivePreview
            label="Vista previa del corte de caja"
            title="Vista previa del corte"
            summary={`Corte con ${formatMoney(actualAmount)} contados y una diferencia de ${formatMoney(previewVarianceCents / 100)}.`}
            note={<p>Las horas y montos finales los fija Kova al cerrar el turno.</p>}
          >
            <TicketPaper className="mx-auto" style={{ width: paperWidthMm === 58 ? "218px" : "302px", maxWidth: "100%" }}>
              <CorteTemplate businessName={businessName} shift={previewShift} paperWidthMm={paperWidthMm} />
            </TicketPaper>
          </LivePreview>
        )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            {copy.closeShiftModal.cancel}
          </Button>
          {reviewing && (
            <Button type="button" variant="outline" onClick={() => setStep("count")} disabled={pending}>
              {copy.closeShiftModal.recount}
            </Button>
          )}
          {!reviewing ? (
            <Button type="submit" disabled={pending || closeBlocked}>
              {copy.closeShiftModal.reviewCount}
            </Button>
          ) : <Button type="submit" disabled={pending || closeBlocked}>
            {pending ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                {copy.closeShiftModal.submit}
              </span>
            ) : (
              copy.closeShiftModal.submit
            )}
          </Button>}
        </DialogFooter>
      </form>
    </Dialog>
  );
}
