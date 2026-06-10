import { useCallback, useEffect, useState } from "react";
import {
  SHIFT_CLOSE_PERMISSION,
  SHIFT_OPEN_PERMISSION,
  usePermission,
} from "../auth/permissions";
import { copy } from "../i18n/messages";
import { formatMoney } from "../orders/format";
import { resolveApiErrorMessage } from "@/lib/apiError";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  closeShift,
  getOpenShift,
  listClosedShifts,
  openShift,
  recordCashMovement,
} from "./api";
import { CashMovementModal } from "./CashMovementModal";
import { CloseShiftModal } from "./CloseShiftModal";
import { OpenShiftModal } from "./OpenShiftModal";
import type { CashMovementPayload, Shift, ShiftClosePayload, ShiftOpenPayload } from "./types";
import {
  formatShiftDateTime,
  isPositiveCashMovement,
  localizeMovementReason,
  localizeMovementType,
  localizeReconciliationStatus,
} from "./format";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  Clock,
  ArrowUpCircle,
  ArrowDownCircle,
  PlayCircle,
  StopCircle,
  Banknote,
  RefreshCw,
  AlertCircle,
} from "lucide-react";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; openShift: Shift | null; closedShifts: Shift[] };

type ActiveModal = null | "open" | "close" | "movement";

