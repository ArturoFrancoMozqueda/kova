import { describe, expect, it } from "vitest";
import { frontendSentryDefines } from "../../sentry-config";

const dsn = "https://examplePublicKey@o123.ingest.us.sentry.io/456";
const definition = "import.meta.env.VITE_SENTRY_DSN";

describe("frontend Sentry build configuration", () => {
  it("uses explicit public configuration when a legacy secret is masked", () => {
    const result = frontendSentryDefines({
      VITE_SENTRY_PUBLIC_DSN: ` ${dsn}\n`,
      VITE_SENTRY_DSN: "[SENSITIVE]",
    });
    expect(JSON.parse(result[definition])).toBe(dsn);
  });

  it("preserves existing valid browser DSN configuration", () => {
    expect(JSON.parse(frontendSentryDefines({ VITE_SENTRY_DSN: dsn })[definition])).toBe(dsn);
  });

  it("keeps unconfigured development and test builds free of Sentry traffic", () => {
    expect(JSON.parse(frontendSentryDefines({})[definition])).toBe("");
  });

  it("does not fall back to a legacy value when explicit configuration is invalid", () => {
    expect(() => frontendSentryDefines({
      VITE_SENTRY_PUBLIC_DSN: "[SENSITIVE]",
      VITE_SENTRY_DSN: dsn,
    })).toThrow(/VITE_SENTRY_PUBLIC_DSN must be a valid public Sentry DSN/);
  });

  it.each([
    "[SENSITIVE]",
    "not-a-url",
    "https://o123.ingest.us.sentry.io/456",
    "https://public:private-password@o123.ingest.us.sentry.io/456",
    "https://public@o123.ingest.us.sentry.io/not-a-project",
    "https://public@o123.ingest.us.sentry.io/456?token=private-token",
    "https://public@o123.ingest.us.sentry.io/456#fragment",
    "ftp://public@o123.ingest.us.sentry.io/456",
  ])("rejects invalid or private configuration without echoing it: %s", (value) => {
    let error: unknown;
    try {
      frontendSentryDefines({ VITE_SENTRY_DSN: value });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^VITE_SENTRY_DSN must be a valid public Sentry DSN/);
    expect((error as Error).message).not.toContain(value);
  });
});
