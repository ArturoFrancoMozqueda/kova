import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, Clock, XCircle } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { copy } from "@/i18n/messages";
import { cn } from "@/lib/utils";
import { getBillingSubscription } from "./api";
import type { BillingAccess } from "./types";

type BannerTone = "info" | "warning" | "danger";

type BannerContent = {
  tone: BannerTone;
  title: string;
  body: string;
};

function bannerForAccess(access: BillingAccess): BannerContent | null {
  if (access.allowed) {
    if (access.reason === "signup_trial") {
      return { tone: "info", title: copy.billingBanner.trialActive, body: copy.billingBanner.trialActiveBody };
    }
    if (access.reason === "trialing") {
      return { tone: "info", title: copy.billingBanner.trialingActive, body: copy.billingBanner.trialingActiveBody };
    }
    if (access.reason === "past_due_grace") {
      return { tone: "warning", title: copy.billingBanner.pastDueGrace, body: copy.billingBanner.pastDueGraceBody };
    }
    return null;
  }

  const blockedBody =
    access.reason === "trial_expired"
      ? copy.billingBanner.blockedTrialExpired
      : access.reason === "past_due_grace_expired" || access.reason === "past_due"
        ? copy.billingBanner.blockedPastDueExpired
        : access.reason === "canceled"
          ? copy.billingBanner.blockedCanceled
          : access.reason === "unpaid"
            ? copy.billingBanner.blockedUnpaid
            : access.reason === "incomplete"
              ? copy.billingBanner.blockedIncomplete
              : copy.billingBanner.blockedGeneric;

  return { tone: "danger", title: copy.billingBanner.blockedTitle, body: blockedBody };
}

const toneStyles: Record<BannerTone, string> = {
  info: "border-[color:var(--kova-border)] bg-[color:var(--kova-mist)] text-[color:var(--kova-ink)]",
  warning: "border-warning/40 bg-warning/10 text-warning-foreground",
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
};

const toneIcon: Record<BannerTone, React.ReactNode> = {
  info: <Clock className="h-4 w-4" />,
  warning: <AlertTriangle className="h-4 w-4" />,
  danger: <XCircle className="h-4 w-4" />,
};

export function BillingBanner() {
  const { state } = useAuth();
  const location = useLocation();
  const [access, setAccess] = useState<BillingAccess | null>(null);

  const isAuthenticated = state.status === "authenticated";
  const onBillingRoute = location.pathname.startsWith("/settings/billing");

  useEffect(() => {
    if (!isAuthenticated || onBillingRoute) {
      setAccess(null);
      return;
    }
    let cancelled = false;
    getBillingSubscription()
      .then((billing) => {
        if (!cancelled) setAccess(billing.access);
      })
      .catch(() => {
        if (!cancelled) setAccess(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, onBillingRoute, location.pathname]);

  if (!access) return null;
  const content = bannerForAccess(access);
  if (!content) return null;

  return (
    <div
      role={content.tone === "danger" ? "alert" : "status"}
      data-testid="billing-banner"
      data-billing-reason={access.reason}
      className={cn(
        "mx-4 mt-4 flex flex-col gap-3 rounded-[var(--radius-lg)] border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        toneStyles[content.tone],
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">{toneIcon[content.tone]}</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{content.title}</p>
          <p className="text-xs opacity-90">{content.body}</p>
        </div>
      </div>
      <Link
        to={access.recovery_path || "/settings/billing"}
        className="shrink-0 self-start rounded-[var(--radius-md)] border border-current/30 bg-white/60 px-3 py-1.5 text-xs font-semibold hover:bg-white sm:self-auto"
      >
        {copy.billingBanner.manageCta}
      </Link>
    </div>
  );
}
