import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { offlineDb } from "./db";
import { availableLots, lotStockKey, refreshLocalLots, type CachedLotStock } from "./lotStock";
import { claimOfflineSale, markOfflineSaleFailed, queueOfflineSale, reconcileLegacyLots } from "./queue";
import { readLotSnapshot, proposeLots, type Lot } from "@/inventory/lots";

vi.mock("@/inventory/lots", async original => ({ ...await original<object>(), readLotSnapshot: vi.fn() }));
const lot: Lot = { id: "lot-a", product_id: "product", code: "A", is_unknown: false, manufactured_on: "2026-01-01", rotation_on: null, expires_on: null, rotation_label: "consumo_preferente", stock_on_hand: 2, reserved_quantity: 0, available_quantity: 2, stock_conflict: false, date_status: "sin_fecha" };
const cache = (): CachedLotStock => ({ key: lotStockKey("tenant", "branch"), tenant_id: "tenant", branch_id: "branch", snapshot: { branch_id: "branch", captured_at: "2026-01-01T00:00:00Z", lots: [lot], applied_client_uuids: [] }, debits: [] });
const draft = { items: [{ product_id: "product", quantity: 2, lot_allocations: [{ lot_id: "lot-a", quantity: 2 }] }], payments: [{ method: "cash" as const, amount: "20.00" }] };

describe("offline lot inventory", () => {
  beforeEach(async () => { await offlineDb.offline_sales.clear(); await offlineDb.lot_stock.clear(); vi.clearAllMocks(); });
  afterAll(async () => { offlineDb.close(); await Dexie.delete("pos_offline"); });
  it("atomically lets only one local checkout consume the last lot", async () => {
    await offlineDb.lot_stock.put(cache());
    const result = await Promise.allSettled([queueOfflineSale("tenant", draft, undefined, undefined, "branch"), queueOfflineSale("tenant", draft, undefined, undefined, "branch")]);
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await offlineDb.offline_sales.count()).toBe(1);
    expect(availableLots((await offlineDb.lot_stock.get(cache().key))!)[0].available_quantity).toBe(0);
  });
  it("does not reuse another branch's saved lot quantities", async () => {
    await offlineDb.lot_stock.put(cache());
    await expect(queueOfflineSale("tenant", draft, undefined, undefined, "other")).rejects.toThrow("Conéctate");
    expect(await offlineDb.offline_sales.count()).toBe(0);
  });
  it("refresh incorporates acknowledgements once, including after local queue pruning", async () => {
    await offlineDb.lot_stock.put(cache());
    const queued = await queueOfflineSale("tenant", draft, undefined, undefined, "branch");
    await offlineDb.offline_sales.delete(queued.client_uuid);
    vi.mocked(readLotSnapshot).mockResolvedValue({ ...cache().snapshot, lots: [{ ...lot, stock_on_hand: 0, available_quantity: 0 }], applied_client_uuids: [queued.client_uuid] });
    const refreshed = await refreshLocalLots("tenant", "branch");
    expect(refreshed.debits).toHaveLength(0);
    expect(availableLots(refreshed)[0].available_quantity).toBe(0);
    expect(readLotSnapshot).toHaveBeenCalledWith([queued.client_uuid]);
  });
  it("legacy reconciliation preserves the original paid sale and client UUID", async () => {
    const original = { items: [{ product_id: "product", quantity: 2 }], payments: draft.payments };
    const queued = await queueOfflineSale("tenant", original, undefined, undefined, "branch");
    const claimed = await claimOfflineSale("tenant", queued.client_uuid, "test");
    await markOfflineSaleFailed("tenant", queued.client_uuid, claimed!.lease_id!, "Lotes requeridos");
    await reconcileLegacyLots("tenant", queued.client_uuid, { product: draft.items[0].lot_allocations });
    const persisted = await offlineDb.offline_sales.get(queued.client_uuid);
    expect(persisted?.sale).toEqual(original);
    expect(persisted?.lot_reconciliation).toEqual({ product: draft.items[0].lot_allocations });
  });
  it("rebuilds pending debits after clearing the cached catalog", async () => {
    await offlineDb.lot_stock.put(cache());
    const queued = await queueOfflineSale("tenant", draft, undefined, undefined, "branch");
    await offlineDb.lot_stock.clear();
    vi.mocked(readLotSnapshot).mockResolvedValue(cache().snapshot);
    const refreshed = await refreshLocalLots("tenant", "branch");
    expect(readLotSnapshot).toHaveBeenCalledWith([queued.client_uuid]);
    expect(availableLots(refreshed)[0].available_quantity).toBe(0);
    await expect(queueOfflineSale("tenant", draft, undefined, undefined, "branch")).rejects.toThrow();
  });
  it("preserves a newer snapshot when an older request completes later", async () => {
    const current = { ...cache(), snapshot: { ...cache().snapshot, captured_at: "2026-01-02T00:00:00Z", lots: [{ ...lot, available_quantity: 0, stock_on_hand: 0 }] } };
    await offlineDb.lot_stock.put(current);
    vi.mocked(readLotSnapshot).mockResolvedValue(cache().snapshot);
    expect(await refreshLocalLots("tenant", "branch")).toEqual(current);
    expect(await offlineDb.lot_stock.get(current.key)).toEqual(current);
  });
  it("rotation prioritizes dated lots and can span multiple lots", () => {
    expect(proposeLots([{ ...lot, id: "unknown", manufactured_on: null }, { ...lot, available_quantity: 1, expires_on: "2026-01-02" }], 2)).toEqual([{ lot_id: "lot-a", quantity: 1 }, { lot_id: "unknown", quantity: 1 }]);
  });
});
