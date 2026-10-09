import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assignCtaSpecificityExperiment,
  flushFunnelEvents,
  hasFunnelClientId,
  trackAnonymousEvent,
  trackAnonymousEventOnce,
  trackExperimentExposed,
  trackFunnelEvent,
  trackAnalysisActionFeedback,
  trackAnalysisActionState,
  trackAnalysisViewed,
  trackSignupValidationFailed,
} from "./funnel";

function anonymousEventCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    ([url]) => url === "/api/v1/telemetry/events/anonymous",
  );
}

describe("anonymous funnel path", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/v1/telemetry/events/anonymous/session") {
        return Promise.resolve(
          new Response(JSON.stringify({ token: "signed-anonymous-token", expires_in: 900 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response(null, { status: 202 }));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("posts anonymous events cookieless to the anonymous endpoint", async () => {
    await trackAnonymousEvent("landing_cta_clicked", { cta: "hero" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sessionCall = fetchMock.mock.calls[0];
    expect(sessionCall[0]).toBe("/api/v1/telemetry/events/anonymous/session");
    expect(sessionCall[1].credentials).toBe("omit");

    const [[url, init]] = anonymousEventCalls(fetchMock);
    expect(url).toBe("/api/v1/telemetry/events/anonymous");
    expect(init.method).toBe("POST");
    // Cookieless → no session leak, and correctly outside the CSRF path.
    expect(init.credentials).toBe("omit");
    expect(init.headers["X-Kova-Anonymous-Token"]).toBe("signed-anonymous-token");

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

  it("consumes the no-store acknowledgement of an anonymous event", async () => {
    const response = new Response('{"accepted":true}', {
      status: 202, headers: { "Cache-Control": "no-store" },
    });
    const originalFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string) => url === "/api/v1/telemetry/events/anonymous"
      ? Promise.resolve(response) : originalFetch(url));
    await trackAnonymousEvent("landing_viewed");
    expect(response.bodyUsed).toBe(true);
  });

  it("consumes the no-store acknowledgement of an authenticated event", async () => {
    window.history.replaceState({}, "", "/register");
    const response = new Response('{"accepted":true}', {
      status: 202, headers: { "Cache-Control": "private, no-store" },
    });
    fetchMock.mockResolvedValueOnce(response);
    await trackFunnelEvent("register_viewed");
    expect(response.bodyUsed).toBe(true);
  });

  it("sends signup failures with categorical metadata only", async () => {
    await trackSignupValidationFailed("password", "weak_password");

    const body = JSON.parse(anonymousEventCalls(fetchMock)[0][1].body as string);
    expect(body.event_name).toBe("signup_validation_failed");
    expect(body.properties).toMatchObject({
      field: "password",
      reason_code: "weak_password",
    });
    expect(Object.keys(body.properties).sort()).toEqual([
      "campaign",
      "device_class",
      "field",
      "medium",
      "path",
      "reason_code",
      "source",
      "viewport_bucket",
    ]);
  });

  it("fires a once-per-load event only once", async () => {
    trackAnonymousEventOnce("landing_viewed", "landing_viewed");
    trackAnonymousEventOnce("landing_viewed", "landing_viewed");
    trackAnonymousEventOnce("landing_viewed", "landing_viewed");
    await vi.waitFor(() => expect(anonymousEventCalls(fetchMock)).toHaveLength(1));
  });

  it("reuses a stable client_id across events (links pre-auth to signup)", async () => {
    await trackAnonymousEvent("landing_viewed");
    await trackAnonymousEvent("landing_cta_clicked", { cta: "pricing" });
    const eventCalls = anonymousEventCalls(fetchMock);
    const first = JSON.parse(eventCalls[0][1].body as string).client_id;
    const second = JSON.parse(eventCalls[1][1].body as string).client_id;
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

    const eventCalls = anonymousEventCalls(fetchMock);
    const first = JSON.parse(eventCalls[0][1].body as string);
    const second = JSON.parse(eventCalls[1][1].body as string);
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

  it("assigns EXP-01 once to a new mobile visitor and keeps the variant stable", () => {
    expect(hasFunnelClientId()).toBe(false);
    const first = assignCtaSpecificityExperiment(true);
    const second = assignCtaSpecificityExperiment(true);

    expect(first).toMatch(/^(control|treatment)$/);
    expect(second).toBe(first);
    expect(window.localStorage.getItem("kova:funnel-client-id")).toBeTruthy();
    expect(window.localStorage.getItem("kova:experiment:exp_01_cta_specificity")).toBe(first);
  });

  it("records an experiment exposure once per browser session and variant", async () => {
    trackExperimentExposed("exp_01_cta_specificity", "treatment", "hero");
    trackExperimentExposed("exp_01_cta_specificity", "treatment", "hero");
    await vi.waitFor(() => expect(anonymousEventCalls(fetchMock)).toHaveLength(1));
    const body = JSON.parse(anonymousEventCalls(fetchMock)[0][1].body as string);
    expect(body).toMatchObject({
      event_name: "experiment_exposed",
      properties: {
        experiment_id: "exp_01_cta_specificity",
        variant: "treatment",
        cta: "hero",
      },
    });
    expect(
      window.sessionStorage.getItem(
        "kova:experiment-exposed:exp_01_cta_specificity:treatment",
      ),
    ).toBe("1");
  });

  it("preserves first-visit eligibility when landing telemetry creates the id first", async () => {
    const newVisitor = !hasFunnelClientId();
    await trackAnonymousEvent("landing_viewed");

    expect(hasFunnelClientId()).toBe(true);
    expect(assignCtaSpecificityExperiment(true, newVisitor)).toMatch(/^(control|treatment)$/);
  });

  it("excludes returning, desktop, and authenticated visitors from EXP-01", () => {
    window.localStorage.setItem("kova:funnel-client-id", "returning-client");
    expect(assignCtaSpecificityExperiment(true)).toBeNull();

    window.localStorage.clear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    expect(assignCtaSpecificityExperiment(true)).toBeNull();

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    expect(assignCtaSpecificityExperiment(false)).toBeNull();
  });

  it("drops PII and monetary properties from authenticated events", async () => {
    await trackFunnelEvent("first_sale_completed", {
      email: "owner@example.com",
      tenant_id: "tenant-secret",
      product_id: "product-secret",
      total_amount: "299.00",
      section: "register",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.properties.client_id).toBeTruthy();
    expect(body.properties.section).toBe("register");
    expect(body.properties.email).toBeUndefined();
    expect(body.properties.tenant_id).toBeUndefined();
    expect(body.properties.product_id).toBeUndefined();
    expect(body.properties.total_amount).toBeUndefined();
  });

  it("sends analysis adoption events with categorical metadata only", async () => {
    await trackAnalysisViewed({
      range_days: 7,
      preset: "seven_days",
      has_previous_period: true,
      recommendation_count: 3,
    });
    await trackAnalysisActionState(true, {
      template_id: "R2",
      decision_area: "inventario",
      priority: "alta",
      surface: "prioridad",
    });
    await trackAnalysisActionFeedback("helpful", {
      template_id: "R2",
      decision_area: "inventario",
      priority: "alta",
      surface: "prioridad",
    });

    const view = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const action = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    const feedback = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(view).toMatchObject({
      event_name: "analysis_viewed",
      properties: {
        range_days: 7,
        preset: "seven_days",
        has_previous_period: true,
        recommendation_count: 3,
      },
    });
    expect(action).toMatchObject({
      event_name: "analysis_action_completed",
      properties: {
        template_id: "R2",
        decision_area: "inventario",
        priority: "alta",
        surface: "prioridad",
      },
    });
    expect(feedback).toMatchObject({
      event_name: "analysis_action_feedback",
      properties: {
        template_id: "R2",
        decision_area: "inventario",
        priority: "alta",
        surface: "prioridad",
        helpfulness: "helpful",
      },
    });
  });

  it("retries transient failures but drops permanently invalid events", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await trackFunnelEvent("analysis_viewed", {
      range_days: 7,
      preset: "seven_days",
      has_previous_period: true,
      recommendation_count: 1,
    });
    expect(JSON.parse(window.localStorage.getItem("kova:funnel-events") ?? "[]")).toHaveLength(1);

    window.localStorage.removeItem("kova:funnel-events");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 422 }));
    await trackFunnelEvent("analysis_viewed", { unsupported: "value" });
    expect(JSON.parse(window.localStorage.getItem("kova:funnel-events") ?? "[]")).toHaveLength(0);
  });

  it("scrubs forbidden identifiers from previously queued events before retry", async () => {
    window.localStorage.setItem(
      "kova:funnel-events",
      JSON.stringify([
        {
          event_name: "first_product_created",
          client_event_id: "legacy-product-event",
          properties: { product_id: "secret-product", path: "/catalog" },
        },
      ]),
    );
    await flushFunnelEvents();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.properties.product_id).toBeUndefined();
    expect(window.localStorage.getItem("kova:funnel-events")).toBe("[]");
  });
});
