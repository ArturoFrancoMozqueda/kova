import { offlineDb } from "@/offline/db";
import type { RefundPayload } from "./types";

export type RefundIntentScope = {
  tenantId: string;
  userId: string;
  branchId: string;
  orderId: string;
};

export type RefundIntent = RefundIntentScope & {
  id: string;
  payload: RefundPayload;
  idempotencyKey: string;
};

export const refundIntentId = (scope: RefundIntentScope) =>
  JSON.stringify([scope.tenantId, scope.userId, scope.branchId, scope.orderId]);

export function readRefundIntent(scope: RefundIntentScope) {
  return offlineDb.refund_intents.get(refundIntentId(scope));
}

// Persist before the request, including its uncertain outcome. Another tab or
// a remounted detail view must replay this identity before starting a new one.
export function prepareRefundIntent(scope: RefundIntentScope, payload: RefundPayload, known?: RefundIntent | null) {
  return offlineDb.transaction("rw", offlineDb.refund_intents, async () => {
    const id = refundIntentId(scope);
    const previous = await offlineDb.refund_intents.get(id);
    // Another tab can already have confirmed and removed this row. A mounted
    // recovery form must still replay its original key, never mint a new one.
    if (known?.id === id) {
      if (!previous) await offlineDb.refund_intents.add(known);
      return { intent: known, created: false };
    }
    if (previous) return { intent: previous, created: false };
    const intent: RefundIntent = { ...scope, id, payload, idempotencyKey: crypto.randomUUID() };
    await offlineDb.refund_intents.add(intent);
    return { intent, created: true };
  });
}

export function clearRefundIntent(intent: RefundIntent) {
  return offlineDb.transaction("rw", offlineDb.refund_intents, async () => {
    const current = await offlineDb.refund_intents.get(intent.id);
    if (current?.idempotencyKey === intent.idempotencyKey) {
      await offlineDb.refund_intents.delete(intent.id);
    }
  });
}
