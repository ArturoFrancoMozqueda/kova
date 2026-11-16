import { afterEach, describe, expect, it } from "vitest";
import { offlineDb } from "@/offline/db";
import { clearRefundIntent, prepareRefundIntent, readRefundIntent } from "./refundIntents";

const scope = { tenantId: "tenant-a", userId: "owner-a", branchId: "branch-a", orderId: "sale-a" };
const payload = { reason: "customer_return", refund_payment_method: "cash" as const, items: [{ order_item_id: "line-a", quantity: 1 }] };

afterEach(async () => { await offlineDb.refund_intents.clear(); });

describe("durable refund identity", () => {
  it("atomically preserves the first intent across concurrent tabs and a reopened database", async () => {
    const [first, otherTab] = await Promise.all([
      prepareRefundIntent(scope, payload),
      prepareRefundIntent(scope, { ...payload, items: [{ order_item_id: "line-a", quantity: 2 }] }),
    ]);
    expect(first.created).toBe(true);
    expect(otherTab.created).toBe(false);
    expect(otherTab.intent).toEqual(first.intent);
    offlineDb.close();
    await offlineDb.open();
    expect(await readRefundIntent(scope)).toEqual(first.intent);
    await clearRefundIntent(first.intent);
    expect(await readRefundIntent(scope)).toBeUndefined();
    const staleTab = await prepareRefundIntent(scope, payload, first.intent);
    expect(staleTab.intent.idempotencyKey).toBe(first.intent.idempotencyKey);
    const confirmedAgain = staleTab.intent;
    await clearRefundIntent(confirmedAgain);
  });

  it("does not expose another user, tenant, branch or sale's pending intent", async () => {
    const { intent } = await prepareRefundIntent(scope, payload);
    for (const key of ["tenantId", "userId", "branchId", "orderId"] as const) {
      expect(await readRefundIntent({ ...scope, [key]: "other" })).toBeUndefined();
    }
    await clearRefundIntent({ ...intent, idempotencyKey: "stale-identity" });
    expect(await readRefundIntent(scope)).toEqual(intent);
  });
});
