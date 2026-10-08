import { csrfHeaders } from "@/lib/csrf";

export type LotAllocation = { lot_id: string; quantity: number };
export type Lot = {
  id: string; product_id: string; code: string; is_unknown: boolean;
  manufactured_on: string | null; rotation_on: string | null; expires_on: string | null;
  rotation_label: "consumo_preferente" | "fecha_objetivo";
  stock_on_hand: number; reserved_quantity: number; available_quantity: number;
  stock_conflict: boolean; date_status: "sin_fecha" | "vigente" | "proximo" | "vencido";
};
export type LotWrite = Pick<Lot, "code" | "manufactured_on" | "rotation_on" | "expires_on">;
export type LotSnapshot = { branch_id: string; captured_at: string; lots: Lot[]; applied_client_uuids: string[] };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/inventory/${path}`, {
    ...init, headers: { "Content-Type": "application/json", ...csrfHeaders(init?.method), ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string | { message?: string } };
    throw new Error(typeof body.detail === "string" ? body.detail : body.detail?.message ?? "No pudimos cargar los lotes. Inténtalo de nuevo.");
  }
  return response.json() as Promise<T>;
}
export function listLots(productId: string, branchId?: string) {
  return request<Lot[]>(`products/${productId}/lots`, branchId ? { headers: { "X-Kova-Branch": branchId } } : undefined);
}
export function readLotSnapshot(ids: string[] = []) {
  return request<LotSnapshot>("lots/snapshot", { method: "POST", body: JSON.stringify({ client_uuids: ids }) });
}

export function saveLot(productId: string, body: LotWrite, key: string, lotId?: string) {
  return request<Lot>(`products/${productId}/lots${lotId ? `/${lotId}` : ""}`, {
    method: lotId ? "PUT" : "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(body),
  });
}
export function suggestDates(productId: string, manufacturedOn: string) {
  return request<LotWrite>(`products/${productId}/lots/suggestions?manufactured_on=${encodeURIComponent(manufacturedOn)}`);
}
export function classifyLot(productId: string, source: string, destination: string, quantity: number, reason: string, key: string) {
  return request(`products/${productId}/lots/reclassify`, { method: "POST", headers: { "Idempotency-Key": key },
    body: JSON.stringify({ source_lot_id: source, destination_lot_id: destination, quantity, reason }) });
}
export function proposeLots(rows: Lot[], quantity: number): LotAllocation[] {
  const sorted = [...rows].sort((a, b) => {
    const dateA = a.expires_on ?? a.rotation_on ?? a.manufactured_on ?? "9999-12-31";
    const dateB = b.expires_on ?? b.rotation_on ?? b.manufactured_on ?? "9999-12-31";
    return dateA.localeCompare(dateB) || (a.manufactured_on ?? "9999-12-31").localeCompare(b.manufactured_on ?? "9999-12-31") || a.id.localeCompare(b.id);
  });
  const result: LotAllocation[] = [];
  for (const lot of sorted) {
    const take = Math.min(quantity, lot.available_quantity);
    if (take > 0) { result.push({ lot_id: lot.id, quantity: take }); quantity -= take; }
    if (!quantity) break;
  }
  return result;
}
export function allocationValid(parts: LotAllocation[], quantity: number) {
  return parts.every(p => Number.isSafeInteger(p.quantity) && p.quantity > 0) && parts.reduce((sum, p) => sum + p.quantity, 0) === quantity;
}

export function formatLotDate(value: string | null, empty = "Sin fecha") {
  return value ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)) : empty;
}
