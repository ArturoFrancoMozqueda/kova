import { csrfHeaders } from "@/lib/csrf";
import { invalidateReportsCache } from "@/reports/api";

export type Supplier = { id: string; name: string; contact: string | null; is_active: boolean };
export type PurchaseItem = { id: string; product_id: string; product_name: string; quantity: number; received_quantity: number; unit_cost: string };
export type Purchase = { id: string; branch_id: string; supplier_id: string; supplier_name: string; notes: string | null; status: "pending" | "partial" | "received" | "cancelled"; created_at: string; items: PurchaseItem[] };

async function request<T>(path: string, body?: unknown, key?: string): Promise<T> {
  const response = await fetch(`/api/v1/purchasing/${path}`, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json", ...csrfHeaders("POST"), "Idempotency-Key": key ?? crypto.randomUUID() }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(typeof error?.detail === "string" ? error.detail : "No pudimos guardar el cambio. Intenta de nuevo.");
  }
  if (body !== undefined) invalidateReportsCache();
  return response.json() as Promise<T>;
}

export const listSuppliers = () => request<Supplier[]>("suppliers");
export const listPurchases = (offset = 0) => request<Purchase[]>(`orders?limit=100&offset=${offset}`);
export const createSupplier = (name: string, contact: string, key: string) => request<Supplier>("suppliers", { name, contact: contact.trim() || null }, key);
export const createPurchase = (supplier_id: string, notes: string, items: { product_id: string; quantity: number; unit_cost: string }[], key: string) => request<Purchase>("orders", { supplier_id, notes: notes.trim() || null, items }, key);
export const receivePurchase = (id: string, items: { item_id: string; quantity: number }[], update_catalog_cost: boolean, key: string) => request<Purchase>(`orders/${id}/receive`, { items, update_catalog_cost }, key);
export const cancelPurchase = (id: string, key: string) => request<Purchase>(`orders/${id}/cancel`, {}, key);
