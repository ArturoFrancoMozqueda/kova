import * as Sentry from "@sentry/react";

export const facebookInAppBrowserNoiseFilters = {
  ignoreErrors: [/Error invoking (enableDidUserTypeOnKeyboardLogging|postMessage): Java object is gone/i],
  denyUrls: [/^iabjs:\/\//i, /navigation_performance_logger_android/i],
} satisfies Pick<Sentry.BrowserOptions, "ignoreErrors" | "denyUrls">;

export function buildSentryOptions(
  dsn: string,
  environment: string,
): Sentry.BrowserOptions {
  return {
    dsn,
    environment,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    ...facebookInAppBrowserNoiseFilters,
  };
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
}

initSentry(import.meta.env.VITE_SENTRY_DSN, import.meta.env.MODE);
