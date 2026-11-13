import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { BILLING_MANAGE_PERMISSION, BILLING_VIEW_PERMISSION, usePermission } from "../auth/permissions";
import { useOptionalAuth } from "../auth/useAuth";
import { copy } from "../i18n/messages";
import { ApiError, getBillingSubscription, invalidateBillingSubscription, reconcileCheckout, startCheckout, startBillingPortal, cancelSubscription } from "./api";
import type { BillingSubscription } from "./types";
import { PLAN_FEATURE_LABELS, type PlanCode } from "./entitlements";
import { Meter } from "@/components/visual";
import { handleRadioGroupKeyDown } from "@/lib/radiogroup";
import { BILLING_TRIAL_DAYS } from "./trial";
import type { CommercialPlan } from "./types";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { SUPPORT_MAILTO } from "@/lib/support";
import { resolveUserFacingError } from "@/lib/apiError";
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
  destructive: "border-destructive/30 bg-destructive/10 [&_svg]:text-destructive-strong",
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

type ActionState = "idle" | "checkout" | "portal" | "cancel" | "error";
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

const DAY_MS = 86_400_000;

/** Days left in the signup trial, out of the advertised trial length. */
function TrialMeter({ trialEndsAt }: { trialEndsAt: string }) {
  const left = daysUntil(trialEndsAt);
  if (left === null) return null;
  return (
    <Meter
      className="mt-3"
      size="sm"
      label="Días de prueba restantes"
      value={left}
      max={BILLING_TRIAL_DAYS}
      valueLabel={`${left} de ${Math.max(BILLING_TRIAL_DAYS, left)} días`}
      tone={left <= 1 ? "danger" : left <= 3 ? "warning" : "blue"}
      showLabel
    />
  );
}

/** How far the verified billing period has run, from its real start and end. */
function PeriodMeter({ start, end }: { start: string | null; end: string | null }) {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return null;
  const totalDays = Math.max(1, Math.round((endMs - startMs) / DAY_MS));
  const elapsedDays = Math.min(totalDays, Math.max(0, Math.floor((Date.now() - startMs) / DAY_MS)));
  return (
    <Meter
      className="mt-3"
      size="sm"
      label="Avance del periodo actual"
      value={elapsedDays}
      max={totalDays}
      valueLabel={`${elapsedDays} de ${totalDays} días`}
      showLabel
    />
  );
}

/**
 * Plans the server offers, as selectable cards (ARIA radiogroup with roving
 * focus). Names, prices and features come only from `available_plans`.
 */
