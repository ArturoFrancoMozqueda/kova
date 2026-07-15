import type { ReactNode } from "react";
import { AlertCircle, RefreshCw, ShieldOff } from "lucide-react";
import { Link as RouterLink } from "react-router-dom";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Shared, copy-agnostic states for a data view — error, empty, and permission
 * denied — so every tab (Reportes, Inventario, Órdenes, Turnos…) renders the
 * same anatomy while supplying its own Spanish copy. Loading skeletons stay
 * per-view because their shape mirrors each view's real layout.
 */

/** Error card with a retry action. `message` is announced via role="alert". */
export function ViewError({
  message,
  onRetry,
  retryLabel,
}: {
  message: string;
  onRetry: () => void;
  retryLabel: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <AlertCircle className="mb-3 h-10 w-10 text-destructive" />
        <p className="text-sm font-medium text-destructive" role="alert">
          {message}
        </p>
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {retryLabel}
        </Button>
      </CardContent>
    </Card>
  );
}

type ViewEmptyCta =
  | { label: string; to: string }
  | { label: string; onClick: () => void };

/**
 * Inviting empty state with an icon, headline, body, and up to two CTAs.
 * `bare` skips the own Card/CardContent wrapper for call sites that already
 * render inside another Card (avoids a card-in-card double border/shadow).
 */
export function ViewEmpty({
  icon,
  title,
  body,
  primaryCta,
  secondaryCta,
  bare,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  primaryCta?: ViewEmptyCta;
  secondaryCta?: ViewEmptyCta;
  bare?: boolean;
}) {
  const content = (
    <>
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-kova-blue/10 text-kova-blue">
        {icon}
      </div>
      <div className="flex-1">
        <p className="text-base font-semibold">{title}</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
      </div>
      {primaryCta || secondaryCta ? (
        <div className="flex flex-wrap justify-center gap-2 sm:shrink-0 sm:justify-start">
          {primaryCta ? <CtaButton cta={primaryCta} variant="default" /> : null}
          {secondaryCta ? <CtaButton cta={secondaryCta} variant="outline" /> : null}
        </div>
      ) : null}
    </>
  );

  if (bare) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center sm:flex-row sm:items-center sm:text-left">
        {content}
      </div>
    );
  }

  return (
    <Card className="border-kova-blue/20 bg-kova-blue/[0.03]">
      <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
        {content}
      </CardContent>
    </Card>
  );
}

function CtaButton({ cta, variant }: { cta: ViewEmptyCta; variant: "default" | "outline" }) {
  if ("to" in cta) {
    return (
      <RouterLink to={cta.to} className={buttonVariants({ size: "sm", variant })}>
        {cta.label}
      </RouterLink>
    );
  }
  return (
    <Button variant={variant} size="sm" onClick={cta.onClick}>
      {cta.label}
    </Button>
  );
}

/** Full-view "you don't have access" panel with a title and explanation. */
export function ViewPermissionDenied({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <main className="flex-1 p-6">
      <div className="mb-6 flex items-center gap-3">
        <ShieldOff className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </main>
  );
}
