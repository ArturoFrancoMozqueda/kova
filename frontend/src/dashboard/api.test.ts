import { afterEach, describe, expect, it, vi } from "vitest";
import { getDashboardOverview } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("dashboard overview transport", () => {
  it("requests all branches by default without caching private data", async () => {
    const payload = { timezone: "America/Tijuana" };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getDashboardOverview("week")).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/v1/reports/dashboard?period=week&branch_id=all", { cache: "no-store" });
  });
  it("allows the legacy read only when the endpoint is absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    expect(await getDashboardOverview("day")).toBeNull();
  });
  it.each([401, 402, 403, 429, 500, 503])("does not fall back after HTTP %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
    await expect(getDashboardOverview("day")).rejects.toThrow(`(${status})`);
  });
  it("rejects malformed responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not JSON")));
    await expect(getDashboardOverview("day")).rejects.toThrow();
  });
});
