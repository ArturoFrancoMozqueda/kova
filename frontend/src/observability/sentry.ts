import * as Sentry from "@sentry/react";

export const facebookInAppBrowserNoiseFilters = {
  ignoreErrors: [/Error invoking (enableDidUserTypeOnKeyboardLogging|postMessage): Java object is gone/i],
  denyUrls: [/^iabjs:\/\//i, /navigation_performance_logger_android/i],
} satisfies Pick<Sentry.BrowserOptions, "ignoreErrors" | "denyUrls">;

let initialized = false;

export function buildSentryOptions(
  dsn: string,
  environment: string,
): Sentry.BrowserOptions {
  return {
    dsn,
    environment,
    release: __BUILD_HASH__,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    ...facebookInAppBrowserNoiseFilters,
  };
/**
 * Attach the signed-in identity to Sentry events so the ops trace view can
 * find frontend errors by tenant/user. IDs only — never extra PII, and
 * sendDefaultPii stays false. No-ops when Sentry isn't configured.
 */
export function setSentryIdentity(user: { id: string; tenant_id: string }): void {
  if (!initialized) return;
  Sentry.setUser({ id: user.id });
  Sentry.setTag("tenant_id", user.tenant_id);
}

export function clearSentryIdentity(): void {
  if (!initialized) return;
  Sentry.setUser(null);
  Sentry.setTag("tenant_id", undefined);
}

// Consumed by observability/errorReporting.ts (the lazy facade). Keep the
// signature in sync with its `capture` slot.
export function captureException(error: unknown, extra?: Record<string, unknown>): void {
  if (extra) {
    Sentry.captureException(error, { extra });
  } else {
    Sentry.captureException(error);
  }
}

export function initSentry(dsn: string | undefined, environment: string): void {
  if (!dsn) {
    return;
  }

  Sentry.init(buildSentryOptions(dsn, environment));
  initialized = true;
}

initSentry(import.meta.env.VITE_SENTRY_DSN, import.meta.env.MODE);
