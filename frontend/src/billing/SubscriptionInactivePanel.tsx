import { Link } from "react-router-dom";
import { Lock } from "lucide-react";

import { copy } from "@/i18n/messages";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Reusable in-view state for a blocked (402) subscription. Shown when a gated
 * section can't load because the plan is inactive, so the user gets a clear
 * "Activar plan" path instead of a generic error + retry that will keep
 * failing. Distinct from the app-wide BillingBanner: this replaces the section
 * content rather than sitting above it.
 */
export function SubscriptionInactivePanel({ className }: { className?: string }) {
  return (
    <Card className={cn("border-warning/30 bg-warning/[0.04]", className)}>
      <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning-strong">
          <Lock className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <p className="text-base font-semibold">{copy.subscriptionInactive.title}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{copy.subscriptionInactive.body}</p>
        </div>
        <Link to="/settings/billing" className={cn(buttonVariants({ size: "sm" }), "sm:shrink-0")}>
          {copy.subscriptionInactive.cta}
        </Link>
      </CardContent>
    </Card>
  );
}
