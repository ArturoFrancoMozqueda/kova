import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trackAnonymousEvent, trackAnonymousEventOnce, trackFunnelEvent } from "./funnel";

describe("anonymous funnel path", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
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
    expect(body.properties.device_class).toBe("mobile");
    expect(body.properties.viewport_bucket).toBe("mobile_390");
    expect(body.properties.source).toBe("direct");
    expect(body.properties.medium).toBe("none");
    expect(body.properties.campaign).toBe("not_set");
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

  it("keeps first-touch attribution without sending the query string", async () => {
    window.history.replaceState(
      {},
      "",
      "/?utm_source=Google&utm_medium=CPC&utm_campaign=Julio%20POS&ignored=secret",
    );
    await trackAnonymousEvent("landing_viewed");
    window.history.replaceState({}, "", "/signup?utm_source=other");
    await trackAnonymousEvent("signup_completed");

    const first = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(first.properties).toMatchObject({
      path: "/",
      source: "google",
      medium: "cpc",
      campaign: "julio-pos",
    });
    expect(second.properties).toMatchObject({
      path: "/signup",
      source: "google",
      medium: "cpc",
      campaign: "julio-pos",
    });
    expect(JSON.stringify(first)).not.toContain("ignored");
  });

  it("drops PII and monetary properties from authenticated events", async () => {
    await trackFunnelEvent("first_sale_completed", {
      email: "owner@example.com",
      tenant_id: "tenant-secret",
      total_amount: "299.00",
      section: "register",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.properties.client_id).toBeTruthy();
    expect(body.properties.section).toBe("register");
    expect(body.properties.email).toBeUndefined();
    expect(body.properties.tenant_id).toBeUndefined();
    expect(body.properties.total_amount).toBeUndefined();
  });
});
