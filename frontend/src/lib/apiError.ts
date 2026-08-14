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

/** HTTP status of an API error (every module's `ApiError` exposes `status`),
 * or null for network/non-HTTP errors. Lets callers branch on 404/409/etc. */
export function apiErrorStatus(err: unknown): number | null {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status: unknown }).status;
    return typeof status === "number" ? status : null;
  }
  return null;
}

/**
 * Typed accessor for the backend's structured `detail` payload. `ApiError`
 * carries the raw response body as its `message`; this safely parses it and
 * returns `detail` when it's an object (e.g. `{ code, available }`), or null.
 * Replaces ad-hoc `JSON.parse(err.message)` at call sites.
 */
export function apiErrorDetail(err: unknown): Record<string, unknown> | null {
  if (!err || typeof err !== "object" || !("message" in err)) return null;
  const message = (err as { message: unknown }).message;
  if (typeof message !== "string") return null;
  try {
    const body = JSON.parse(message) as { detail?: unknown };
    const detail = body?.detail;
    return detail && typeof detail === "object" ? (detail as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Returns a user-facing string detail from FastAPI without exposing the rest
 * of the response body. Useful for validation endpoints whose actionable
 * feedback lives in `detail` rather than in a field map. */
export function apiErrorDetailText(err: unknown): string | null {
  if (!err || typeof err !== "object" || !("message" in err)) return null;
  const message = (err as { message: unknown }).message;
  if (typeof message !== "string") return null;
  try {
    const body = JSON.parse(message) as { detail?: unknown };
    return typeof body?.detail === "string" ? body.detail : null;
  } catch {
    return null;
  }
}

export function resolveApiErrorMessage(err: unknown, fallback: string): string {
  if (isNetworkError(err)) return copy.errors.network;
  const status = apiErrorStatus(err);
  if (status === 403) return copy.errors.permission;
  if (status !== null && status >= 500) return copy.errors.server;
  return fallback;
}
