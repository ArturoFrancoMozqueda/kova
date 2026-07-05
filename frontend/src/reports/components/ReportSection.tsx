import type { ReactNode } from "react";
import { Info } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
      <CardHeader>
        <div className="flex items-center gap-2">
          {icon}
          <CardTitle>{title}</CardTitle>
        </div>
        {description ? (
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
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
