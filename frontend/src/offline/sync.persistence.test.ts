import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveOfflineTenant } from "./activeTenant";
import { offlineDb } from "./db";
import { claimPendingOfflineSales, makeQueuedSale } from "./queue";
import { syncOfflineSales } from "./sync";

const draft = {
  items: [{ product_id: "product-1", quantity: 1 }],
  payments: [{ method: "cash" as const, amount: "18.50" }],
};

describe("offline sync acknowledgement recovery", () => {
  beforeEach(async () => {
    offlineDb.close();
    await Dexie.delete("pos_offline");
    await offlineDb.open();
    setActiveOfflineTenant("tenant-a");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setActiveOfflineTenant(null);
  });

  afterAll(async () => {
    offlineDb.close();
    await Dexie.delete("pos_offline");
  });

  it("retains the original sales after a partial acknowledgement and safely replays their identities", async () => {
    await offlineDb.offline_sales.bulkAdd([
      makeQueuedSale("tenant-a", draft, "uuid-a1"),
      makeQueuedSale("tenant-a", draft, "uuid-a2"),
      makeQueuedSale("tenant-b", draft, "uuid-b"),
    ]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{ client_uuid: "uuid-a1", status: "synced", order_id: "10000000-0000-4000-8000-000000000001" }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [
          { client_uuid: "uuid-a2", status: "synced", order_id: "10000000-0000-4000-8000-000000000002" },
          { client_uuid: "uuid-a1", status: "synced", order_id: "10000000-0000-4000-8000-000000000001" },
        ],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const firstClaim = await claimPendingOfflineSales("tenant-a", "worker-1", 100);
    await expect(syncOfflineSales("tenant-a", firstClaim)).rejects.toThrow(/se reintentará/);

    for (const clientUuid of ["uuid-a1", "uuid-a2"]) {
      const row = await offlineDb.offline_sales.get(clientUuid);
      expect(row).toMatchObject({
        client_uuid: clientUuid, tenant_id: "tenant-a", sale: draft, status: "pending", attempt_count: 1,
      });
      expect(row?.lease_id).toBeUndefined();
    }

    const retryClaim = await claimPendingOfflineSales("tenant-a", "worker-2", 100);
    expect(retryClaim[0].lease_id).not.toBe(firstClaim[0].lease_id);
    await syncOfflineSales("tenant-a", retryClaim);

    const requestSales = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).sales);
    expect(requestSales[1]).toEqual(requestSales[0]);
    expect(await offlineDb.offline_sales.get("uuid-a1")).toMatchObject({ status: "synced", synced_order_id: "10000000-0000-4000-8000-000000000001" });
    expect(await offlineDb.offline_sales.get("uuid-a2")).toMatchObject({ status: "synced", synced_order_id: "10000000-0000-4000-8000-000000000002" });
    expect(await offlineDb.offline_sales.get("uuid-b")).toMatchObject({ tenant_id: "tenant-b", status: "pending", attempt_count: 0 });
    expect(await offlineDb.offline_sales.count()).toBe(3);
  });
});
