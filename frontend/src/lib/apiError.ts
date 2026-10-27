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

// API details are diagnostic input, not presentation-ready copy. Only short,
// ordinary Spanish business guidance may pass through to a product screen.
// Technical identifiers remain available to the operation/support layers.
const technicalMessage = /(?:[{}<>]|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\b|https?:\/\/|\b(?:select\s+.+\s+from|insert\s+into|update\s+.+\s+set|delete\s+from|sql|json|uuid|api|backend|frontend|debug|http|csrf|exception|validationerror|traceback|sqlalchemy|psycopg|constraint|does\s+not\s+exist|permission\s+denied|no\s+rows?\s+(?:found|returned)|stack\s+trace|syntaxerror|typeerror|referenceerror|unexpected\s+token|failed\s+to\s+fetch|networkerror|load\s+failed|internal\s+server\s+error|request\s+failed|access_token|refresh_token|csrf_token|authorization|bearer|localhost|127\.0\.0\.1)\b)/i;
const spanishGuidance = /^(?:no\b|el\b|la\b|los\b|las\b|este\b|esta\b|estos\b|estas\b|ese\b|esa\b|esos\b|esas\b|falta|revisa|selecciona|elige|indica|escribe|agrega|actualiza|ya\b|s[oó]lo\b|debes|tienes|hay\b|se\b|para\b|necesita|ingresa|completa|confirma|todav[ií]a|a[uú]n\b|usa\b|utiliza|cantidad|saldo|existencias|importe|precio|monto|entrega|sin\b|cliente|producto|pedido|venta|turno|lote|archivo|formato|encabezado|csv\b|xlsx\b|sku\b|categor[ií]a|nombre|columna|fecha|c[oó]digo|rfc\b|curp\b|correo|tel[eé]fono|con[eé]ctate|conexi[oó]n|ocurri[oó]|operaci[oó]n|error\s+al\b|sucursal|permiso|acceso|contrase[nñ]a|sesi[oó]n)/i;

export function safeUserMessage(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const message = value.trim();
  if (!message || message.length > 500 || message.split(/\r?\n/).length > 2
    || technicalMessage.test(message) || !spanishGuidance.test(message)) return fallback;
  return message;
}

/** Preserves human validation guidance while keeping diagnostics out of UI. */
export function resolveUserFacingError(err: unknown, fallback: string): string {
  const status = apiErrorStatus(err);
  if (isNetworkError(err) || status === 403 || (status !== null && status >= 500)) {
    return resolveApiErrorMessage(err, fallback);
  }
  const detail = apiErrorDetailText(err);
  return safeUserMessage(detail ?? (err instanceof Error ? err.message : null), fallback);
}
