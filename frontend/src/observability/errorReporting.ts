// Lazy facade over Sentry so error reporting never drags @sentry/react into
// the eager bundle (it adds ~90 KB that every landing visitor would pay).
// Errors raised before the module loads are queued and flushed on load;
// main.tsx also warms the module during browser idle, so in practice the
// window where reports queue is a few seconds at most.

type Extra = Record<string, unknown>;

let capture: ((error: unknown, extra?: Extra) => void) | null = null;
let loading: Promise<void> | null = null;
const queued: Array<[unknown, Extra | undefined]> = [];

function load(): Promise<void> {
  loading ??= import("./sentry")
    .then((mod) => {
      capture = mod.captureException;
      for (const [error, extra] of queued.splice(0)) capture(error, extra);
    })
    .catch(() => {
      // Loading Sentry can itself fail (offline, stale chunk). Reset so a
      // later report retries; reporting must never throw.
      loading = null;
    });
  return loading;
}

export function reportError(error: unknown, extra?: Extra): void {
  if (capture) {
    capture(error, extra);
    return;
  }
  queued.push([error, extra]);
  void load();
}
