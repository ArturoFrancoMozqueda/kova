import type { ReactNode } from "react";
import { Info } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";

/** Standard section card: icon + title + one-line purpose, then content.
 * Every analysis block on the page uses this so they scan consistently. */
export function ReportSection({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="p-4 pb-2.5 sm:p-5 sm:pb-3">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-lg font-semibold leading-none tracking-tight">{title}</h2>
        </div>
        {description ? (
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="p-4 pt-0 sm:p-5 sm:pt-0">{children}</CardContent>
    </Card>
  );
}

/** Compact bento cell: question title + the exact one-line answer (highlight),
 * then the visual. No prose descriptions — precision lives in the highlight
 * and the chart's detail-on-demand. `h-full` equalizes heights per grid row. */
export function BentoPanel({
  icon,
  title,
  highlight,
  children,
}: {
  icon?: ReactNode;
  title: string;
  /** "Respuesta primero": the panel's question answered with exact figures. */
  highlight?: string | null;
  children: ReactNode;
}) {
  return (
    <Card className="h-full">
      <CardHeader className="p-4 pb-2.5">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="font-semibold leading-none tracking-tight text-base">{title}</h2>
        </div>
        {highlight ? (
          <p className="text-sm font-semibold leading-6 tabular-nums text-kova-ink">{highlight}</p>
        ) : null}
      </CardHeader>
      <CardContent className="p-4 pt-0">{children}</CardContent>
    </Card>
  );
}

/** Inline muted note used when a secondary dataset failed to load, so a section
 * degrades visibly instead of rendering as silently empty. */
export function PartialFailureNote({ message }: { message: string }) {
  return (
    <p className="flex items-center gap-2 rounded-kova-md border border-dashed border-kova-border bg-kova-mist/40 p-3 text-xs text-kova-muted">
      <Info className="h-3.5 w-3.5 shrink-0" />
      {message}
    </p>
  );
}
