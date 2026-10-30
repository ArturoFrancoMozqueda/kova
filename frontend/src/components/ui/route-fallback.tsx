import { useEffect, useState } from "react";
import { Skeleton } from "./skeleton";

/**
 * Full-screen loading fallback for route-level waits: the lazy-route Suspense
 * boundary in `App` and the "resolving session" gap in `RequireAuth`. It exposes
 * no identity, permissions or controls before the session has been verified.
 */
export function RouteFallback({ label = "Cargando" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      className="min-h-screen bg-background p-4 sm:p-8"
    >
      <div aria-hidden="true" className="mx-auto max-w-7xl space-y-8">
        <div className="flex h-14 items-center justify-between border-b border-kova-border pb-4">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-9 w-9 rounded-full" />
        </div>
        <div className="space-y-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-4 w-2/3 max-w-md" /></div>
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map(index => <Skeleton key={index} className="h-28" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
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
  viewName = "Tu espacio de trabajo",
  delayMs = 140,
}: {
  label?: string;
  viewName?: string;
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
    <div role="status" aria-label={label} aria-busy="true" className="mx-auto w-full max-w-7xl animate-fade-in p-4 sm:p-6 lg:p-8">
      {/* Skeleton rather than ad-hoc animate-pulse boxes, so the whole app has
          one loading rhythm (pulse-soft, 1.5s) and one loading surface. */}
      <div className="mb-7 flex items-center justify-between gap-4">
        <div className="space-y-3">
          <Skeleton className="h-3 w-24 rounded-full" />
          <p className="text-3xl font-bold tracking-[-0.035em] text-kova-ink">{viewName}</p>
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
