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
      className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]"
    >
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
