import Dexie, { type EntityTable } from "dexie";
import type { WorkspaceIdentity } from "@/automations/workspace";
import type { CouponCheckout } from "./api";

export type PendingCoupon = { scope: string; key: string; body: CouponCheckout; createdAt: string };
// Recovery of a sent online command (the coupon sale), never an offline sale or a worker queue.
const recoveryDb = new Dexie("kova_coupon_recovery") as Dexie & { pending: EntityTable<PendingCoupon, "scope"> };
recoveryDb.version(1).stores({ pending: "scope" });
export const couponScope = (identity: WorkspaceIdentity) => `${identity.tenantId}:${identity.userId}:${identity.branchId}`;
export const readPendingCoupon = (identity: WorkspaceIdentity) => recoveryDb.pending.get(couponScope(identity));
export async function rememberCoupon(identity: WorkspaceIdentity, body: CouponCheckout): Promise<PendingCoupon> {
  return recoveryDb.transaction("rw", recoveryDb.pending, async () => {
    const scope = couponScope(identity);
    if (await recoveryDb.pending.get(scope)) throw new Error("Hay una venta con cupón pendiente. Consulta su resultado antes de cobrar otra.");
    const record = { scope, key: crypto.randomUUID(), body: structuredClone(body), createdAt: new Date().toISOString() };
    await recoveryDb.pending.add(record);
    return record;
  });
}
export async function forgetCoupon(record: PendingCoupon) {
  await recoveryDb.transaction("rw", recoveryDb.pending, async () => {
    if ((await recoveryDb.pending.get(record.scope))?.key === record.key) await recoveryDb.pending.delete(record.scope);
  });
}
