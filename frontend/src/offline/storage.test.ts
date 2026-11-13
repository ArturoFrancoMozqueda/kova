import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { offlineDb } from "./db";
import { makeQueuedSale, OfflineStorageFullError, queueOfflineSale } from "./queue";
import { LotQueueError } from "./lotStock";
import {
  isQuotaExceededError, purgeSyncedSales, requestPersistentStorage,
  resetPersistentStorageRequestForTests, SYNCED_RETENTION_MS,
} from "./storage";
import type { OfflineSaleStatus, StoredOfflineSaleQueueItem } from "./types";

const draft = {
  items: [{ product_id: "product-1", quantity: 1 }],
  payments: [{ method: "cash" as const, amount: "18.50" }],
};
const NOW = Date.parse("2026-11-13T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60_000).toISOString();

function row(uuid: string, status: OfflineSaleStatus, updatedAt: string): StoredOfflineSaleQueueItem {
  return { ...makeQueuedSale("tenant-a", draft, uuid), status, updated_at: updatedAt, created_at: updatedAt };
}

describe("offline queue storage hygiene", () => {
  beforeEach(async () => {
    offlineDb.close();
    await Dexie.delete("pos_offline");
    await offlineDb.open();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    offlineDb.close();
    await Dexie.delete("pos_offline");
  });

  it("purges only old synced rows and keeps every unconfirmed, failed or quarantined sale", async () => {
    const legacy = { ...row("old-quarantined", "quarantined", daysAgo(30)), tenant_id: undefined } as StoredOfflineSaleQueueItem;
    await offlineDb.offline_sales.bulkAdd([
      row("old-synced", "synced", daysAgo(8)),
      row("recent-synced", "synced", daysAgo(6)),
      row("old-pending", "pending", daysAgo(30)),
      row("old-syncing", "syncing", daysAgo(30)),
      row("old-failed", "failed", daysAgo(30)),
      legacy,
    ]);

    expect(await purgeSyncedSales(SYNCED_RETENTION_MS, NOW)).toBe(1);

    const remaining = (await offlineDb.offline_sales.toArray()).map((sale) => sale.client_uuid).sort();
    expect(remaining).toEqual(["old-failed", "old-pending", "old-quarantined", "old-syncing", "recent-synced"]);
  });

  it("frees confirmed copies and retries once when the device storage is full", async () => {
    await offlineDb.offline_sales.add(row("recent-synced", "synced", new Date().toISOString()));
    const realAdd = offlineDb.offline_sales.add.bind(offlineDb.offline_sales);
    const add = vi.spyOn(offlineDb.offline_sales, "add")
      .mockRejectedValueOnce(new DOMException("full", "QuotaExceededError"))
      .mockImplementation(realAdd as never);

    const queued = await queueOfflineSale("tenant-a", draft);

    expect(add).toHaveBeenCalledTimes(2);
    expect(await offlineDb.offline_sales.get(queued.client_uuid)).toMatchObject({ status: "pending" });
    expect(await offlineDb.offline_sales.get("recent-synced")).toBeUndefined();
  });

  it("tells the cashier the sale was not saved when storage stays full", async () => {
    await offlineDb.offline_sales.add(row("pending-sale", "pending", daysAgo(1)));
    vi.spyOn(offlineDb.offline_sales, "add").mockRejectedValue(
      Object.assign(new Error("Dexie wrapper"), { name: "AbortError", inner: new DOMException("full", "QuotaExceededError") }),
    );

    const error = await queueOfflineSale("tenant-a", draft).catch((e) => e);

    expect(error).toBeInstanceOf(OfflineStorageFullError);
    // Checkout shows LotQueueError messages verbatim and keeps the cart.
    expect(error).toBeInstanceOf(LotQueueError);
    expect(error.message).toMatch(/no se registró/);
    expect(await offlineDb.offline_sales.get("pending-sale")).toMatchObject({ status: "pending" });
  });

  it("recognizes wrapped quota errors only", () => {
    expect(isQuotaExceededError(new DOMException("full", "QuotaExceededError"))).toBe(true);
    expect(isQuotaExceededError({ name: "AbortError", inner: { name: "QuotaExceededError" } })).toBe(true);
    expect(isQuotaExceededError(new TypeError("Failed to fetch"))).toBe(false);
  });

  it("asks for persistent storage once and tolerates unsupported browsers", async () => {
    resetPersistentStorageRequestForTests();
    const persist = vi.fn().mockResolvedValue(true);
    const persisted = vi.fn().mockResolvedValue(false);
    vi.stubGlobal("navigator", { ...navigator, storage: { persist, persisted } });
    requestPersistentStorage();
    requestPersistentStorage();
    await Promise.resolve();
    await Promise.resolve();
    expect(persisted).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);

    resetPersistentStorageRequestForTests();
    vi.stubGlobal("navigator", { ...navigator, storage: undefined });
    expect(() => requestPersistentStorage()).not.toThrow();
  });
});
