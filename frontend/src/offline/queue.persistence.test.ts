import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { offlineDb } from "./db";
import {
  claimOfflineSale,
  claimPendingOfflineSales,
  makeQueuedSale,
  markOfflineSaleSynced,
  queueOfflineSale,
  recoverExpiredLeases,
  retryDeadLetter,
  SYNC_LEASE_MS,
} from "./queue";

const draft = {
  items: [{ product_id: "product-1", quantity: 1 }],
  payments: [{ method: "cash" as const, amount: "18.50" }],
};

describe("tenant-scoped offline queue leases", () => {
  beforeEach(async () => {
    offlineDb.close();
    await Dexie.delete("pos_offline");
    await offlineDb.open();
  });

  afterAll(async () => {
    offlineDb.close();
    await Dexie.delete("pos_offline");
  });

  it("isolates claims, dead-letter retries and UUID collisions by tenant", async () => {
    await offlineDb.offline_sales.add({ ...makeQueuedSale("tenant-a", draft, "uuid-a"), status: "failed" });
    await offlineDb.offline_sales.add(makeQueuedSale("tenant-b", draft, "uuid-b"));

    expect(await retryDeadLetter("tenant-b", "uuid-a")).toBe(false);
    expect((await offlineDb.offline_sales.get("uuid-a"))?.status).toBe("failed");
    expect(await claimPendingOfflineSales("tenant-a", "worker-a", 100)).toEqual([]);
    expect((await claimPendingOfflineSales("tenant-b", "worker-b", 100)).map((row) => row.client_uuid)).toEqual(["uuid-b"]);

    await expect(queueOfflineSale("tenant-b", draft)).resolves.toMatchObject({ tenant_id: "tenant-b" });
    await expect(offlineDb.offline_sales.add(makeQueuedSale("tenant-b", draft, "uuid-a"))).rejects.toBeDefined();
    expect((await offlineDb.offline_sales.get("uuid-a"))?.tenant_id).toBe("tenant-a");
  });

  it("does not let a second tab steal an active lease", async () => {
    await offlineDb.offline_sales.add(makeQueuedSale("tenant-a", draft, "uuid-a"));
    const first = await claimPendingOfflineSales("tenant-a", "tab-1", 100);
    const second = await claimPendingOfflineSales("tenant-a", "tab-2", 100);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(first[0].sync_owner).toBe("tab-1");
  });

  it("restores the retry budget without changing sale identity or ownership", async () => {
    const failed = makeQueuedSale("tenant-a", draft, "uuid-a");
    failed.status = "failed";
    failed.attempt_count = 5;
    failed.last_error = "Max sync attempts exceeded";
    await offlineDb.offline_sales.add(failed);

    expect(await retryDeadLetter("tenant-a", "uuid-a")).toBe(true);
    expect(await offlineDb.offline_sales.get("uuid-a")).toMatchObject({
      client_uuid: "uuid-a",
      tenant_id: "tenant-a",
      sale: draft,
      status: "pending",
      attempt_count: 0,
    });

    const [claimed] = await claimPendingOfflineSales("tenant-a", "retry-worker", 1);
    expect(claimed).toMatchObject({
      client_uuid: "uuid-a",
      tenant_id: "tenant-a",
      sale: draft,
      status: "syncing",
      attempt_count: 1,
      sync_owner: "retry-worker",
    });
    expect(claimed.lease_id).toBeTruthy();
  });

  it("recovers an expired crash lease and rejects a late response from its old owner", async () => {
    const row = makeQueuedSale("tenant-a", draft, "uuid-a");
    row.status = "syncing";
    row.attempt_count = 1;
    row.sync_owner = "crashed-tab";
    row.lease_id = "expired-lease";
    row.sync_started_at = new Date(Date.now() - SYNC_LEASE_MS - 1).toISOString();
    await offlineDb.offline_sales.add(row);

    expect(await recoverExpiredLeases("tenant-a")).toBe(1);
    const reclaimed = await claimOfflineSale("tenant-a", "uuid-a", "new-tab");
    expect(reclaimed?.lease_id).not.toBe("expired-lease");

    expect(await markOfflineSaleSynced("tenant-a", "uuid-a", "expired-lease", "wrong-order")).toBe(false);
    expect((await offlineDb.offline_sales.get("uuid-a"))?.status).toBe("syncing");
    expect(await markOfflineSaleSynced("tenant-a", "uuid-a", reclaimed!.lease_id!, "order-1")).toBe(true);
    expect(await offlineDb.offline_sales.get("uuid-a")).toMatchObject({ status: "synced", synced_order_id: "order-1" });
  });
});
