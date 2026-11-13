import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveOfflineTenant } from "./activeTenant";
import { offlineDb } from "./db";
import { makeQueuedSale } from "./queue";
import { SYNC_REQUEST_TIMEOUT_MS } from "./sync";
import { getSyncIssue } from "./syncStatus";
import { stopOfflineSync, SYNC_CHUNK_SIZE, triggerSync } from "./syncWorker";

const draft = {
  items: [{ product_id: "product-1", quantity: 1 }],
  payments: [{ method: "cash" as const, amount: "18.50" }],
};
const uuids = ["sale-1", "sale-2", "sale-3"];

const syncedResponse = async (_url: unknown, init: RequestInit) => new Response(JSON.stringify({
  results: JSON.parse(init.body as string).sales.map((sale: { client_uuid: string }, index: number) => ({
    client_uuid: sale.client_uuid,
    status: "synced",
    order_id: `10000000-0000-4000-8000-00000000000${index + 1}`,
  })),
}), { status: 200 });

async function expectAllPendingWithBudget() {
  for (const clientUuid of uuids) {
    const row = await offlineDb.offline_sales.get(clientUuid);
    expect(row).toMatchObject({ status: "pending", attempt_count: 0 });
    expect(row?.lease_id).toBeUndefined();
  }
}

describe("offline worker during outages and batch-level rejections", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    offlineDb.close();
    await Dexie.delete("pos_offline");
    await offlineDb.open();
    setActiveOfflineTenant("tenant-a");
    stopOfflineSync();
    await offlineDb.offline_sales.bulkAdd(uuids.map((uuid) => makeQueuedSale("tenant-a", draft, uuid)));
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

  it("sends small chunks so the serial backend answers well within the timeout", () => {
    expect(SYNC_CHUNK_SIZE).toBe(25);
  });

  it.each([
    ["network errors", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["HTTP 503", () => Promise.resolve(new Response(null, { status: 503 }))],
    ["HTTP 502", () => Promise.resolve(new Response(null, { status: 502 }))],
  ])("a long outage with %s never turns pending sales into failed ones", async (_label, outage) => {
    const fetchMock = vi.fn(outage);
    vi.stubGlobal("fetch", fetchMock);

    // Far more retries than the old 5-attempt budget.
    for (let round = 0; round < 12; round += 1) {
      await triggerSync("tenant-a");
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      stopOfflineSync();
    }
    expect(fetchMock).toHaveBeenCalledTimes(12);
    await expectAllPendingWithBudget();
    expect(await offlineDb.offline_sales.where("status").equals("failed").count()).toBe(0);

    fetchMock.mockImplementation(syncedResponse as never);
    await triggerSync("tenant-a");
    for (const clientUuid of uuids) {
      expect(await offlineDb.offline_sales.get(clientUuid)).toMatchObject({ status: "synced" });
    }
  });

  it("a batch-level 403 keeps every sale pending and surfaces a session state", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("csrf", { status: 403 }))
      .mockImplementation(syncedResponse);
    vi.stubGlobal("fetch", fetchMock);

    await triggerSync("tenant-a");

    await expectAllPendingWithBudget();
    expect(getSyncIssue()).toEqual({ tenantId: "tenant-a", kind: "session" });
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    stopOfflineSync();
    await triggerSync("tenant-a");
    expect(getSyncIssue()).toBeNull();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).sales).toEqual(JSON.parse(fetchMock.mock.calls[0][1].body).sales);
    for (const clientUuid of uuids) {
      expect(await offlineDb.offline_sales.get(clientUuid)).toMatchObject({ status: "synced" });
    }
  });

  it("a hung request times out and releases its leases for the next attempt", async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    vi.stubGlobal("fetch", fetchMock);

    const run = triggerSync("tenant-a");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(await offlineDb.offline_sales.get("sale-1")).toMatchObject({ status: "syncing" });
    await vi.advanceTimersByTimeAsync(SYNC_REQUEST_TIMEOUT_MS);
    await run;

    await expectAllPendingWithBudget();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });
});
