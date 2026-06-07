import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { BILLING_MANAGE_PERMISSION, BILLING_VIEW_PERMISSION, usePermission } from "../auth/permissions";
import { copy } from "../i18n/messages";
import { ApiError, getBillingSubscription, invalidateBillingSubscription, startCheckout, cancelSubscription } from "./api";
import { STANDARD_PLAN } from "./standardPlan";
import type { BillingSubscription } from "./types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, Loader2, ExternalLink, XCircle } from "lucide-react";
import { trackFunnelEvent, trackFunnelEventOnce } from "@/telemetry/funnel";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; billing: BillingSubscription };

type ActionState = "idle" | "checkout" | "cancel" | "error";

const statusLabels: Record<string, string> = {
  incomplete: copy.billingView.statusIncomplete,
  trialing: copy.billingView.statusTrialing,
  active: copy.billingView.statusActive,
  past_due: copy.billingView.statusPastDue,
  canceled: copy.billingView.statusCanceled,
  unpaid: copy.billingView.statusUnpaid,
};

const statusVariants: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
  active: "success",
  trialing: "secondary",
  past_due: "warning",
  canceled: "destructive",
  unpaid: "destructive",
  incomplete: "warning",
};

function formatPlanAmount(amountMinorUnits: number, currency: string): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(amountMinorUnits / 100);
}

