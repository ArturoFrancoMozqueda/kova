import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setUser = vi.fn();
const setTag = vi.fn();
const init = vi.fn();

vi.mock("@sentry/react", () => ({
  init: (...args: unknown[]) => init(...args),
  setUser: (...args: unknown[]) => setUser(...args),
  setTag: (...args: unknown[]) => setTag(...args),
}));

const USER = { id: "u-1", email: "ceo@kova.mx", tenant_id: "t-1" };

describe("sentry identity helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    setUser.mockClear();
    setTag.mockClear();
    init.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("no-ops when Sentry has no DSN configured", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");
    const mod = await import("./sentry");
    mod.setSentryIdentity(USER);
    mod.clearSentryIdentity();
    expect(init).not.toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
    expect(setTag).not.toHaveBeenCalled();
  });

  it("sets identity and tenant tag when initialized", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://key@example.com/1");
    const mod = await import("./sentry");
    expect(init).toHaveBeenCalledOnce();

    mod.setSentryIdentity(USER);
    expect(setUser).toHaveBeenCalledWith({ id: "u-1", email: "ceo@kova.mx" });
    expect(setTag).toHaveBeenCalledWith("tenant_id", "t-1");

    mod.clearSentryIdentity();
    expect(setUser).toHaveBeenLastCalledWith(null);
  });
});
