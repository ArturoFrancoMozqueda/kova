import { csrfHeaders } from "@/lib/csrf";
import type { WorkspaceIdentity } from "@/automations/workspace";
import type { Order, OrderCreatePayload } from "@/orders/types";
export type Reward = { id: string; version: number; enabled: boolean; title: string; points_cost: number; discount_amount: string };
export type RewardOffer = { customer_id: string; balance: number; adjustments_pending: boolean; reward: Reward | null };
export function isReward(value: unknown): value is Reward {
  const row = value as Partial<Reward> | null;
  return Boolean(row && typeof row.id === "string" && typeof row.title === "string" && typeof row.enabled === "boolean" && Number.isInteger(row.version) && Number.isSafeInteger(row.points_cost) && Number(row.points_cost) > 0 && typeof row.discount_amount === "string" && Number(row.discount_amount) > 0);
}
export type RewardCheckout = { order: OrderCreatePayload; reward_id: string; reward_version: number; expected_balance: number; confirmed: true };
export class RewardError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function rewardRequest<T>(identity: WorkspaceIdentity, path: string, method = "GET", body?: unknown, key?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/v1/loyalty/rewards${path}`, {
    method, credentials: "include", cache: "no-store", signal, headers: {
      "Content-Type": "application/json", "X-Kova-Expected-Tenant": identity.tenantId,
      "X-Kova-Expected-User": identity.userId, "X-Kova-Branch": identity.branchId,
      ...csrfHeaders(method), ...(key ? { "Idempotency-Key": key } : {}),
    }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new RewardError(typeof payload?.detail === "string" ? payload.detail : "No pudimos confirmar la operación. Consulta el resultado antes de volver a cobrar.", response.status);
  }
  return response.json() as Promise<T>;
}
export const checkoutReward = (identity: WorkspaceIdentity, body: RewardCheckout, key: string) => rewardRequest<Order>(identity, "/checkout", "POST", body, key);
