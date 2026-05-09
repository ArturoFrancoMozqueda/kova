import { describe, expect, it } from "vitest";
import { makeQueuedSale } from "./queue";

describe("offline queue helpers", () => {
  it("creates a pending queued sale with a stable client uuid", () => {
    const queued = makeQueuedSale(
      {
        items: [{ product_id: "product-1", quantity: 2 }],
        payments: [{ method: "cash", amount: "37.00", amount_tendered: "40.00" }],
      },
      "00000000-0000-4000-8000-000000000001"
    );

    expect(queued.client_uuid).toBe("00000000-0000-4000-8000-000000000001");
    expect(queued.status).toBe("pending");
    expect(queued.attempt_count).toBe(0);
  });
});
