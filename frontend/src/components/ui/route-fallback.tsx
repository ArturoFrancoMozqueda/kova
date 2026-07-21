import { Loader2 } from "lucide-react";

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

/** Route fallback used inside AppShell, so navigation chrome never vanishes. */
export function ShellRouteFallback({ label = "Cargando vista" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <div className="mb-7 flex items-center justify-between gap-4">
        <div className="space-y-3">
          <div className="h-3 w-24 animate-pulse rounded-full bg-muted" />
          <div className="h-8 w-52 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="h-10 w-28 animate-pulse rounded-kova-md bg-muted" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-32 animate-pulse rounded-kova-lg border border-kova-border bg-card" />
        ))}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
