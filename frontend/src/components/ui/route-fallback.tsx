import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Skeleton } from "./skeleton";

/**
 * Full-screen loading fallback for route-level waits: the lazy-route Suspense
 * boundary in `App` and the "resolving session" gap in `RequireAuth`. Both used
 * to render a blank screen on every navigation; a centered, muted spinner reads
 * as intentional loading without committing to any destination's layout.
 */
export function RouteFallback({ label = "Cargando" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="flex min-h-screen items-center justify-center bg-background"
    >
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

/**
 * Route fallback used inside AppShell, so navigation chrome never vanishes.
 * A short reveal delay avoids flashing a loading skeleton when a cached lazy
 * chunk resolves almost immediately. Slow routes still get an honest status.
 */
export function ShellRouteFallback({
  label = "Cargando vista",
  delayMs = 140,
}: {
  label?: string;
  delayMs?: number;
}) {
  const [visible, setVisible] = useState(delayMs <= 0);

  useEffect(() => {
    if (delayMs <= 0) {
      setVisible(true);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  if (!visible) return null;

  return (
    <div role="status" aria-label={label} className="mx-auto w-full max-w-7xl animate-fade-in p-4 sm:p-6 lg:p-8">
      {/* Skeleton rather than ad-hoc animate-pulse boxes, so the whole app has
          one loading rhythm (pulse-soft, 1.5s) and one loading surface. */}
      <div className="mb-7 flex items-center justify-between gap-4">
        <div className="space-y-3">
          <Skeleton className="h-3 w-24 rounded-full" />
          <Skeleton className="h-8 w-52 rounded-lg" />
        </div>
        <Skeleton className="h-10 w-28" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-32 rounded-kova-lg border border-kova-border" />
        ))}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
