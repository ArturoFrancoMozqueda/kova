/**
 * CSRF helpers — read the `csrf_token` cookie set by the backend and turn it
 * into request headers for state-changing API calls.
 *
 * The backend's CSRF middleware (`backend/app/middleware/csrf.py`) enforces the
 * double-submit pattern: any cookie-authenticated POST/PUT/PATCH/DELETE must
 * carry an `X-CSRF-Token` header whose value matches the `csrf_token` cookie.
 *
 * Safe methods (GET/HEAD/OPTIONS) and unauthenticated pre-login calls don't
 * need this header.
 */

export const CSRF_HEADER = "X-CSRF-Token";
export const CSRF_COOKIE = "csrf_token";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function readCsrfCookie(): string | null {
  if (typeof document === "undefined" || !document.cookie) return null;
  const prefix = `${CSRF_COOKIE}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}

/**
 * Returns headers to merge into a `fetch` call. Pass the HTTP method so
 * safe methods are short-circuited — callers can pass the headers in
 * unconditionally without sending CSRF headers on GETs.
 */
export function csrfHeaders(method?: string): Record<string, string> {
  const normalized = (method ?? "GET").toUpperCase();
  if (!UNSAFE_METHODS.has(normalized)) return {};
  const token = readCsrfCookie();
  return token ? { [CSRF_HEADER]: token } : {};
}
