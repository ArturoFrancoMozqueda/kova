import * as Sentry from "@sentry/react";

const dsn = import.meta.env.VITE_SENTRY_DSN;

let initialized = false;

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Tie every event to the deployed build so the internal ops dashboard can
    // correlate frontend errors with a specific release.
    release: __BUILD_HASH__,
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
  initialized = true;
}

/**
 * Attach the signed-in identity to Sentry events so the ops trace view can
 * find frontend errors by tenant/user. IDs only — never extra PII, and
 * sendDefaultPii stays false. No-ops when Sentry isn't configured.
 */
export function setSentryIdentity(user: { id: string; email: string; tenant_id: string }): void {
  if (!initialized) return;
  Sentry.setUser({ id: user.id, email: user.email });
  Sentry.setTag("tenant_id", user.tenant_id);
}

export function clearSentryIdentity(): void {
  if (!initialized) return;
  Sentry.setUser(null);
  Sentry.setTag("tenant_id", undefined);
}