function PlanCards({ plans, value, onValueChange }: {
  plans: CommercialPlan[];
  value: PlanCode | null;
  onValueChange: (code: PlanCode) => void;
}) {
  const focusable = value ?? plans[0]?.code;
  return (
    <div
      role="radiogroup"
      aria-label="Plan a contratar"
      tabIndex={-1}
      className="grid gap-3 sm:grid-cols-2"
      onKeyDown={(event) => {
        if (!focusable) return;
        handleRadioGroupKeyDown(event, plans.map((plan) => ({ value: plan.code })), focusable, onValueChange);
      }}
    >
      {plans.map((plan) => {
        const checked = plan.code === value;
        const features = plan.features.map((feature) => PLAN_FEATURE_LABELS[feature]).filter(Boolean);
        const featuresId = `plan-features-${plan.code}`;
        return (
          <button
            key={plan.code}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={`${plan.name} · ${formatPlanPrice(plan)}`}
            aria-describedby={features.length ? featuresId : undefined}
            data-radio-value={String(plan.code)}
            tabIndex={plan.code === focusable ? 0 : -1}
            onClick={() => onValueChange(plan.code)}
            className={cn(
              "flex min-h-11 flex-col rounded-kova-lg border-2 bg-white p-4 text-left transition-[border-color,box-shadow] duration-hover ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue/40",
              checked ? "border-kova-blue shadow-kova-card-hover" : "border-kova-border hover:border-kova-blue/40",
            )}
          >
            <span className="flex items-start justify-between gap-3">
              <span className="font-semibold text-kova-ink">{plan.name}</span>
              <span aria-hidden="true" className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2", checked ? "border-kova-blue" : "border-kova-border")}>
                {checked && <span className="h-2 w-2 rounded-full bg-kova-blue" />}
              </span>
            </span>
            <span className="mt-1 text-xl font-bold tracking-tight tabular-nums text-kova-ink">{formatPlanPrice(plan)}</span>
            {features.length > 0 && (
              <span id={featuresId} className="mt-3 block space-y-1.5">
                {features.map((feature) => (
                  <span key={feature} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-kova-blue" aria-hidden="true" />
                    <span>{feature}</span>
                  </span>
                ))}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function accessStatusLabel(billing: BillingSubscription): string {
  if (billing.access.reason === "verification_required") return copy.billingView.verificationPending;
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
  return (billing.access.allowed && billing.access.reason === "complimentary") ||
    billing.subscription?.status === "active" ||
    (billing.subscription?.status === "trialing" && billing.access.allowed);
}

function needsPaymentRecovery(billing: BillingSubscription): boolean {
  return billing.subscription?.status === "past_due" || billing.subscription?.status === "unpaid"
    || billing.access.reason === "verification_required";
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
  const auth = useOptionalAuth();
  const refreshAuth = auth?.refresh;
  const canViewBilling = usePermission(BILLING_VIEW_PERMISSION);
  const canManageBilling = usePermission(BILLING_MANAGE_PERMISSION);
  // Defaults to true so a session shape without the flag (older cached probe)
  // never blocks a paying customer.
  const emailVerified =
    auth?.state.status !== "authenticated" || auth.state.user.email_verified !== false;
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [checkoutConfirmationState, setCheckoutConfirmationState] =
    useState<CheckoutConfirmationState>(checkoutReturnState === "success" ? "confirming" : "idle");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [selectedPlanCode, setSelectedPlanCode] = useState<PlanCode | null>(null);
  const availablePlans = loadState.status === "loaded" ? loadState.billing.available_plans : undefined;
  const tieredPlans = loadState.status === "loaded" && loadState.billing.tiered_pricing_enabled
    ? availablePlans?.filter((plan) => plan.code !== "standard") ?? [] : [];
  const selectedPlan = tieredPlans.find((plan) => plan.code === selectedPlanCode);
  const requiresPlanSelection = tieredPlans.length > 0;
  const checkoutUnavailable = availablePlans !== undefined && availablePlans.length === 0;
  const commercialAccess = loadState.status === "loaded" && loadState.billing.access.plan_code
    ? loadState.billing.access : auth?.state.status === "authenticated" ? auth.state.commercialAccess : undefined;
  const tieredAccount = availablePlans?.some((plan) => plan.code !== "standard")
    || Boolean(commercialAccess?.plan_code && commercialAccess.plan_code !== "standard");
  const includedFeatures = selectedPlan?.features ?? commercialAccess?.features;
  const valueItems = includedFeatures ? includedFeatures.map((feature) => PLAN_FEATURE_LABELS[feature]).filter(Boolean) : copy.billingView.valueItems;
  const trialBody = tieredAccount
    ? "Tu prueba incluye las funciones de Gestión. Elige un plan para continuar cuando termine; no se cobra automáticamente sin una suscripción."
    : copy.billingView.noSubscriptionBanner;
  const expiredTrialBody = tieredAccount ? "La prueba terminó. Elige un plan disponible para recuperar tu operación." : copy.billingView.expiredTrialBanner;
  // Ref (not state) so marking the reconcile as started never re-triggers the
  // effect below and cancels its own in-flight retry loop.
  const reconcileStartedRef = useRef(false);
  const { toast } = useToast();

  const load = useCallback(async (force = false) => {
    if (!canViewBilling) { setLoadState({ status: "error" }); return; }
    setLoadState({ status: "loading" });
    try {
      const billing = await getBillingSubscription(force ? { force: true } : undefined);
      setLoadState({ status: "loaded", billing });
      return billing;
    } catch {
      setLoadState({ status: "error" });
    }
  }, [canViewBilling]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let refreshing = false;
    const onVisible = () => {
      if (document.visibilityState !== "visible" || refreshing || actionState === "checkout" || actionState === "portal" || actionState === "cancel" || cancelDialogOpen
        || (checkoutReturnState === "success" && checkoutConfirmationState === "confirming")) return;
      refreshing = true;
      void load(true).finally(() => { refreshing = false; });
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("focus", onVisible); document.removeEventListener("visibilitychange", onVisible); };
  }, [load, actionState, cancelDialogOpen, checkoutReturnState, checkoutConfirmationState]);

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
            void refreshAuth?.();
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
  }, [shouldReconcile, location.search, refreshAuth]);

  const openBillingPortal = async () => {
    if (!canManageBilling || !emailVerified || loadState.status !== "loaded" || !loadState.billing.portal_available || actionState === "portal") return;
    setActionState("portal");
    try {
      const { portal_url } = await startBillingPortal();
      const destination = new URL(portal_url);
      if (destination.protocol !== "https:" || destination.hostname !== "billing.stripe.com") throw new Error("Portal unavailable");
      window.location.assign(destination.href);
    } catch { setActionState("error"); toast(copy.billingView.operationError, "error"); }
  };

  const beginCheckout = async () => {
    if (checkoutUnavailable || (requiresPlanSelection && !selectedPlan)) return;
    if (loadState.status === "loaded" && hasCheckoutBlockingSubscription(loadState.billing)) {
      toast(copy.billingView.checkoutAlreadyActive, "info");
      return;
    }
    if (loadState.status === "loaded" && needsPaymentRecovery(loadState.billing)) {
      toast(copy.billingView.paymentRecoveryBody, "warning");
      return;
    }
    setActionState("checkout");
    void trackFunnelEvent("checkout_started");
    try {
      const session = await startCheckout(selectedPlan?.code);
      window.location.assign(session.checkout_url);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setActionState("idle");
        toast(resolveUserFacingError(error, copy.billingView.operationError), "warning");
        return;
      }
      if (error instanceof ApiError && error.status === 400) {
        invalidateBillingSubscription();
        const billing = await load();
        if (billing && needsPaymentRecovery(billing)) {
          toast(copy.billingView.paymentRecoveryBody, "warning");
          setActionState("idle");
        } else if (billing && hasCheckoutBlockingSubscription(billing)) {
          toast(copy.billingView.checkoutAlreadyActive, "info");
          setActionState("idle");
        } else {
          toast(copy.billingView.operationError, "error");
          setActionState("error");
        }
        return;
      }
      setActionState("error");
      toast(copy.billingView.operationError, "error");
    }
  };

  useEffect(() => {
    if (loadState.status !== "loaded") return;
    if (loadState.billing.access.reason === "complimentary") return;
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
      void refreshAuth?.();
      setActionState("idle");
      toast(copy.billingView.statusCanceled, "success");
    } catch {
      setActionState("error");
      toast(copy.billingView.operationError, "error");
    }
  };

  if (!canViewBilling) {
    return (
      <ViewLayout width="focused">
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

  if (loadState.status === "loaded" && loadState.billing.access.allowed
      && loadState.billing.access.reason === "complimentary") {
    return (
      <ViewLayout width="focused">
        <ViewHeader title={copy.billingView.title} />
        <Card className="mt-6">
          <CardContent className="space-y-3 p-6">
            <CheckCircle2 className="h-6 w-6 text-kova-growth" aria-hidden="true" />
            <h2 className="text-xl font-semibold">{copy.billingView.complimentaryTitle}</h2>
            <p className="text-muted-foreground">{copy.billingView.complimentaryBody}</p>
            <Badge variant="secondary">{copy.billingView.complimentaryDuration}</Badge>
          </CardContent>
        </Card>
      </ViewLayout>
    );
  }

  return (
    <ViewLayout width="focused" className="animate-fade-in">
      <div className="mb-6">
        <ViewHeader title={copy.billingView.title} meta={copy.billingView.subtitle} />
      </div>

      {auth?.state.status === "authenticated" && auth.state.commercialAccess?.allowed === false && (
        <p className="mb-4 text-sm"><Link className="underline" to="/settings/advanced">Exportar o eliminar los datos de mi negocio</Link></p>
      )}

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

          {loadState.billing.access.allowed && hasCheckoutBlockingSubscription(loadState.billing) && (
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
              body={trialBody}
            />
          )}

          {!loadState.billing.access.allowed && (
            <BillingStatusBanner
              tone="destructive"
              icon={<AlertTriangle />}
              title={copy.billingBanner.blockedTitle}
              body={
                loadState.billing.access.reason === "trial_expired"
                  ? tieredAccount ? "Tu prueba terminó. Elige un plan para seguir vendiendo." : copy.billingBanner.blockedTrialExpired
                  : loadState.billing.access.reason === "verification_required"
                    ? copy.billingView.verificationRequiredBody : copy.billingBanner.blockedGeneric
              }
            />
          )}

          {loadState.billing.subscription?.status === "past_due" && (
            <BillingStatusBanner
              tone="warning"
              icon={<AlertTriangle />}
              body={
                pastDueGraceUrgency(loadState.billing.access.grace_period_ends_at ??
                  loadState.billing.subscription.grace_period_ends_at) ??
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
                  ? expiredTrialBody
                  : trialBody
              }
              bodyClassName="text-foreground"
            />
          )}

          <Card className="overflow-hidden shadow-kova-card">
            <CardContent className="grid gap-6 p-6 md:grid-cols-[minmax(0,1.5fr)_minmax(180px,.75fr)_minmax(180px,.75fr)] md:divide-x md:divide-kova-border">
            <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{copy.billingView.plan}</p>
                  <h2 className="mt-2 text-2xl font-bold tracking-tight text-kova-ink">{commercialAccess?.plan_code === "unknown" ? copy.billingView.verificationPending : loadState.billing.plan.name}</h2>
                  <p className="mt-1 text-3xl font-bold tracking-tight text-kova-ink tabular-nums">
                    {commercialAccess?.plan_code === "unknown" ? "Estamos verificando el plan de este negocio." : formatPlanPrice(loadState.billing.plan)}
                  </p>
            </div>

            {/* Status */}
            <div className="md:pl-6">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{copy.billingView.status}</p>
              <div className="mt-3">
                {loadState.billing.subscription ? (
                  <>
                    <h2 className="mb-2">
                      <Badge variant={loadState.billing.access.reason === "verification_required"
                        ? "destructive" : statusVariants[loadState.billing.subscription.status] ?? "secondary"}>
                        {loadState.billing.access.reason === "verification_required"
                          ? copy.billingView.verificationPending
                          : statusLabels[loadState.billing.subscription.status] ?? loadState.billing.subscription.status}
                      </Badge>
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {loadState.billing.access.reason === "verification_required"
                        ? copy.billingView.verificationSuspended
                        : loadState.billing.subscription.cancel_at_period_end
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
              const graceDate = loadState.billing.access.grace_period_ends_at ??
                subscription?.grace_period_ends_at ?? null;
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
                    {signupTrial && periodDate && <TrialMeter trialEndsAt={periodDate} />}
                    {verifiedPeriod && <p className="text-sm font-medium">{formatDate(periodDate)}</p>}
                    {verifiedPeriod && subscription && <PeriodMeter start={subscription.current_period_start} end={subscription.current_period_end} />}
                    {!signupTrial && !verifiedPeriod && (
                      <p className="text-sm text-muted-foreground">{loadState.billing.access.reason === "verification_required"
                        ? copy.billingView.verificationSuspended : copy.billingView.periodVerifying}</p>
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
              {requiresPlanSelection && !hasCheckoutBlockingSubscription(loadState.billing) && (
                <section className="space-y-4" aria-label="Elegir plan">
                  <h2 className="text-lg font-semibold">Elige el plan para tu negocio</h2>
                  <PlanCards
                    plans={tieredPlans}
                    value={selectedPlan?.code ?? null}
                    onValueChange={setSelectedPlanCode}
                  />
                  {selectedPlan ? <div className="space-y-2 rounded-kova-md border p-4">
                    <p className="font-semibold">{selectedPlan.name} · {formatPlanPrice(selectedPlan)}</p>
                    {selectedPlan.tax_inclusive && <p className="text-sm text-muted-foreground">IVA incluido en la mensualidad.</p>}
                    <p className="text-sm">{selectedPlan.features.includes("advanced_reports")
                      ? "Caja e inventario, más compras, análisis del negocio, lealtad y seguimiento comercial."
                      : "Caja, inventario, turnos, cortes, recibos y resumen de ventas para la operación diaria."}</p>
                    {selectedPlan.limits.branches != null && <p className="text-sm text-muted-foreground">Incluye {selectedPlan.limits.branches} sucursal{selectedPlan.limits.branches === 1 ? "" : "es"}.</p>}
                    {selectedPlan.limits.product_image_bytes !== null && <p className="text-sm text-muted-foreground">Fotos de productos: hasta {selectedPlan.limits.product_image_bytes >= 1_073_741_824 ? `${selectedPlan.limits.product_image_bytes / 1_073_741_824} GiB` : `${selectedPlan.limits.product_image_bytes / 1_000_000} MB`} de archivos originales.</p>}
                    <p className="text-sm text-muted-foreground">Las condiciones y la confirmación del cobro se muestran en Stripe antes de pagar.</p>
                  </div> : <p className="text-sm text-muted-foreground">Selecciona un plan antes de continuar al pago.</p>}
                </section>
              )}
              {checkoutUnavailable && !hasCheckoutBlockingSubscription(loadState.billing) && <p role="status" className="text-sm text-muted-foreground">
                La contratación de tu plan todavía no está disponible. Conservamos el estado actual de tu cuenta.
              </p>}
              <div>
                <p className="text-sm font-semibold">{copy.billingView.valueTitle}</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {valueItems.map((item) => (
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
                  {loadState.billing.portal_available && <Button variant="outline" disabled={actionState === "portal" || !emailVerified} onClick={() => void openBillingPortal()}>
                    <ExternalLink className="h-4 w-4" />{actionState === "portal" ? "Abriendo suscripción…" : "Administrar suscripción"}
                  </Button>}
                  {needsPaymentRecovery(loadState.billing) ? (
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">{loadState.billing.access.reason === "verification_required"
                        ? copy.billingView.verificationRequiredBody : copy.billingView.paymentRecoveryBody}</p>
                      <a className={buttonVariants({ variant: "outline" })} href={SUPPORT_MAILTO}>
                        {copy.billingView.checkoutSupport}
                      </a>
                    </div>
                  ) : !hasCheckoutBlockingSubscription(loadState.billing) ? (
                    <div className="flex flex-col gap-1.5">
                      <Button
                        onClick={() => void beginCheckout()}
                        // Mirrors the server-side gate in `app.billing.router`:
                        // we do not take money from an address nobody confirmed.
                        // Disabling here turns a 403 into an explainable state.
                        disabled={actionState === "checkout" || !emailVerified || commercialAccess?.plan_code === "unknown" || checkoutUnavailable || (requiresPlanSelection && !selectedPlan)}
                      >
                        {actionState === "checkout" ? (
                          <><Loader2 className="h-4 w-4 animate-spin" />{copy.billingView.redirecting}</>
                        ) : (
                          <><ExternalLink className="h-4 w-4" />{commercialAccess?.plan_code === "unknown" ? "Verificar suscripción" : requiresPlanSelection && !selectedPlan ? "Elige un plan para continuar" : copy.billingView.startCheckout(formatPlanPrice(selectedPlan ?? loadState.billing.plan))}</>
                        )}
                      </Button>
                      {!emailVerified && (
                        <p className="text-xs text-muted-foreground">
                          {copy.emailVerification.blockedCheckout}
                        </p>
                      )}
                    </div>
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
