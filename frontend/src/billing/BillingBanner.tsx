import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, Clock, X, XCircle } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { copy } from "@/i18n/messages";
import { MOTION_MS } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { usePresence } from "@/lib/usePresence";
import { getBillingSubscription } from "./api";
import type { BillingAccess } from "./types";

type BannerTone = "info" | "warning" | "danger";

type BannerContent = {
  tone: BannerTone;
  title: string;
  body: string;
};

// Grace-window urgency: surface the days left so the cashier/owner feels the
// deadline. Falls back to the generic copy when the date is missing.
function pastDueGraceBody(graceEndsAt: string | null): string {
  if (!graceEndsAt) return copy.billingBanner.pastDueGraceBody;
  const ms = new Date(graceEndsAt).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return copy.billingBanner.pastDueGraceBody;
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  if (days <= 1) return copy.billingBanner.pastDueGraceBodyLastDay;
  return copy.billingBanner.pastDueGraceBodyWithDays(days);
}

function bannerForAccess(access: BillingAccess): BannerContent | null {
  if (access.allowed) {
    if (access.reason === "signup_trial") {
      return { tone: "info", title: copy.billingBanner.trialActive, body: copy.billingBanner.trialActiveBody };
    }
    if (access.reason === "trialing") {
      return { tone: "info", title: copy.billingBanner.trialingActive, body: copy.billingBanner.trialingActiveBody };
    }
    if (access.reason === "past_due_grace") {
      return {
        tone: "warning",
        title: copy.billingBanner.pastDueGrace,
        body: pastDueGraceBody(access.grace_period_ends_at),
      };
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
              : access.reason === "incomplete_expired"
                ? copy.billingBanner.blockedIncompleteExpired
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

const DISMISS_STORAGE_PREFIX = "kova.billingBanner.dismissed.";

function readDismissed(reason: string): boolean {
  try {
    return sessionStorage.getItem(`${DISMISS_STORAGE_PREFIX}${reason}`) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(reason: string) {
  try {
    sessionStorage.setItem(`${DISMISS_STORAGE_PREFIX}${reason}`, "1");
  } catch {
    /* sessionStorage unavailable — ignore */
  }
}

export function BillingBanner() {
  const { state } = useAuth();
  const location = useLocation();
  const [access, setAccess] = useState<BillingAccess | null>(null);
  const [dismissedReason, setDismissedReason] = useState<string | null>(null);
  const lastBanner = useRef<{ access: BillingAccess; content: BannerContent } | null>(null);

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

  useEffect(() => {
    if (access && readDismissed(access.reason)) {
      setDismissedReason(access.reason);
    } else {
      setDismissedReason(null);
    }
  }, [access]);

  const currentContent = access ? bannerForAccess(access) : null;
  const currentDismissible = currentContent?.tone === "info";
  const shouldShow = Boolean(
    access && currentContent && !(currentDismissible && dismissedReason === access.reason),
  );
  if (shouldShow && access && currentContent) {
    lastBanner.current = { access, content: currentContent };
  }
  const presence = usePresence(shouldShow, MOTION_MS.panelExit);
  const presented = shouldShow && access && currentContent
    ? { access, content: currentContent }
    : lastBanner.current;

  if (!presence.mounted || !presented) return null;
  const displayedAccess = presented.access;
  const content = presented.content;
  const dismissible = content.tone === "info";

  return (
    <div
      role={content.tone === "danger" ? "alert" : "status"}
      data-testid="billing-banner"
      data-billing-reason={displayedAccess.reason}
      {...(presence.exiting
        ? ({ "aria-hidden": true, inert: "" } as HTMLAttributes<HTMLDivElement>)
        : {})}
      className={cn(
        "mx-4 mt-4 flex flex-col gap-2 rounded-[var(--radius-lg)] border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-3",
        toneStyles[content.tone],
        presence.exiting ? "pointer-events-none animate-fade-out" : "animate-fade-in",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">{toneIcon[content.tone]}</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{content.title}</p>
          <p className="hidden text-xs opacity-90 sm:block">{content.body}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
        <Link
          to={displayedAccess.recovery_path || "/settings/billing"}
          className="rounded-[var(--radius-md)] border border-current/30 bg-white/60 px-3 py-1.5 text-xs font-semibold hover:bg-white"
        >
          {copy.billingBanner.manageCta}
        </Link>
        {dismissible ? (
          <button
            type="button"
            aria-label={copy.billingBanner.dismissCta}
            onClick={() => {
              writeDismissed(displayedAccess.reason);
              setDismissedReason(displayedAccess.reason);
            }}
            className="rounded-[var(--radius-md)] p-1.5 text-current/70 hover:bg-white/60 hover:text-current"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
