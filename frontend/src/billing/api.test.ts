import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getBillingSubscription, invalidateBillingSubscription, setBillingCacheIdentity, startCheckout, startBillingPortal } from "./api";

const identityA = { tenantId: "tenant-a", userId: "user-a", role: "owner" };
const response = (tenantId: string) => new Response(JSON.stringify({ subscription: { tenant_id: tenantId } }), { status: 200 });

describe("subscription cache identity and invalidation", () => {
  beforeEach(() => {
    setBillingCacheIdentity(identityA);
    invalidateBillingSubscription();
  });
  afterEach(() => {
    setBillingCacheIdentity(null);
    vi.unstubAllGlobals();
  });

  it("deduplicates and caches subscription reads within the verified identity", async () => {
    const fetch = vi.fn().mockResolvedValue(response("tenant-a"));
    vi.stubGlobal("fetch", fetch);
    const [first, second] = await Promise.all([getBillingSubscription(), getBillingSubscription()]);
    expect(first).toEqual(second);
    expect(await getBillingSubscription()).toEqual(first);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    { tenantId: "tenant-b", userId: "user-b", role: "owner" },
    { ...identityA, userId: "user-b" },
    { ...identityA, role: "cashier" },
    { ...identityA, commercialPlan: "esencial" },
  ])("does not reuse a cached plan after the tenant, user or role changes: %j", async (identity) => {
    const fetch = vi.fn().mockResolvedValueOnce(response("old")).mockResolvedValueOnce(response("fresh"));
    vi.stubGlobal("fetch", fetch);
    await getBillingSubscription();
    setBillingCacheIdentity(identity);
    expect(await getBillingSubscription()).toEqual({ subscription: { tenant_id: "fresh" } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not cache or deduplicate reads without a verified online identity", async () => {
    setBillingCacheIdentity(null);
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(response("tenant-a")));
    vi.stubGlobal("fetch", fetch);
    await Promise.all([getBillingSubscription(), getBillingSubscription()]);
    await getBillingSubscription();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each(["identity", "same-identity-return", "invalidation"])("rejects a cached plan if %s changes before the caller receives it", async (change) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("tenant-a")));
    await getBillingSubscription();
    const cached = getBillingSubscription();
    const rejected = expect(cached).rejects.toThrow(/cambiaron/);
    if (change === "invalidation") invalidateBillingSubscription();
    else {
      setBillingCacheIdentity({ tenantId: "tenant-b", userId: "user-b" });
      if (change === "same-identity-return") setBillingCacheIdentity(identityA);
    }
    await rejected;
  });

  it.each(["identity", "same-identity-return", "invalidation", "force"])("rejects old in-flight results after %s without deleting the new request", async (change) => {
    let finishOld!: (value: Response) => void;
    let finishNew!: (value: Response) => void;
    const fetch = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishOld = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishNew = resolve; }));
    vi.stubGlobal("fetch", fetch);
    const old = getBillingSubscription();
    const rejected = expect(old).rejects.toThrow(/cambiaron/);
    if (change === "invalidation") invalidateBillingSubscription();
    else if (change !== "force") {
      setBillingCacheIdentity({ tenantId: "tenant-b", userId: "user-b" });
      if (change === "same-identity-return") setBillingCacheIdentity(identityA);
    }
    const fresh = getBillingSubscription({ force: change === "force" });
    finishOld(response("old"));
    await rejected;
    const duplicate = getBillingSubscription();
    expect(fetch).toHaveBeenCalledTimes(2);
    finishNew(response("fresh"));
    expect(await fresh).toEqual({ subscription: { tenant_id: "fresh" } });
    expect(await duplicate).toEqual({ subscription: { tenant_id: "fresh" } });
    expect(await getBillingSubscription()).toEqual({ subscription: { tenant_id: "fresh" } });
  });

  it("fetches fresh plan data when explicitly forced despite a valid cache", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response("old")).mockResolvedValueOnce(response("fresh"));
    vi.stubGlobal("fetch", fetch);
    await getBillingSubscription();
    expect(await getBillingSubscription({ force: true })).toEqual({ subscription: { tenant_id: "fresh" } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});


it("sends an explicit chosen plan while preserving the legacy checkout request", async () => {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ checkout_url: "https://checkout.stripe.com/test", checkout_session_id: "cs_1" }), { status: 200 })));
  vi.stubGlobal("fetch", fetch);
  try {
    await startCheckout("esencial");
    expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify({ plan_code: "esencial" }));
    await startCheckout();
    expect(fetch.mock.calls[1][1].body).toBeUndefined();
  } finally { vi.unstubAllGlobals(); }
});

it("opens the server-selected billing portal without client customer or price IDs", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ portal_url: "https://billing.stripe.com/session/test" }), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  try {
    await expect(startBillingPortal()).resolves.toEqual({ portal_url: "https://billing.stripe.com/session/test" });
    expect(fetch.mock.calls[0][0]).toBe("/api/v1/billing/portal");
    expect(fetch.mock.calls[0][1].method).toBe("POST");
    expect(fetch.mock.calls[0][1].body).toBeUndefined();
  } finally { vi.unstubAllGlobals(); }
});
