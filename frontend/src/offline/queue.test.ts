import { describe, expect, it } from "vitest";
import { makeQueuedSale } from "./queue";
import type { OfflineReceiptSnapshot } from "./types";

const receiptSnapshot: OfflineReceiptSnapshot = {
  business_name: "Panadería Kova",
  created_at: "2026-07-18T01:00:00.000Z",
  items: [
    {
      product_name: "Concha",
      quantity: 2,
      unit_price_amount: "18.50",
      line_total_amount: "37.00",
      modifiers: [],
    },
  ],
  subtotal_amount: "37.00",
  total_amount: "37.00",
  payments: [{ method: "cash", amount_amount: "37.00" }],
  total_tendered: "40.00",
  total_change: "3.00",
};

describe("offline queue helpers", () => {
  it("creates a pending queued sale with a stable client uuid", () => {
    const queued = makeQueuedSale(
      "tenant-1",
      {
        items: [{ product_id: "product-1", quantity: 2 }],
        payments: [{ method: "cash", amount: "37.00", amount_tendered: "40.00" }],
      },
      "00000000-0000-4000-8000-000000000001"
    );

    expect(queued.client_uuid).toBe("00000000-0000-4000-8000-000000000001");
    expect(queued.tenant_id).toBe("tenant-1");
    expect(queued.status).toBe("pending");
    expect(queued.attempt_count).toBe(0);
    expect(queued.shift_id).toBeUndefined();
  });

  it("carries the ring-time shift id when provided", () => {
    const queued = makeQueuedSale(
      "tenant-1",
      {
        items: [{ product_id: "product-1", quantity: 1 }],
        payments: [{ method: "cash", amount: "50.00", amount_tendered: "50.00" }],
      },
      "00000000-0000-4000-8000-000000000002",
      "shift-abc"
    );

    expect(queued.shift_id).toBe("shift-abc");
  });

  it("stores an optional local receipt snapshot with the queue row", () => {
    const queued = makeQueuedSale(
      "tenant-1",
      {
        items: [{ product_id: "product-1", quantity: 2 }],
        payments: [{ method: "cash", amount: "37.00", amount_tendered: "40.00" }],
      },
      "00000000-0000-4000-8000-000000000003",
      undefined,
      receiptSnapshot,
    );

    expect(queued.receipt_snapshot).toEqual(receiptSnapshot);
  });

  it("rejects a new row without authenticated tenant ownership", () => {
    expect(() => makeQueuedSale("", { items: [], payments: [] })).toThrow(
      /authenticated tenant/i,
    );
  });
});
