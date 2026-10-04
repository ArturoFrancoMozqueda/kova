import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSalesSummary, invalidateReportsCache, setReportsCacheIdentity } from "./api";

const identityA = { tenantId: "tenant-a", userId: "user-a", role: "owner" };
const readSummary = () => getSalesSummary("2026-10-01", "2026-10-04");
const response = (netSales: string) => new Response(JSON.stringify({ net_sales: netSales }), { status: 200 });

describe("report cache identity and invalidation", () => {
  beforeEach(() => {
    setReportsCacheIdentity(identityA);
    invalidateReportsCache();
  });
  afterEach(() => {
    setReportsCacheIdentity(null);
    vi.unstubAllGlobals();
  });

  it("deduplicates and caches reads only within the verified identity", async () => {
    const fetch = vi.fn().mockResolvedValue(response("100.00"));
    vi.stubGlobal("fetch", fetch);
    const [first, second] = await Promise.all([readSummary(), readSummary()]);
    expect(first).toEqual(second);
    expect(await readSummary()).toEqual(first);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    { tenantId: "tenant-b", userId: "user-b", role: "owner" },
    { ...identityA, userId: "user-b" },
    { ...identityA, role: "cashier" },
  ])("fetches fresh results after the verified tenant, user, or role changes: %j", async (identity) => {
    const fetch = vi.fn().mockResolvedValueOnce(response("100.00")).mockResolvedValueOnce(response("25.00"));
    vi.stubGlobal("fetch", fetch);
    await readSummary();
    setReportsCacheIdentity(identity);
    expect(await readSummary()).toEqual({ net_sales: "25.00" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not cache or deduplicate without a verified online identity", async () => {
    setReportsCacheIdentity(null);
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(response("0.00")));
    vi.stubGlobal("fetch", fetch);
    await Promise.all([readSummary(), readSummary()]);
    await readSummary();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each(["identity", "same-identity-return", "refresh"])("rejects old in-flight results after %s and keeps the new request deduplicated", async (change) => {
    let finishOld!: (value: Response) => void;
    let finishNew!: (value: Response) => void;
    const fetch = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishOld = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishNew = resolve; }));
    vi.stubGlobal("fetch", fetch);
    const old = readSummary();
    const rejected = expect(old).rejects.toThrow(/cambiaron/);
    if (change === "refresh") {
      invalidateReportsCache();
    } else {
      setReportsCacheIdentity({ tenantId: "tenant-b", userId: "user-b" });
      if (change === "same-identity-return") setReportsCacheIdentity(identityA);
    }
    const fresh = readSummary();
    finishOld(response("100.00"));
    await rejected;
    const duplicate = readSummary();
    expect(fetch).toHaveBeenCalledTimes(2);
    finishNew(response("25.00"));
    expect(await fresh).toEqual({ net_sales: "25.00" });
    expect(await duplicate).toEqual({ net_sales: "25.00" });
    expect(await readSummary()).toEqual({ net_sales: "25.00" });
  });
});
