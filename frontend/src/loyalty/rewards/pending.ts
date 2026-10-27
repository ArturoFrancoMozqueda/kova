import Dexie, { type EntityTable } from "dexie";
import type { WorkspaceIdentity } from "@/automations/workspace";
import type { RewardCheckout } from "./api";
export type PendingReward = { scope: string; key: string; body: RewardCheckout; createdAt: string };
// This is recovery of a sent online command, never an offline sale or a worker queue.
const recoveryDb = new Dexie("kova_reward_recovery") as Dexie & { pending: EntityTable<PendingReward, "scope"> };
recoveryDb.version(1).stores({ pending: "scope" });
export const rewardScope = (identity: WorkspaceIdentity) => `${identity.tenantId}:${identity.userId}:${identity.branchId}`;
export const readPendingReward = (identity: WorkspaceIdentity) => recoveryDb.pending.get(rewardScope(identity));
export async function rememberReward(identity: WorkspaceIdentity, body: RewardCheckout): Promise<PendingReward> {
  return recoveryDb.transaction("rw", recoveryDb.pending, async () => {
    const scope = rewardScope(identity);
    if (await recoveryDb.pending.get(scope)) throw new Error("Hay una venta con recompensa pendiente. Consulta su resultado antes de cobrar otra.");
    const record = { scope, key: crypto.randomUUID(), body: structuredClone(body), createdAt: new Date().toISOString() };
    await recoveryDb.pending.add(record);
    return record;
  });
}
export async function forgetReward(record: PendingReward) {
  await recoveryDb.transaction("rw", recoveryDb.pending, async () => {
    if ((await recoveryDb.pending.get(record.scope))?.key === record.key) await recoveryDb.pending.delete(record.scope);
  });
}