export default function ShiftView() {
  useDocumentTitle(copy.documentTitles.shifts);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [operationPending, setOperationPending] = useState(false);
  const canOpen = usePermission(SHIFT_OPEN_PERMISSION);
  const canClose = usePermission(SHIFT_CLOSE_PERMISSION);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
      const openShiftData = await getOpenShift();
      const closedShifts = await listClosedShifts();
      setLoadState({ status: "loaded", openShift: openShiftData, closedShifts });
    } catch {
      setLoadState({ status: "error", message: copy.shiftView.loadError });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitOpenShift = async (payload: ShiftOpenPayload) => {
    setOperationPending(true);
    try {
      await openShift(payload);
      setActiveModal(null);
      toast(copy.shiftView.openSuccess, "success");
      await load();
    } catch (err) {
      toast(resolveApiErrorMessage(err, copy.shiftView.operationError), "error");
    } finally {
      setOperationPending(false);
    }
  };

  const submitCloseShift = async (payload: ShiftClosePayload) => {
    if (loadState.status !== "loaded" || !loadState.openShift) {
      return;
    }
    setOperationPending(true);
    try {
      await closeShift(loadState.openShift.id, payload);
      setActiveModal(null);
      toast(copy.shiftView.closeSuccess, "success");
      await load();
    } catch (err) {
      toast(resolveApiErrorMessage(err, copy.shiftView.operationError), "error");
    } finally {
      setOperationPending(false);
    }
  };

  const submitCashMovement = async (payload: CashMovementPayload) => {
    if (loadState.status !== "loaded" || !loadState.openShift) {
      return;
    }
    setOperationPending(true);
    try {
      await recordCashMovement(loadState.openShift.id, payload);
      setActiveModal(null);
      toast(copy.shiftView.movementSuccess, "success");
      await load();
    } catch (err) {
      toast(resolveApiErrorMessage(err, copy.shiftView.operationError), "error");
    } finally {
      setOperationPending(false);
    }
  };

  // Loading state
  if (loadState.status === "loading") {
    return (
      <main className="flex-1 p-6 space-y-6">
        <div>
          <Skeleton className="h-4 w-24 mb-2" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Card>
          <CardContent className="p-6 space-y-4">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      </main>
    );
  }

  // Error state
  if (loadState.status === "error") {
    return (
      <main className="flex-1 p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="h-10 w-10 text-destructive mb-3" />
            <p className="text-sm text-destructive font-medium" role="alert">
              {loadState.message}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => void load()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {copy.shiftView.retry}
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const { openShift: currentShift, closedShifts } = loadState;

  return (
    <main className="flex-1 p-6 space-y-6">
      {/* Header */}
      <div>
        <p className="text-sm font-medium text-muted-foreground">
          {copy.app.dashboard}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {copy.shiftView.title}
        </h1>
      </div>

      {/* Active shift card */}
      {currentShift ? (
        <Card className="border-primary/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              <CardTitle>{copy.shiftView.activeShift}</CardTitle>
            </div>
            <Badge variant="success">{copy.shiftView.badgeOpen}</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {copy.shiftView.openedAt}
                </p>
                <p className="text-sm font-medium mt-1">
                  {formatShiftDateTime(currentShift.opened_at)}
                </p>
              </div>
              {currentShift.opening_cash_amount && (
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {copy.shiftView.openingCash}
                  </p>
                  <p className="text-sm font-bold mt-1">
                    {formatMoney(currentShift.opening_cash_amount)}
                  </p>
                </div>
              )}
              {(() => {
                // Roll up the open shift's cash flow so the cashier can see at a
                // glance what's expected in the drawer without waiting for the
                // close-shift modal. Opening balance is its own row above; here
                // we only count cash_in / cash_out movements logged during the
                // shift.
                const cashIn = currentShift.movements
                  .filter((m) => m.type === "cash_in")
                  .reduce((sum, m) => sum + parseFloat(m.amount), 0);
                const cashOut = currentShift.movements
                  .filter((m) => m.type === "cash_out")
                  .reduce((sum, m) => sum + parseFloat(m.amount), 0);
                const opening = currentShift.opening_cash_amount
                  ? parseFloat(currentShift.opening_cash_amount)
                  : 0;
                const expected = opening + cashIn - cashOut;
                return (
                  <>
                    <div className="rounded-lg bg-kova-growth/10 p-3">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {copy.shiftView.totalCashIn}
                      </p>
                      <p className="text-sm font-bold mt-1 text-kova-growth">
                        +{formatMoney(cashIn)} / −{formatMoney(cashOut)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-primary/5 p-3">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {copy.shiftView.expectedCashShort}
                      </p>
                      <p className="text-sm font-bold mt-1 text-primary">
                        {formatMoney(expected)}
                      </p>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Movements */}
            <div>
              <h3 className="text-sm font-semibold mb-2">
                {copy.shiftView.movements}
              </h3>
              {currentShift.movements.length > 0 ? (
                <div className="space-y-2">
                  {currentShift.movements.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center gap-3 rounded-lg border p-3"
                    >
                      {isPositiveCashMovement(m.type) ? (
                        <ArrowUpCircle className="h-4 w-4 shrink-0 text-kova-growth" />
                      ) : (
                        <ArrowDownCircle className="h-4 w-4 shrink-0 text-destructive" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-muted-foreground uppercase">
                          {localizeMovementType(m.type)}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {localizeMovementReason(m.reason)}
                        </p>
                      </div>
                      <span className="text-sm font-semibold tabular-nums">
                        {formatMoney(m.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {copy.shiftView.noMovements}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              {canOpen && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveModal("movement")}
                >
                  <Banknote className="mr-2 h-4 w-4" />
                  {copy.shiftView.recordMovement}
                </Button>
              )}
              {canClose && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setActiveModal("close")}
                >
                  <StopCircle className="mr-2 h-4 w-4" />
                  {copy.shiftView.closeShift}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Clock className="h-10 w-10 text-muted-foreground mb-3" />
            <h2 className="text-lg font-semibold mb-1">
              {copy.shiftView.noOpenShift}
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {canOpen
                ? copy.shiftView.noOpenShiftBody
                : copy.shiftView.noOpenShiftAskManager}
            </p>
            {canOpen && (
              <Button
                className="mt-4"
                onClick={() => setActiveModal("open")}
              >
                <PlayCircle className="mr-2 h-4 w-4" />
                {copy.shiftView.openShift}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Closed shifts table */}
      {closedShifts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{copy.shiftView.closedShifts}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-semibold text-muted-foreground">
                      {copy.shiftView.openedAt}
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-muted-foreground">
                      {copy.shiftView.closedAt}
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-muted-foreground">
                      {copy.shiftView.status}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {closedShifts.slice(0, 10).map((shift) => (
                    <tr
                      key={shift.id}
                      className="border-b last:border-0 hover:bg-muted/50 transition-colors"
                    >
                      <td className="py-3 px-4">
                        {formatShiftDateTime(shift.opened_at)}
                      </td>
                      <td className="py-3 px-4">
                        {shift.closed_at ? formatShiftDateTime(shift.closed_at) : "-"}
                      </td>
                      <td className="py-3 px-4">
                        {shift.reconciliation_status ? (
                          <Badge
                            variant={
                              shift.reconciliation_status === "balanced"
                                ? "success"
                                : "warning"
                            }
                          >
                            {localizeReconciliationStatus(shift.reconciliation_status)}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">{copy.shiftView.badgeClosed}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Modals */}
      {activeModal === "open" && (
        <OpenShiftModal
          pending={operationPending}
          onSubmit={submitOpenShift}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === "close" && currentShift && (
        <CloseShiftModal
          shift={currentShift}
          pending={operationPending}
          onSubmit={submitCloseShift}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === "movement" && (
        <CashMovementModal
          pending={operationPending}
          onSubmit={submitCashMovement}
          onCancel={() => setActiveModal(null)}
        />
      )}
    </main>
  );
}
