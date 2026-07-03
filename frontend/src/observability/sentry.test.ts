import * as Sentry from "@sentry/react";
import { describe, expect, it, vi } from "vitest";
import {
  buildSentryOptions,
  facebookInAppBrowserNoiseFilters,
  initSentry,
} from "./sentry";

const sentryInit = vi.mocked(Sentry.init);
const sentrySetUser = vi.mocked(Sentry.setUser);
const sentrySetTag = vi.mocked(Sentry.setTag);

vi.mock("@sentry/react", () => ({
  init: vi.fn(),
  setUser: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
}));

describe("frontend Sentry configuration", () => {
  function matches(patterns: readonly (string | RegExp)[] | undefined, value: string): boolean {
    return patterns?.some((pattern) =>
      pattern instanceof RegExp ? pattern.test(value) : value.includes(pattern),
    ) ?? false;
  }

  it("does not initialize Sentry when no DSN is configured", () => {
    sentryInit.mockClear();

    initSentry(undefined, "production");

    expect(sentryInit).not.toHaveBeenCalled();
  });

  it("initializes Sentry with privacy-safe defaults when a DSN is configured", () => {
    sentryInit.mockClear();

    initSentry("https://public@example.ingest.sentry.io/1", "production");

    expect(sentryInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://public@example.ingest.sentry.io/1",
        environment: "production",
        tracesSampleRate: 0,
        sendDefaultPii: false,
      }),
    );
  });

  it("ignores Facebook Android WebView Java bridge errors", () => {
    const options = buildSentryOptions("https://public@example.ingest.sentry.io/1", "production");

    expect(options.ignoreErrors).toEqual(facebookInAppBrowserNoiseFilters.ignoreErrors);
    expect(
      matches(
        options.ignoreErrors,
        "Error invoking enableDidUserTypeOnKeyboardLogging: Java object is gone",
      ),
    ).toBe(true);
    expect(matches(options.ignoreErrors, "Error invoking postMessage: Java object is gone")).toBe(
      true,
    );
  });

  it("denies injected iabjs Facebook in-app browser scripts", () => {
    const options = buildSentryOptions("https://public@example.ingest.sentry.io/1", "production");

    expect(options.denyUrls).toEqual(facebookInAppBrowserNoiseFilters.denyUrls);
    expect(matches(options.denyUrls, "iabjs://navigation_performance_logger_android")).toBe(true);
  });

  it("attaches opaque user and tenant identifiers after initialization", async () => {
    const { clearSentryIdentity, setSentryIdentity } = await import("./sentry");
    sentryInit.mockClear();
    sentrySetUser.mockClear();
    sentrySetTag.mockClear();
    initSentry("https://public@example.ingest.sentry.io/1", "production");

    setSentryIdentity({ id: "u-1", tenant_id: "t-1" });
    expect(sentrySetUser).toHaveBeenCalledWith({ id: "u-1" });
    expect(sentrySetTag).toHaveBeenCalledWith("tenant_id", "t-1");

    clearSentryIdentity();
    expect(sentrySetUser).toHaveBeenLastCalledWith(null);
    expect(sentrySetTag).toHaveBeenLastCalledWith("tenant_id", undefined);
  });
});
