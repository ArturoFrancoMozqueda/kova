import { useCallback, useEffect, useState } from "react";
import {
  SHIFT_CLOSE_PERMISSION,
  SHIFT_OPEN_PERMISSION,
  usePermission,
} from "../auth/permissions";
import { useAuth } from "../auth/useAuth";
import { copy } from "../i18n/messages";
import { formatMoney } from "../orders/format";
import { formatTenantName } from "@/lib/formatTenantName";
import { cn } from "@/lib/utils";
import { CorteTemplate } from "./CorteTemplate";
import { resolveApiErrorMessage } from "@/lib/apiError";
import { useBillingBlocked } from "@/billing/useBillingBlocked";
import { trackFunnelEvent } from "@/telemetry/funnel";
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
  openShiftAgeInDays,
} from "./format";

/** A shift open this long has stopped describing a single day of trading, so
 * the corte it will eventually produce cannot be reconciled. Two days rather
 * than one: overnight venues legitimately cross midnight. */
const STALE_SHIFT_DAYS = 2;

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewEmpty } from "@/components/ui/view-states";
import { StatTile } from "@/components/ui/stat-tile";
import { useToast } from "@/components/ui/toast";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TicketPaper } from "@/components/ui/ticket";
import {
  Clock,
  ArrowUpCircle,
  ArrowDownCircle,
  StopCircle,
  Banknote,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  Printer,
  Receipt,
  Wallet,
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
  // The shift selected for printing a corte de caja. Mounted in a print-only
  // node; the effect below fires the print dialog once it's committed, then
  // clears so a later print targets the right shift.
  const [corteShift, setCorteShift] = useState<Shift | null>(null);
  // Turno cuyo corte se muestra en pantalla (dato real de un turno ya
  // cerrado, no se fabrica un corte para el turno en curso).
  const [viewCorteShift, setViewCorteShift] = useState<Shift | null>(null);
  const canOpen = usePermission(SHIFT_OPEN_PERMISSION);
  const canClose = usePermission(SHIFT_CLOSE_PERMISSION);
  const { state } = useAuth();
  const businessName = formatTenantName(
    state.status === "authenticated" ? state.tenantName : "",
  );
  const { toast } = useToast();
  const handleBillingBlocked = useBillingBlocked();

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

  // Once the selected corte is committed to the DOM, print it and clear.
  // window.print() blocks until the dialog resolves, so the node is present
  // for the whole print; clearing after keeps the hidden node from lingering.
  useEffect(() => {
    if (!corteShift) return;
    window.print();
    setCorteShift(null);
  }, [corteShift]);

  const submitOpenShift = async (payload: ShiftOpenPayload) => {
    setOperationPending(true);
    try {
      await openShift(payload);
      // Funnel rung between first product and first sale (fires each open, not
      // once — opening a drawer is a recurring daily action).
      void trackFunnelEvent("open_shift");
      setActiveModal(null);
      toast(copy.shiftView.openSuccess, "success");
      await load();
    } catch (err) {
      if (handleBillingBlocked(err)) return;
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
      void trackFunnelEvent("close_shift");
      setActiveModal(null);
      toast(copy.shiftView.closeSuccess, "success");
      await load();
    } catch (err) {
      if (handleBillingBlocked(err)) return;
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
      if (handleBillingBlocked(err)) return;
      toast(resolveApiErrorMessage(err, copy.shiftView.operationError), "error");
    } finally {
      setOperationPending(false);
    }
  };

  // Loading state
  if (loadState.status === "loading") {
    return (
      <ViewLayout width="wide" className="space-y-6">
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
      </ViewLayout>
    );
  }

  // Error state
  if (loadState.status === "error") {
    return (
      <ViewLayout width="wide">
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
      </ViewLayout>
    );
  }

  const { openShift: currentShift, closedShifts } = loadState;

  return (
    <ViewLayout width="wide" className="space-y-6 animate-fade-in">
      <ViewHeader title={copy.shiftView.title} />

      {/* Active shift card */}
      {currentShift ? (
        <Card className="overflow-hidden border-kova-blue/20">
          <CardHeader className="flex flex-row items-center justify-between border-b border-kova-border bg-kova-blue/[0.045] pb-4">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              <CardTitle>{copy.shiftView.activeShift}</CardTitle>
            </div>
            <Badge variant="success">{copy.shiftView.badgeOpen}</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {(() => {
              // A shift left open for days silently invalidates the corte: the
              // expected-cash figure keeps accumulating sales across what were
              // really several days of trading, so the closing variance stops
              // meaning anything. Nothing surfaced this before — a production
              // tenant was found with a shift open for 19 days.
              const staleDays = openShiftAgeInDays(currentShift.opened_at);
              if (staleDays === null || staleDays < STALE_SHIFT_DAYS) return null;
              return (
                <p
                  role="status"
                  data-testid="stale-shift-notice"
                  className="flex items-start gap-2 rounded-[var(--radius-md)] border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-foreground"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{copy.shiftView.staleShiftNotice(staleDays)}</span>
                </p>
              );
            })()}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label={copy.shiftView.openedAt}
                value={formatShiftDateTime(currentShift.opened_at)}
                icon={<Clock className="h-4 w-4" />}
              />
              {currentShift.opening_cash_amount && (
                <StatTile
                  label={copy.shiftView.openingCash}
                  value={formatMoney(currentShift.opening_cash_amount)}
                  icon={<Wallet className="h-4 w-4" />}
                  className="bg-kova-grad-sky"
                />
              )}
              {(() => {
                // Manual movements are shown separately from the backend's live
                // expected cash, which also includes cash sales for this shift.
                const cashIn = currentShift.movements
                  .filter((m) => m.type === "cash_in")
                  .reduce((sum, m) => sum + parseFloat(m.amount), 0);
                const cashOut = currentShift.movements
                  .filter((m) => m.type === "cash_out")
                  .reduce((sum, m) => sum + parseFloat(m.amount), 0);
                const opening = currentShift.opening_cash_amount
                  ? parseFloat(currentShift.opening_cash_amount)
                  : 0;
                const expected = currentShift.expected_cash_amount
                  ? parseFloat(currentShift.expected_cash_amount)
                  : opening + cashIn - cashOut;
                return (
                  <>
                    <StatTile
                      label={copy.shiftView.totalCashIn}
                      value={
                        <span className="tabular-nums">
                          <span className="text-kova-growth">+{formatMoney(cashIn)}</span>
                          {" / "}
                          <span className="text-destructive">−{formatMoney(cashOut)}</span>
                        </span>
                      }
                      icon={<ArrowUpCircle className="h-4 w-4" />}
                      className="bg-kova-grad-mint"
                    />
                    <StatTile
                      label={copy.shiftView.expectedCashShort}
                      value={formatMoney(expected)}
                      icon={<Banknote className="h-4 w-4" />}
                      className="bg-kova-grad-blue"
                    />
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
                      className="flex items-center gap-3 rounded-kova-md border border-kova-border bg-kova-mist/35 p-3"
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
        <ViewEmpty
          icon={<Clock className="h-6 w-6" />}
          title={copy.shiftView.noOpenShift}
          body={canOpen ? copy.shiftView.noOpenShiftBody : copy.shiftView.noOpenShiftAskManager}
          primaryCta={canOpen ? { label: copy.shiftView.openShift, onClick: () => setActiveModal("open") } : undefined}
        />
      )}

      {/* Closed shifts table */}
      {closedShifts.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>{copy.shiftView.closedShifts}</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Mobile: stacked cards; desktop: table (same dual pattern as
                Órdenes) so the closed-shift list never needs sideways scroll
                on a phone. */}
            <div className="grid gap-3 sm:hidden">
              {closedShifts.slice(0, 10).map((shift) => (
                <div key={shift.id} className="rounded-lg border bg-background p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-2">
                      <div>
                        <p className="text-xs text-muted-foreground">{copy.shiftView.openedAt}</p>
                        <p className="text-sm font-medium">{formatShiftDateTime(shift.opened_at)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{copy.shiftView.closedAt}</p>
                        <p className="text-sm font-medium">
                          {shift.closed_at ? formatShiftDateTime(shift.closed_at) : "-"}
                        </p>
                      </div>
                      <div className="flex gap-4">
                        <div>
                          <p className="text-xs text-muted-foreground">{copy.shiftView.closedShiftsExpected}</p>
                          <p className="text-sm font-medium tabular-nums">
                            {shift.expected_cash_amount != null ? formatMoney(shift.expected_cash_amount) : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{copy.shiftView.closedShiftsVariance}</p>
                          <p
                            className={cn(
                              "text-sm font-medium tabular-nums",
                              shift.variance_amount != null && Number(shift.variance_amount) !== 0 && "text-destructive",
                            )}
                          >
                            {shift.variance_amount != null ? formatMoney(shift.variance_amount) : "—"}
                          </p>
                        </div>
                      </div>
                    </div>
                    {shift.reconciliation_status ? (
                      <Badge
                        variant={shift.reconciliation_status === "balanced" ? "success" : "warning"}
                      >
                        {localizeReconciliationStatus(shift.reconciliation_status)}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">{copy.shiftView.badgeClosed}</Badge>
                    )}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setViewCorteShift(shift)}
                    >
                      <Receipt className="mr-2 h-4 w-4" />
                      {copy.shiftView.viewCorte}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setCorteShift(shift)}
                    >
                      <Printer className="mr-2 h-4 w-4" />
                      {copy.shiftView.printCorte}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-kova-border bg-kova-blue/[0.055]">
                    <th scope="col" className="text-left py-3 px-4 font-semibold text-muted-foreground">
                      {copy.shiftView.openedAt}
                    </th>
                    <th scope="col" className="text-left py-3 px-4 font-semibold text-muted-foreground">
                      {copy.shiftView.closedAt}
                    </th>
                    <th scope="col" className="text-right py-3 px-4 font-semibold text-muted-foreground">
                      {copy.shiftView.closedShiftsExpected}
                    </th>
                    <th scope="col" className="text-right py-3 px-4 font-semibold text-muted-foreground">
                      {copy.shiftView.closedShiftsVariance}
                    </th>
                    <th scope="col" className="text-left py-3 px-4 font-semibold text-muted-foreground">
                      {copy.shiftView.status}
                    </th>
                    <th scope="col" className="py-3 px-4">
                      <span className="sr-only">{copy.shiftView.printCorte}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {closedShifts.slice(0, 10).map((shift) => (
                    <tr
                      key={shift.id}
                      className="border-b border-kova-border/80 transition-colors last:border-0 hover:bg-kova-mist/55"
                    >
                      <td className="py-3 px-4">
                        {formatShiftDateTime(shift.opened_at)}
                      </td>
                      <td className="py-3 px-4">
                        {shift.closed_at ? formatShiftDateTime(shift.closed_at) : "-"}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums">
                        {shift.expected_cash_amount != null ? formatMoney(shift.expected_cash_amount) : "—"}
                      </td>
                      <td
                        className={cn(
                          "py-3 px-4 text-right tabular-nums",
                          shift.variance_amount != null && Number(shift.variance_amount) !== 0 && "text-destructive",
                        )}
                      >
                        {shift.variance_amount != null ? formatMoney(shift.variance_amount) : "—"}
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
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setViewCorteShift(shift)}
                          >
                            <Receipt className="mr-2 h-4 w-4" />
                            {copy.shiftView.viewCorte}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCorteShift(shift)}
                          >
                            <Printer className="mr-2 h-4 w-4" />
                            {copy.shiftView.printCorte}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Print-only corte de caja for the selected closed shift. */}
      {corteShift && (
        <div className="print-only">
          <CorteTemplate
            businessName={businessName}
            shift={corteShift}
            className="print-corte-root"
          />
        </div>
      )}

      {/* Corte en pantalla: solo lectura, dato real del turno ya cerrado. */}
      <Dialog open={viewCorteShift != null} onClose={() => setViewCorteShift(null)}>
        <DialogHeader>
          <DialogTitle>{copy.shiftView.viewCorte}</DialogTitle>
        </DialogHeader>
        {viewCorteShift ? (
          <TicketPaper>
            <CorteTemplate businessName={businessName} shift={viewCorteShift} />
          </TicketPaper>
        ) : null}
      </Dialog>

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
    </ViewLayout>
  );
}