function formatDate(value: string | null): string {
  if (!value) return copy.billingView.notAvailable;
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function daysUntil(value: string | null): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

function accessStatusLabel(billing: BillingSubscription): string {
  if (!billing.access.allowed && billing.access.reason === "trial_expired") {
    return copy.billingView.trialExpired;
  }
  if (billing.access.reason === "signup_trial") return copy.billingView.trialAccess;
  if (billing.subscription) {
    return statusLabels[billing.subscription.status] ?? billing.subscription.status;
  }
  return copy.billingView.noSubscription;
}

function hasCheckoutBlockingSubscription(billing: BillingSubscription): boolean {
  return billing.subscription?.status === "active" || billing.subscription?.status === "trialing";
}

export default function BillingView() {
  useDocumentTitle(copy.documentTitles.billing);
  const location = useLocation();
  const checkoutReturnState = location.pathname.endsWith("/success")
    ? "success"
    : location.pathname.endsWith("/cancel")
      ? "cancel"
      : null;
  const canViewBilling = usePermission(BILLING_VIEW_PERMISSION);
  const canManageBilling = usePermission(BILLING_MANAGE_PERMISSION);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    if (!canViewBilling) { setLoadState({ status: "error" }); return; }
    setLoadState({ status: "loading" });
    try {
      setLoadState({ status: "loaded", billing: await getBillingSubscription() });
    } catch {
      setLoadState({ status: "error" });
    }
  }, [canViewBilling]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (checkoutReturnState === "success") toast(copy.billingView.checkoutSuccess, "success");
    if (checkoutReturnState === "cancel") toast(copy.billingView.checkoutCanceled, "warning");
  }, [checkoutReturnState, toast]);

  const beginCheckout = async () => {
    if (loadState.status === "loaded" && hasCheckoutBlockingSubscription(loadState.billing)) {
      toast(copy.billingView.checkoutAlreadyActive, "info");
      return;
    }
    setActionState("checkout");
    void trackFunnelEvent("checkout_started");
    try {
      const session = await startCheckout();
      window.location.assign(session.checkout_url);
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        invalidateBillingSubscription();
        await load();
        toast(copy.billingView.checkoutAlreadyActive, "info");
        setActionState("idle");
        return;
      }
      setActionState("error");
      toast(copy.billingView.operationError, "error");
    }
  };

  useEffect(() => {
    if (loadState.status !== "loaded") return;
    if (loadState.billing.subscription?.status === "active") {
      trackFunnelEventOnce("trial_to_paid", "trial_to_paid", {
        subscription_id: loadState.billing.subscription.id,
      });
    }
  }, [loadState]);

  const requestCancel = async () => {
    setActionState("cancel");
    try {
      const billing = await cancelSubscription();
      setLoadState({ status: "loaded", billing });
      setActionState("idle");
      toast(copy.billingView.statusCanceled, "success");
    } catch {
      setActionState("error");
      toast(copy.billingView.operationError, "error");
    }
  };

  if (!canViewBilling) {
    return (
      <main className="p-6 lg:p-8 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold tracking-tight mb-4">{copy.billingView.title}</h1>
        <Card>
          <CardContent className="flex items-center gap-3 p-6">
            <AlertCircle className="h-5 w-5 text-muted-foreground" />
            <p className="text-muted-foreground">{copy.billingView.permissionHidden}</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="p-6 lg:p-8 max-w-4xl mx-auto animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{copy.billingView.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.billingView.subtitle}</p>
      </div>

      {loadState.status === "loading" && (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-24" /></CardContent></Card>
          ))}
        </div>
      )}

      {loadState.status === "error" && (
        <Card className="border-destructive/50">
          <CardContent className="flex items-center gap-4 p-6">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="font-medium">{copy.billingView.loadError}</p>
            <Button variant="outline" onClick={() => void load()} className="ml-auto">{copy.billingView.retry}</Button>
          </CardContent>
        </Card>
      )}

      {loadState.status === "loaded" && (
        <div className="space-y-6">
          {hasCheckoutBlockingSubscription(loadState.billing) && (
            <div className="flex items-center gap-3 rounded-lg border border-kova-growth/30 bg-kova-growth/10 px-4 py-3 text-sm animate-fade-in">
              <CheckCircle2 className="h-5 w-5 text-kova-growth shrink-0" />
              <div>
                <p className="font-medium">
                  {loadState.billing.subscription?.status === "trialing"
                    ? copy.billingView.subscriptionTrialingTitle
                    : copy.billingView.subscriptionActiveTitle}
                </p>
                <p className="text-muted-foreground">
                  {loadState.billing.subscription?.status === "trialing"
                    ? copy.billingView.subscriptionTrialingBody
                    : copy.billingView.subscriptionActiveBody}
                </p>
              </div>
            </div>
          )}

          {loadState.billing.access.reason === "signup_trial" && (
            <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/10 px-4 py-3 text-sm animate-fade-in">
              <Clock className="h-5 w-5 text-primary shrink-0" />
              <div>
                <p className="font-medium">{copy.billingView.trialAccess}</p>
                <p className="text-muted-foreground">
                  {copy.billingView.noSubscriptionBanner}
                </p>
              </div>
            </div>
          )}

          {!loadState.billing.access.allowed && (
            <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm animate-fade-in">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
              <div>
                <p className="font-medium">{copy.billingBanner.blockedTitle}</p>
                <p className="text-muted-foreground">
                  {loadState.billing.access.reason === "trial_expired"
                    ? copy.billingBanner.blockedTrialExpired
                    : copy.billingBanner.blockedGeneric}
                </p>
              </div>
            </div>
          )}

          {loadState.billing.subscription?.status === "past_due" && (
            <div className="flex items-center gap-3 rounded-lg bg-warning/20 border border-warning/30 px-4 py-3 text-sm animate-fade-in">
              <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
              <p className="text-warning-foreground">{copy.billingView.pastDueBanner}</p>
            </div>
          )}

          {!loadState.billing.subscription && loadState.billing.access.reason !== "signup_trial" && (
            <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/10 px-4 py-3 text-sm animate-fade-in">
              <AlertCircle className="h-5 w-5 text-primary shrink-0" />
              <p className="text-foreground">
                {loadState.billing.access.reason === "trial_expired"
                  ? copy.billingView.expiredTrialBanner
                  : copy.billingView.noSubscriptionBanner}
              </p>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            {/* Plan */}
            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{copy.billingView.plan}</p>
              </CardHeader>
              <CardContent>
                <h2 className="text-lg font-bold">{STANDARD_PLAN.name}</h2>
                <p className="text-2xl font-bold text-primary mt-1">
                  {formatPlanAmount(loadState.billing.plan.amount_minor_units, loadState.billing.plan.currency)}
                </p>
                <p className="text-xs text-muted-foreground">{copy.billingView.monthly}</p>
              </CardContent>
            </Card>

            {/* Status */}
            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{copy.billingView.status}</p>
              </CardHeader>
              <CardContent>
                {loadState.billing.subscription ? (
                  <>
                    <h2 className="mb-2">
                      <Badge variant={statusVariants[loadState.billing.subscription.status] ?? "secondary"}>
                        {statusLabels[loadState.billing.subscription.status] ?? loadState.billing.subscription.status}
                      </Badge>
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {loadState.billing.subscription.cancel_at_period_end
                        ? copy.billingView.cancelAtPeriodEnd
                        : copy.billingView.currentAccess}
                    </p>
                  </>
                ) : (
                  <>
                    <Badge variant={loadState.billing.access.allowed ? "secondary" : "destructive"}>
                      {accessStatusLabel(loadState.billing)}
                    </Badge>
                    {loadState.billing.access.trial_ends_at && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {copy.billingView.trialDaysLeft(daysUntil(loadState.billing.access.trial_ends_at) ?? 0)}
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Period */}
            {(() => {
              const periodDate =
                loadState.billing.access.reason === "signup_trial"
                  ? loadState.billing.access.trial_ends_at
                  : loadState.billing.subscription?.current_period_end ?? null;
              const graceDate = loadState.billing.subscription?.grace_period_ends_at ?? null;
              if (!periodDate && !graceDate) return null;
              return (
                <Card className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">
                      {loadState.billing.access.reason === "signup_trial"
                        ? copy.billingView.trialEnds
                        : copy.billingView.currentPeriodEnd}
                    </p>
                  </CardHeader>
                  <CardContent>
                    {periodDate && <p className="text-sm font-medium">{formatDate(periodDate)}</p>}
                    {graceDate && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {copy.billingView.graceEnds} {formatDate(graceDate)}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })()}
          </div>

          {/* Actions */}
          <Card>
            <CardContent className="space-y-5 p-5">
              <div>
                <p className="text-sm font-semibold">{copy.billingView.valueTitle}</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {copy.billingView.valueItems.map((item) => (
                    <div key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
              {canManageBilling ? (
                <>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  {!hasCheckoutBlockingSubscription(loadState.billing) ? (
                    <Button onClick={() => void beginCheckout()} disabled={actionState === "checkout"}>
                      {actionState === "checkout" ? (
                        <><Loader2 className="h-4 w-4 animate-spin" />{copy.billingView.redirecting}</>
                      ) : (
                        <><ExternalLink className="h-4 w-4" />{copy.billingView.startCheckout}</>
                      )}
                    </Button>
                  ) : (
                    <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <CheckCircle2 className="h-4 w-4 text-kova-growth" />
                      {copy.billingView.checkoutNotNeeded}
                    </p>
                  )}
                </div>
                <div className="border-t pt-4">
                  <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    {copy.billingView.subscriptionControls}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={
                      !loadState.billing.subscription ||
                      loadState.billing.subscription.cancel_at_period_end ||
                      loadState.billing.subscription.status === "canceled" ||
                      actionState === "cancel"
                    }
                    onClick={() => setCancelDialogOpen(true)}
                  >
                    {actionState === "cancel" ? (
                      <><Loader2 className="h-4 w-4 animate-spin" />{copy.billingView.canceling}</>
                    ) : (
                      <><XCircle className="h-4 w-4" />{copy.billingView.cancel}</>
                    )}
                  </Button>
                </div>
                <Dialog open={cancelDialogOpen} onClose={() => setCancelDialogOpen(false)}>
                  <DialogHeader>
                    <DialogTitle>{copy.billingView.cancelDialogTitle}</DialogTitle>
                    <DialogDescription>{copy.billingView.cancelDialogBody}</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setCancelDialogOpen(false)}
                      disabled={actionState === "cancel"}
                    >
                      {copy.billingView.cancelDialogKeep}
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={actionState === "cancel"}
                      onClick={() => {
                        setCancelDialogOpen(false);
                        void requestCancel();
                      }}
                    >
                      {actionState === "cancel" ? (
                        <><Loader2 className="h-4 w-4 animate-spin" />{copy.billingView.canceling}</>
                      ) : (
                        <>{copy.billingView.cancelDialogConfirm}</>
                      )}
                    </Button>
                  </DialogFooter>
                </Dialog>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{copy.billingView.manageHidden}</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
}
