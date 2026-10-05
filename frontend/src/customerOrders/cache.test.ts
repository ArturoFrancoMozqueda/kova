import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
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
});
