import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trackAnonymousEvent, trackAnonymousEventOnce } from "./funnel";

describe("anonymous funnel path", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("posts anonymous events cookieless to the anonymous endpoint", async () => {
    await trackAnonymousEvent("landing_cta_clicked", { cta: "hero" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/telemetry/events/anonymous");
    expect(init.method).toBe("POST");
    // Cookieless → no session leak, and correctly outside the CSRF path.
    expect(init.credentials).toBe("omit");

    const body = JSON.parse(init.body as string);
    expect(body.event_name).toBe("landing_cta_clicked");
    expect(body.client_id).toBeTruthy();
    expect(body.properties.cta).toBe("hero");
    // No PII / tenant identity in the payload.
    expect(body.properties.tenant_id).toBeUndefined();
    expect(body.properties.email).toBeUndefined();
  });

  it("never throws when the network fails (best-effort)", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await expect(
      trackAnonymousEvent("landing_viewed"),
    ).resolves.toBeUndefined();
  });

  it("fires a once-per-load event only once", async () => {
    trackAnonymousEventOnce("landing_viewed", "landing_viewed");
    trackAnonymousEventOnce("landing_viewed", "landing_viewed");
    trackAnonymousEventOnce("landing_viewed", "landing_viewed");
    // Let the queued microtasks settle.
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reuses a stable client_id across events (links pre-auth to signup)", async () => {
    await trackAnonymousEvent("landing_viewed");
    await trackAnonymousEvent("landing_cta_clicked", { cta: "pricing" });
    const first = JSON.parse(fetchMock.mock.calls[0][1].body as string).client_id;
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string).client_id;
    expect(first).toBe(second);
  });
});
