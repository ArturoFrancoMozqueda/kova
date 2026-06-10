import { copy } from "@/i18n/messages";

/**
 * Classifies an error thrown by an API call and returns a human message for
 * the user. Each feature module owns its own `ApiError` class (all expose a
 * numeric `status`), so this helper duck-types on `status` instead of relying
 * on a single `instanceof`.
 *
 * Pass a module-specific `fallback` (e.g. `copy.shiftView.operationError`).
 * Anything that is not clearly a network / permission / server problem keeps
 * that fallback, so behavior only improves for the cases we can name.
 */

export function isNetworkError(err: unknown): boolean {
  // navigator.onLine === false is a definite "offline" signal; fetch rejects
  // with a TypeError when it can't reach the server even if onLine is true.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return err instanceof TypeError;
}

function statusOf(err: unknown): number | null {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status: unknown }).status;
    return typeof status === "number" ? status : null;
  }
  return null;
}

export function resolveApiErrorMessage(err: unknown, fallback: string): string {
  if (isNetworkError(err)) return copy.errors.network;
  const status = statusOf(err);
  if (status === 403) return copy.errors.permission;
  if (status !== null && status >= 500) return copy.errors.server;
  return fallback;
}
