import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveOfflineTenant } from "./activeTenant";
import { offlineDb } from "./db";
import { makeQueuedSale, SYNC_LEASE_MS } from "./queue";
import { stopOfflineSync, triggerSync } from "./syncWorker";

const draft = {
  items: [{ product_id: "product-1", quantity: 1 }],
  payments: [{ method: "bank_transfer" as const, amount: "18.50" }],
};

describe("offline worker mixed retry budgets", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    offlineDb.close();
    await Dexie.delete("pos_offline");
    await offlineDb.open();
    setActiveOfflineTenant("tenant-a");
    stopOfflineSync();
    await offlineDb.offline_sales.bulkAdd([
      { ...makeQueuedSale("tenant-a", draft, "a-exhausted"), attempt_count: 5 },
      makeQueuedSale("tenant-a", draft, "b-retryable"),
      makeQueuedSale("tenant-a", draft, "c-retryable"),
      makeQueuedSale("tenant-b", draft, "other-tenant"),
    ]);
  });

  afterEach(() => {
    stopOfflineSync();
    setActiveOfflineTenant(null);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  afterAll(async () => {
    offlineDb.close();
    await Dexie.delete("pos_offline");
  });

  it("does not claim sales or consume retry budgets while the browser is offline", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fetchMock = vi.fn(async (_url, init) => new Response(JSON.stringify({
      results: JSON.parse(init.body).sales.map((sale: { client_uuid: string }, index: number) => ({
        client_uuid: sale.client_uuid,
        status: "synced",
        order_id: `10000000-0000-4000-8000-00000000000${index + 1}`,
      })),
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await triggerSync("tenant-a");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await offlineDb.offline_sales.get("a-exhausted"))
        .toMatchObject({ status: "pending", attempt_count: 5 });
      for (const clientUuid of ["b-retryable", "c-retryable"]) {
        const row = await offlineDb.offline_sales.get(clientUuid);
        expect(row).toMatchObject({ status: "pending", attempt_count: 0 });
        expect(row?.lease_id).toBeUndefined();
      }
      online.mockReturnValue(true);
      await triggerSync("tenant-a");
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(await offlineDb.offline_sales.get("b-retryable")).toMatchObject({ status: "synced" });
      expect(await offlineDb.offline_sales.get("c-retryable")).toMatchObject({ status: "synced" });
    } finally {
      online.mockRestore();
    }
  });

  it("recovers a previous tab's lease automatically after a reload, preserving its UUID", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await offlineDb.offline_sales.clear();
    await offlineDb.offline_sales.bulkAdd([{
      ...makeQueuedSale("tenant-a", draft, "interrupted-sale"),
      status: "syncing", attempt_count: 1, lease_id: "old-lease", sync_owner: "old-tab",
      sync_started_at: new Date().toISOString(),
    }, {
      ...makeQueuedSale("tenant-b", draft, "other-lease"),
      status: "syncing", attempt_count: 1, lease_id: "other-lease", sync_owner: "other-tab",
      sync_started_at: new Date().toISOString(),
    }]);
    const fetchMock = vi.fn(async (_url, init) => new Response(JSON.stringify({
      results: JSON.parse(init.body).sales.map((sale: { client_uuid: string }) => ({
        client_uuid: sale.client_uuid, status: "synced", order_id: "10000000-0000-4000-8000-000000000001",
      })),
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await triggerSync("tenant-a");
    await vi.advanceTimersByTimeAsync(SYNC_LEASE_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(async () => {
      expect(await offlineDb.offline_sales.get("interrupted-sale")).toMatchObject({ status: "synced" });
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).sales[0].client_uuid).toBe("interrupted-sale");
    expect(await offlineDb.offline_sales.get("other-lease")).toMatchObject({ status: "syncing", attempt_count: 1 });
  });

  it("cancels a scheduled lease recovery when the verified tenant is cleared", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await offlineDb.offline_sales.clear();
    await offlineDb.offline_sales.add({
      ...makeQueuedSale("tenant-a", draft, "interrupted-sale"),
      status: "syncing", attempt_count: 1, lease_id: "old-lease", sync_owner: "old-tab",
      sync_started_at: new Date().toISOString(),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await triggerSync("tenant-a");
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    setActiveOfflineTenant(null);
    await vi.advanceTimersByTimeAsync(SYNC_LEASE_MS + 1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await offlineDb.offline_sales.get("interrupted-sale")).toMatchObject({ status: "syncing" });
  });

  it.each([503, 429])("releases every retryable lease on HTTP %s and resumes the original sales", async (status) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status, headers: { "Retry-After": "1" } }))
      .mockImplementation(async (_url, init) => new Response(JSON.stringify({
        results: JSON.parse(init.body).sales.map((sale: { client_uuid: string }, index: number) => ({
          client_uuid: sale.client_uuid,
          status: "synced",
          order_id: `10000000-0000-4000-8000-00000000000${index + 1}`,
        })),
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await triggerSync("tenant-a");

    expect(await offlineDb.offline_sales.get("a-exhausted")).toMatchObject({ status: "failed" });
    for (const clientUuid of ["b-retryable", "c-retryable"]) {
      const row = await offlineDb.offline_sales.get(clientUuid);
      // Neither a 5xx nor a 429 spends the sale's retry budget.
      expect(row).toMatchObject({ status: "pending", attempt_count: 0 });
      expect(row?.lease_id).toBeUndefined();
    }
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).sales.map((sale: { client_uuid: string }) => sale.client_uuid))
      .toEqual(["b-retryable", "c-retryable"]);

    expect(vi.getTimerCount()).toBeGreaterThan(0);
    stopOfflineSync();
    await triggerSync("tenant-a");

    expect(await offlineDb.offline_sales.get("b-retryable")).toMatchObject({ status: "synced" });
    expect(await offlineDb.offline_sales.get("c-retryable")).toMatchObject({ status: "synced" });
    expect(await offlineDb.offline_sales.get("other-tenant")).toMatchObject({ status: "pending", attempt_count: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).sales).toEqual(JSON.parse(fetchMock.mock.calls[0][1].body).sales);
  });
});
