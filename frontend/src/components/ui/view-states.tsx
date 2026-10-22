import type { ReactNode } from "react";
import { AlertCircle, RefreshCw, ShieldOff } from "lucide-react";
import { Link as RouterLink } from "react-router-dom";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";

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
    <Card className="animate-fade-in">
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
        <h2 className="text-base font-semibold">{title}</h2>
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
    <Card className="animate-fade-in border-kova-blue/20 bg-kova-blue/[0.03]">
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

/**
 * Full-view "you don't have access" panel. Uses the same frame and header as
 * every other view so a denied tab doesn't look like a different product.
 */
export function ViewPermissionDenied({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <ViewLayout width="standard" className="space-y-6">
      <ViewHeader title={title} />
      <Card className="animate-fade-in">
        <CardContent className="flex items-start gap-4 p-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-kova-md bg-kova-mist text-kova-muted">
            <ShieldOff className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        </CardContent>
      </Card>
    </ViewLayout>
  );
}
