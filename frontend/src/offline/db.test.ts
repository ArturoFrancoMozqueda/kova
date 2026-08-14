import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";

const DB_NAME = "pos_offline";
const sale = {
  items: [{ product_id: "product-1", quantity: 1 }],
  payments: [{ method: "cash", amount: "18.50" }],
};

async function createV3(rows: Array<Record<string, unknown>>) {
  const old = new Dexie(DB_NAME);
  old.version(1).stores({ offline_sales: "client_uuid,status,updated_at" });
  old.version(2).stores({
    offline_sales: "client_uuid,status,updated_at",
    catalog_cache: "tenant_id",
  });
  old.version(3).stores({
    offline_sales: "client_uuid,status,updated_at",
    catalog_cache: "tenant_id",
    customer_orders_cache: "tenant_id,cached_at",
  });
  await old.open();
  await old.table("offline_sales").bulkAdd(rows);
  old.close();
}

describe("offline database v4 migration", () => {
  afterEach(async () => {
    const { offlineDb } = await import("./db");
    offlineDb.close();
    await Dexie.delete(DB_NAME);
    vi.resetModules();
  });

  it("preserves and quarantines legacy rows without inventing a tenant", async () => {
    await Dexie.delete(DB_NAME);
    await createV3([
      {
        client_uuid: "legacy-1",
        status: "syncing",
        sale,
        receipt_snapshot: { business_name: "Negocio", created_at: "2026-08-01T00:00:00Z", items: [] },
        shift_id: "shift-1",
        attempt_count: 2,
        sync_owner: "old-worker",
        lease_id: "old-lease",
        created_at: "2026-08-01T00:00:00Z",
        updated_at: "2026-08-01T00:01:00Z",
      },
    ]);
    vi.resetModules();
    const { offlineDb } = await import("./db");
    const row = await offlineDb.offline_sales.get("legacy-1");

    expect(row).toMatchObject({
      client_uuid: "legacy-1",
      status: "quarantined",
      shift_id: "shift-1",
      attempt_count: 2,
    });
    expect(row?.tenant_id).toBeUndefined();
    expect(row?.lease_id).toBeUndefined();
  });

  it("keeps already-owned rows syncable and upgrades a large queue", async () => {
    await Dexie.delete(DB_NAME);
    await createV3(Array.from({ length: 1_001 }, (_, index) => ({
      client_uuid: `sale-${index}`,
      tenant_id: "tenant-1",
      status: "pending",
      sale,
      attempt_count: 0,
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    })));
    vi.resetModules();
    const { offlineDb } = await import("./db");

    expect(await offlineDb.offline_sales.count()).toBe(1_001);
    expect(await offlineDb.offline_sales.where("[tenant_id+status]").equals(["tenant-1", "pending"]).count()).toBe(1_001);
  });
});
