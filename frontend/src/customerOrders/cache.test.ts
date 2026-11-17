import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { offlineDb } from "@/offline/db";
import {
  readCustomerOrderCache,
  saveCustomerOrderList,
  saveCustomerOrderDetail,
} from "./cache";
import type { CustomerOrder, CustomerOrderListResponse } from "./types";

const list = {
  items: [],
  total: 0,
  limit: 20,
  offset: 0,
  status_counts: {
    new: 0,
    confirmed: 0,
    in_progress: 0,
    ready: 0,
    fulfilled: 0,
    cancelled: 0,
  },
} satisfies CustomerOrderListResponse;

describe("branch-aware customer order cache", () => {
  beforeEach(async () => {
    offlineDb.close();
    await Dexie.delete("pos_offline");
    await offlineDb.open();
  });
  afterEach(() => vi.useRealTimers());
  afterAll(async () => {
    offlineDb.close();
    await Dexie.delete("pos_offline");
  });
  it("does not expose or merge cached details from another branch", async () => {
    await saveCustomerOrderDetail(
      "tenant-a",
      { id: "order-centro" } as CustomerOrder,
      "centro",
    );
    await expect(
      readCustomerOrderCache("tenant-a", "norte"),
    ).resolves.toBeUndefined();
    await saveCustomerOrderList("tenant-a", list, "norte");
    expect(
      (await readCustomerOrderCache("tenant-a", "norte"))?.details,
    ).toEqual({});
    await expect(
      readCustomerOrderCache("tenant-a", "centro"),
    ).resolves.toBeUndefined();
  });
  it("attributes a legacy cache only to the principal branch", async () => {
    await offlineDb.customer_orders_cache.put({
      tenant_id: "tenant-a",
      cached_at: "2026-10-05",
      list,
      details: {},
    });
    await expect(
      readCustomerOrderCache("tenant-a", "norte"),
    ).resolves.toBeUndefined();
    expect((await readCustomerOrderCache("tenant-a"))?.list).toEqual(list);
  });
  it("keeps each detail's read time when refreshing the list or another detail", async () => {
    vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
    await saveCustomerOrderDetail("tenant-a", { id: "a", version: 1 } as CustomerOrder);
    vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
    await saveCustomerOrderList("tenant-a", list);
    vi.setSystemTime(new Date("2026-11-17T13:00:00Z"));
    await saveCustomerOrderDetail("tenant-a", { id: "b", version: 2 } as CustomerOrder);
    const cached = await readCustomerOrderCache("tenant-a");
    expect(cached?.detail_cached_at).toEqual({
      a: "2026-11-01T12:00:00.000Z", b: "2026-11-17T13:00:00.000Z",
    });
    expect(cached?.list_cached_at).toBe("2026-11-17T12:00:00.000Z");
    expect(cached?.details.a.version).toBe(1);
  });

  it("preserves legacy records without assigning them another record's update time", async () => {
    await offlineDb.customer_orders_cache.put({
      tenant_id: "tenant-a", cached_at: "2026-11-17T12:00:00Z", list,
      details: { old: { id: "old" } as CustomerOrder },
    });
    await saveCustomerOrderDetail("tenant-a", { id: "new" } as CustomerOrder);
    const cached = await readCustomerOrderCache("tenant-a");
    expect(cached?.details.old.id).toBe("old");
    expect(cached?.detail_cached_at?.old).toBeUndefined();
    expect(cached?.list_cached_at).toBeNull();
    expect(cached?.detail_cached_at?.new).toEqual(expect.any(String));
  });

  it("serializes concurrent list and detail refreshes without losing either detail", async () => {
    await Promise.all([
      saveCustomerOrderDetail("tenant-a", { id: "a" } as CustomerOrder),
      saveCustomerOrderDetail("tenant-a", { id: "b" } as CustomerOrder),
      saveCustomerOrderList("tenant-a", list),
    ]);
    const cached = await readCustomerOrderCache("tenant-a");
    expect(Object.keys(cached?.details ?? {}).sort()).toEqual(["a", "b"]);
    expect(Object.keys(cached?.detail_cached_at ?? {}).sort()).toEqual(["a", "b"]);
    expect(cached?.list_cached_at).toEqual(expect.any(String));
  });

});
