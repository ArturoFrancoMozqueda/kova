import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { BILLING_MANAGE_PERMISSION, BILLING_VIEW_PERMISSION, usePermission } from "../auth/permissions";
import { copy } from "../i18n/messages";
import { ApiError, getBillingSubscription, invalidateBillingSubscription, reconcileCheckout, startCheckout, cancelSubscription } from "./api";
import type { BillingSubscription } from "./types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { SUPPORT_MAILTO } from "@/lib/support";
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, Loader2, ExternalLink, XCircle } from "lucide-react";
import {
  trackCheckoutStateViewed,
  trackFunnelEvent,
  trackFunnelEventOnce,
  type CheckoutState,
} from "@/telemetry/funnel";

// Un solo shell para las banderas de estado (activa/trial/bloqueada/vencida/
// sin suscripcion) — antes cada una repetia su propio rounded-lg+border+px/py;
// ahora solo cambia el tono. Copy y logica de cuando se muestra cada una
// quedan identicas.
const BANNER_TONES = {
  success: "border-kova-growth/30 bg-kova-growth/10 [&_svg]:text-kova-growth",
  info: "border-kova-blue/20 bg-kova-blue/10 [&_svg]:text-kova-blue",
  warning: "bg-warning/20 border-warning/30 [&_svg]:text-warning-strong",
  destructive: "border-destructive/30 bg-destructive/10 [&_svg]:text-destructive",
} as const;

function BillingStatusBanner({
  tone,
  icon,
  title,
  body,
  bodyClassName,
}: {
  tone: keyof typeof BANNER_TONES;
  icon: ReactNode;
  title?: string;
  body: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-kova-md border px-4 py-3 text-sm animate-fade-in", BANNER_TONES[tone])}>
      <span className="shrink-0 [&_svg]:h-5 [&_svg]:w-5">{icon}</span>
      <div>
        {title ? <p className="font-medium">{title}</p> : null}
        <p className={bodyClassName ?? (title ? "text-muted-foreground" : undefined)}>{body}</p>
      </div>
    </div>
  );
}

// Days-aware grace copy so the owner sees how long they have to fix billing.
// Returns null when no grace date is set (fall back to the static banner).
function pastDueGraceUrgency(graceEndsAt: string | null): string | null {
  if (!graceEndsAt) return null;
  const ms = new Date(graceEndsAt).getTime() - Date.now();
  // Grace already passed (or unparseable) → no urgency copy; the caller falls
  // back to the static "recupera la suscripción" banner.
  if (Number.isNaN(ms) || ms <= 0) return null;
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  if (days <= 1) return copy.billingBanner.pastDueGraceBodyLastDay;
  return copy.billingBanner.pastDueGraceBodyWithDays(days);
}

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; billing: BillingSubscription };

type ActionState = "idle" | "checkout" | "cancel" | "error";
type CheckoutConfirmationState = "idle" | "confirming" | "confirmed" | "delayed";

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

function formatPlanPrice(plan: BillingSubscription["plan"]): string {
  const amount = plan.amount_minor_units / 100;
  const hasFraction = plan.amount_minor_units % 100 !== 0;
  const formattedAmount = new Intl.NumberFormat("es-MX", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  }).format(amount);
  const interval = plan.interval === "month" ? "mes" : plan.interval === "year" ? "año" : plan.interval;
  return `$${formattedAmount} ${plan.currency.toUpperCase()}/${interval}`;
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

