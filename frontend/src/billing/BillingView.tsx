import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  BILLING_MANAGE_PERMISSION,
  BILLING_VIEW_PERMISSION,
  usePermission,
} from "../auth/permissions";
import { copy } from "../i18n/messages";
import { getBillingSubscription, startCheckout, cancelSubscription } from "./api";
import type { BillingSubscription } from "./types";

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

function formatPlanAmount(amountMinorUnits: number, currency: string): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).format(amountMinorUnits / 100);
}

function formatDate(value: string | null): string {
  if (!value) {
    return copy.billingView.notAvailable;
  }
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function BillingView() {
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

  const load = useCallback(async () => {
    if (!canViewBilling) {
      setLoadState({ status: "error" });
      return;
    }
    setLoadState({ status: "loading" });
    try {
      setLoadState({ status: "loaded", billing: await getBillingSubscription() });
    } catch {
      setLoadState({ status: "error" });
    }
  }, [canViewBilling]);

  useEffect(() => {
    void load();
  }, [load]);

  const beginCheckout = async () => {
    setActionState("checkout");
    try {
      const session = await startCheckout();
      window.location.assign(session.checkout_url);
    } catch {
      setActionState("error");
    }
  };

  const requestCancel = async () => {
    setActionState("cancel");
    try {
      const billing = await cancelSubscription();
      setLoadState({ status: "loaded", billing });
      setActionState("idle");
    } catch {
      setActionState("error");
    }
  };

  if (!canViewBilling) {
    return (
      <main className="page">
        <h1>{copy.billingView.title}</h1>
        <p className="muted">{copy.billingView.permissionHidden}</p>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{copy.app.dashboard}</p>
          <h1>{copy.billingView.title}</h1>
        </div>
      </header>

      {loadState.status === "loading" ? <p aria-busy="true">{copy.billingView.loading}</p> : null}
      {loadState.status === "error" ? (
        <section className="panel">
          <p role="alert">{copy.billingView.loadError}</p>
          <button type="button" onClick={() => void load()}>
            {copy.billingView.retry}
          </button>
        </section>
      ) : null}
      {actionState === "error" ? (
        <p className="status-warn" role="alert">
          {copy.billingView.operationError}
        </p>
      ) : null}
      {checkoutReturnState === "success" ? (
        <p className="notice" role="status">
          {copy.billingView.checkoutSuccess}
        </p>
      ) : null}
      {checkoutReturnState === "cancel" ? (
        <p className="status-warn" role="status">
          {copy.billingView.checkoutCanceled}
        </p>
      ) : null}

      {loadState.status === "loaded" ? (
        <>
          {loadState.billing.subscription?.status === "past_due" ? (
            <section className="panel">
              <p className="status-warn" role="alert">
                {copy.billingView.pastDueBanner}
              </p>
            </section>
          ) : null}

          <section className="data-grid" aria-label={copy.billingView.title}>
            <article className="data-card">
              <p className="muted">{copy.billingView.plan}</p>
              <h2>{loadState.billing.plan.name}</h2>
              <strong>
                {formatPlanAmount(
                  loadState.billing.plan.amount_minor_units,
                  loadState.billing.plan.currency,
                )}
              </strong>
              <p>{copy.billingView.monthly}</p>
            </article>
            <article className="data-card">
              <p className="muted">{copy.billingView.status}</p>
              <h2>
                {loadState.billing.subscription
                  ? statusLabels[loadState.billing.subscription.status] ??
                    loadState.billing.subscription.status
                  : copy.billingView.noSubscription}
              </h2>
              <p>
                {loadState.billing.subscription?.cancel_at_period_end
                  ? copy.billingView.cancelAtPeriodEnd
                  : copy.billingView.currentAccess}
              </p>
            </article>
            <article className="data-card">
              <p className="muted">{copy.billingView.currentPeriodEnd}</p>
              <h2>{formatDate(loadState.billing.subscription?.current_period_end ?? null)}</h2>
              {loadState.billing.subscription?.grace_period_ends_at ? (
                <p>
                  {copy.billingView.graceEnds}{" "}
                  {formatDate(loadState.billing.subscription.grace_period_ends_at)}
                </p>
              ) : null}
            </article>
          </section>

          <section className="panel">
            <div className="button-row">
              <button
                type="button"
                disabled={!canManageBilling || actionState === "checkout"}
                onClick={() => void beginCheckout()}
              >
                {actionState === "checkout"
                  ? copy.billingView.redirecting
                  : copy.billingView.startCheckout}
              </button>
              <button
                type="button"
                disabled={
                  !canManageBilling ||
                  !loadState.billing.subscription ||
                  loadState.billing.subscription.cancel_at_period_end ||
                  loadState.billing.subscription.status === "canceled" ||
                  actionState === "cancel"
                }
                onClick={() => void requestCancel()}
              >
                {actionState === "cancel" ? copy.billingView.canceling : copy.billingView.cancel}
              </button>
            </div>
            {!canManageBilling ? <p className="muted">{copy.billingView.manageHidden}</p> : null}
          </section>
        </>
      ) : null}
    </main>
  );
}
