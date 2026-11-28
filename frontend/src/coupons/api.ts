import type { WorkspaceIdentity } from "@/automations/workspace";
import { csrfHeaders } from "@/lib/csrf";
import type { Order, OrderCreatePayload } from "@/orders/types";

export type CouponKind = "percent" | "amount";

export type Coupon = {
  id: string;
  code: string;
  description: string | null;
  kind: CouponKind;
  value: string;
  min_purchase: string | null;
  starts_at: string | null;
  ends_at: string | null;
  max_uses: number | null;
  max_uses_per_customer: number | null;
  is_active: boolean;
  version: number;
  uses: number;
  created_at: string;
};

export type CouponInput = {
  code: string;
  kind: CouponKind;
  value: string;
  description?: string | null;
  min_purchase?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  max_uses?: number | null;
  max_uses_per_customer?: number | null;
};

export type CouponCart = { customer_id?: string; items: OrderCreatePayload["items"] };
export type CouponPreview = { coupon: Coupon; subtotal_amount: string; discount_amount: string };
export type CouponCheckout = { code: string; order: OrderCreatePayload; expected_discount: string };

export class CouponError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}, identity?: WorkspaceIdentity, key?: string): Promise<T> {
  const method = init.method ?? "GET";
  const response = await fetch(`/api/v1/coupons${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...csrfHeaders(method),
      ...(identity ? {
        "X-Kova-Expected-Tenant": identity.tenantId, "X-Kova-Expected-User": identity.userId,
        "X-Kova-Branch": identity.branchId,
      } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: unknown } | null;
    const detail = payload?.detail;
    const message = typeof detail === "string" ? detail
      : typeof (detail as { message?: unknown })?.message === "string" ? (detail as { message: string }).message : "";
    throw new CouponError(message, response.status);
  }
  return response.json() as Promise<T>;
}

export const listCoupons = () => request<Coupon[]>("");
export const createCoupon = (body: CouponInput) => request<Coupon>("", { method: "POST", body: JSON.stringify(body) });
export const updateCoupon = (id: string, body: Partial<Omit<CouponInput, "code" | "kind">> & { version: number; is_active?: boolean }) =>
  request<Coupon>(`/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const previewCoupon = (code: string, order: CouponCart) =>
  request<CouponPreview>("/preview", { method: "POST", body: JSON.stringify({ code, order }) });
export const checkoutCoupon = (identity: WorkspaceIdentity, body: CouponCheckout, key: string) =>
  request<Order>("/checkout", { method: "POST", body: JSON.stringify(body) }, identity, key);