function checkoutTelemetryState(
  billing: BillingSubscription,
  returnState: "success" | "cancel" | null,
): CheckoutState {
  if (returnState === "cancel") return "return_cancel";
  if (returnState === "success") {
    return billing.subscription?.status === "active"
      ? "return_success_active"
      : "return_success_pending";
  }
  const status = billing.subscription?.status;
  if (
    status === "trialing" ||
    status === "active" ||
    status === "past_due" ||
    status === "incomplete" ||
    status === "canceled" ||
    status === "unpaid"
  ) {
    return status;
  }
  return billing.access.reason === "signup_trial" ? "trialing" : "available";
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
  const [checkoutConfirmationState, setCheckoutConfirmationState] =
    useState<CheckoutConfirmationState>(checkoutReturnState === "success" ? "confirming" : "idle");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  // Ref (not state) so marking the reconcile as started never re-triggers the
  // effect below and cancels its own in-flight retry loop.
  const reconcileStartedRef = useRef(false);
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
    if (checkoutReturnState === "success") toast(copy.billingView.checkoutConfirmingTitle, "info");
    if (checkoutReturnState === "cancel") toast(copy.billingView.checkoutCanceled, "warning");
  }, [checkoutReturnState, toast]);

  // Self-heal a lost `checkout.session.completed` webhook. On the success page,
  // if the subscription is not yet active, reconcile against the Stripe session
  // (with a short bounded retry) so access converges without a manual refresh.
  // No-op when the webhook already landed (subscription is active). Gating on a
  // derived boolean (rather than the whole loadState) keeps the retry loop's own
  // setLoadState calls from re-running the effect and cancelling itself.
  const shouldReconcile =
    checkoutReturnState === "success" &&
    loadState.status === "loaded" &&
    !hasCheckoutBlockingSubscription(loadState.billing);
  useEffect(() => {
    if (!shouldReconcile || reconcileStartedRef.current) return;
    const sessionId = new URLSearchParams(location.search).get("session_id");
    if (!sessionId) {
      setCheckoutConfirmationState("delayed");
      return;
    }

    reconcileStartedRef.current = true;
    setCheckoutConfirmationState("confirming");
    let cancelled = false;
    void (async () => {
      for (let attempt = 0; attempt < 3 && !cancelled; attempt += 1) {
        try {
          const billing = await reconcileCheckout(sessionId);
          if (cancelled) return;
          setLoadState({ status: "loaded", billing });
          if (hasCheckoutBlockingSubscription(billing)) {
            setCheckoutConfirmationState("confirmed");
            return;
          }
        } catch {
          // Ignore and retry; the webhook may still be in flight.
        }
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 800));
      }
      if (!cancelled) setCheckoutConfirmationState("delayed");
    })();
    return () => { cancelled = true; };
  }, [shouldReconcile, location.search]);

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
    void trackCheckoutStateViewed(
      checkoutTelemetryState(loadState.billing, checkoutReturnState),
    );
    if (loadState.billing.subscription?.status === "active") {
      trackFunnelEventOnce("trial_to_paid", "trial_to_paid");
    }
  }, [checkoutReturnState, loadState]);

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
      <ViewLayout width="focused" className="max-w-4xl">
        <div className="mb-4">
          <ViewHeader title={copy.billingView.title} />
        </div>
        <Card>
          <CardContent className="flex items-center gap-3 p-6">
            <AlertCircle className="h-5 w-5 text-muted-foreground" />
            <p className="text-muted-foreground">{copy.billingView.permissionHidden}</p>
          </CardContent>
        </Card>
      </ViewLayout>
    );
  }

  return (
    <ViewLayout width="standard" className="max-w-6xl animate-fade-in">
      <div className="mb-6">
        <ViewHeader title={copy.billingView.title} meta={copy.billingView.subtitle} />
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
          {checkoutReturnState === "success" &&
            !hasCheckoutBlockingSubscription(loadState.billing) && (
              <BillingStatusBanner
                tone={checkoutConfirmationState === "delayed" ? "warning" : "info"}
                icon={checkoutConfirmationState === "delayed" ? <AlertTriangle /> : <Loader2 className="animate-spin" />}
                title={copy.billingView.checkoutConfirmingTitle}
                body={
                  checkoutConfirmationState === "delayed" ? (
                    <>
                      {copy.billingView.checkoutConfirmationDelayed}{" "}
                      <a className="font-semibold underline" href={SUPPORT_MAILTO}>
                        {copy.billingView.checkoutSupport}
                      </a>
                    </>
                  ) : copy.billingView.checkoutConfirmingBody
                }
                bodyClassName={checkoutConfirmationState === "delayed" ? "text-warning-foreground" : undefined}
              />
            )}

          {hasCheckoutBlockingSubscription(loadState.billing) && (
            <BillingStatusBanner
              tone="success"
              icon={<CheckCircle2 />}
              title={
                loadState.billing.subscription?.status === "trialing"
                  ? copy.billingView.subscriptionTrialingTitle
                  : copy.billingView.subscriptionActiveTitle
              }
              body={
                loadState.billing.subscription?.status === "trialing"
                  ? copy.billingView.subscriptionTrialingBody
                  : copy.billingView.subscriptionActiveBody
              }
            />
          )}

          {loadState.billing.access.reason === "signup_trial" && (
            <BillingStatusBanner
              tone="info"
              icon={<Clock />}
              title={copy.billingView.trialAccess}
              body={copy.billingView.noSubscriptionBanner}
            />
          )}

          {!loadState.billing.access.allowed && (
            <BillingStatusBanner
              tone="destructive"
              icon={<AlertTriangle />}
              title={copy.billingBanner.blockedTitle}
              body={
                loadState.billing.access.reason === "trial_expired"
                  ? copy.billingBanner.blockedTrialExpired
                  : copy.billingBanner.blockedGeneric
              }
            />
          )}

          {loadState.billing.subscription?.status === "past_due" && (
            <BillingStatusBanner
              tone="warning"
              icon={<AlertTriangle />}
              body={
                pastDueGraceUrgency(loadState.billing.subscription.grace_period_ends_at) ??
                copy.billingView.pastDueBanner
              }
              bodyClassName="text-warning-foreground"
            />
          )}

          {!loadState.billing.subscription && loadState.billing.access.reason !== "signup_trial" && (
            <BillingStatusBanner
              tone="info"
              icon={<AlertCircle />}
              body={
                loadState.billing.access.reason === "trial_expired"
                  ? copy.billingView.expiredTrialBanner
                  : copy.billingView.noSubscriptionBanner
              }
              bodyClassName="text-foreground"
            />
          )}

          <Card className="overflow-hidden shadow-kova-card">
            <CardContent className="grid gap-6 p-6 md:grid-cols-[minmax(0,1.5fr)_minmax(180px,.75fr)_minmax(180px,.75fr)] md:divide-x md:divide-kova-border">
            <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{copy.billingView.plan}</p>
                  <h2 className="mt-2 text-2xl font-bold tracking-tight text-kova-ink">{loadState.billing.plan.name}</h2>
                  <p className="mt-1 text-3xl font-bold tracking-tight text-kova-ink tabular-nums">
                    {formatPlanPrice(loadState.billing.plan)}
                  </p>
            </div>

            {/* Status */}
            <div className="md:pl-6">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{copy.billingView.status}</p>
              <div className="mt-3">
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
              </div>
            </div>

            {/* Period */}
            {(() => {
              const signupTrial = loadState.billing.access.reason === "signup_trial";
              const subscription = loadState.billing.subscription;
              const periodDate = signupTrial
                ? loadState.billing.access.trial_ends_at
                : subscription?.current_period_end ?? null;
              const graceDate = subscription?.grace_period_ends_at ?? null;
              const verifiedPeriod =
                !signupTrial && subscription?.period_freshness === "verified" && periodDate;
              if (signupTrial && !periodDate) return null;
              if (!signupTrial && !subscription && !graceDate) return null;
              return (
                <div className="md:pl-6">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">
                      {signupTrial
                        ? copy.billingView.trialEnds
                        : verifiedPeriod
                          ? subscription?.cancel_at_period_end
                            ? copy.billingView.accessUntil
                            : copy.billingView.nextRenewal
                          : copy.billingView.billingPeriod}
                    </p>
                  <div className="mt-3">
                    {signupTrial && periodDate && <p className="text-sm font-medium">{formatDate(periodDate)}</p>}
                    {verifiedPeriod && <p className="text-sm font-medium">{formatDate(periodDate)}</p>}
                    {!signupTrial && !verifiedPeriod && (
                      <p className="text-sm text-muted-foreground">{copy.billingView.periodVerifying}</p>
                    )}
                    {graceDate && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {copy.billingView.graceEnds} {formatDate(graceDate)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}
            </CardContent>
          </Card>

          {/* Actions */}
          <Card>
            <CardContent className="space-y-5 p-5">
              <div>
                <p className="text-sm font-semibold">{copy.billingView.valueTitle}</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {copy.billingView.valueItems.map((item) => (
                    <div key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-kova-blue" />
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
                        <><ExternalLink className="h-4 w-4" />{copy.billingView.startCheckout(formatPlanPrice(loadState.billing.plan))}</>
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
    </ViewLayout>
  );
}
