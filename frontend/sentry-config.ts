/** Public browser ingestion configuration; never accepts a private DSN password. */
export function frontendSentryDefines(env: Record<string, string | undefined>) {
  const publicDsn = env.VITE_SENTRY_PUBLIC_DSN?.trim();
  const key = publicDsn ? "VITE_SENTRY_PUBLIC_DSN" : "VITE_SENTRY_DSN";
  const dsn = publicDsn || env.VITE_SENTRY_DSN?.trim() || "";

  if (dsn) {
    let valid = false;
    try {
      const parsed = new URL(dsn);
      valid = ["https:", "http:"].includes(parsed.protocol)
        && /^\w+$/.test(parsed.username)
        && !parsed.password
        && !!parsed.hostname
        && /\/\d+$/.test(parsed.pathname)
        && !parsed.search
        && !parsed.hash;
    } catch {
      // Report only the setting name; its value must never appear in build logs.
    }
    if (!valid) {
      throw new Error(
        `${key} must be a valid public Sentry DSN. Store browser ingestion configuration as Config, not Secret.`,
      );
    }
  }

  // Both the lazy loader and SDK initialization already consume this expression.
  // One build-time replacement keeps them on the same validated configuration.
  return { "import.meta.env.VITE_SENTRY_DSN": JSON.stringify(dsn) };
}
