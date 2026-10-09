import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveOfflineTenant } from "./activeTenant";
import { offlineDb } from "./db";
import { makeQueuedSale } from "./queue";
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
      expect(row).toMatchObject({ status: "pending", attempt_count: status === 429 ? 0 : 1 });
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
