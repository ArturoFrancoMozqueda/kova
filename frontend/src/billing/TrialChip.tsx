import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Clock, AlertTriangle } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { copy } from "@/i18n/messages";
import { cn } from "@/lib/utils";
import { getBillingSubscription } from "./api";
import type { BillingSubscription } from "./types";
import { trackFunnelEvent } from "@/telemetry/funnel";

function daysUntil(iso: string): number {
  const target = new Date(iso).getTime();
  const now = Date.now();
  return Math.ceil((target - now) / 86_400_000);
}

export function TrialChip({ className }: { className?: string }) {
  const { state } = useAuth();
  const [billing, setBilling] = useState<BillingSubscription | null>(null);

  const authenticated = state.status === "authenticated";

  useEffect(() => {
    if (!authenticated) {
      setBilling(null);
      return;
    }
    let cancelled = false;
    getBillingSubscription()
      .then((b) => {
        if (!cancelled) setBilling(b);
      })
      .catch(() => {
        if (!cancelled) setBilling(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  if (!billing) return null;
  const access = billing.access;
  if (!access) return null;

  const isTrial =
    access.allowed && (access.reason === "signup_trial" || access.reason === "trialing" || access.trialing);
  if (!isTrial || !access.trial_ends_at) return null;

  const days = daysUntil(access.trial_ends_at);

  let label: string;
  if (days <= 0) label = copy.trialChip.endsToday;
  else if (days === 1) label = copy.trialChip.endsTomorrow;
  else label = copy.trialChip.daysRemaining(days);

  const warm = days <= 3;

  return (
    <Link
      to="/settings/billing"
      onClick={() => void trackFunnelEvent("trial_chip_clicked", { days_remaining: Math.max(days, 0) })}
      title={copy.trialChip.tooltip}
      data-testid="trial-chip"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
        warm
          ? "border-warning/40 bg-warning/10 text-warning-foreground hover:bg-warning/15"
          : "border-kova-blue/30 bg-kova-blue/10 text-kova-blue hover:bg-kova-blue/15",
        className,
      )}
    >
      {warm ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
      <span className="uppercase tracking-[0.08em] opacity-80">{copy.trialChip.label}</span>
      <span className="font-semibold">· {label}</span>
    </Link>
  );
}
