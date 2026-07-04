import * as Sentry from "@sentry/react";

export const facebookInAppBrowserNoiseFilters = {
  ignoreErrors: [/Error invoking enableDidUserTypeOnKeyboardLogging: Java object is gone/i],
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

export function initSentry(dsn: string | undefined, environment: string): void {
  if (!dsn) {
    return;
  }

  Sentry.init(buildSentryOptions(dsn, environment));
}

initSentry(import.meta.env.VITE_SENTRY_DSN, import.meta.env.MODE);
