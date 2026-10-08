import { useState } from "react";
import { Link } from "react-router-dom";
import { usePermission, INVENTORY_ADJUST_PERMISSION } from "@/auth/permissions";
import { LotAllocationEditor } from "@/inventory/LotControls";
import { allocationValid, type LotAllocation } from "@/inventory/lots";
import { Button } from "@/components/ui/button";
import { reconcileLegacyLots } from "./queue";
import type { OfflineSaleQueueItem } from "./types";

export function LotConflictRecovery({ row, tenantId, onRetry }: { row: OfflineSaleQueueItem; tenantId: string; onRetry: () => Promise<unknown> }) {
  const canAdjust = usePermission(INVENTORY_ADJUST_PERMISSION);
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<Record<string, LotAllocation[]>>(row.lot_reconciliation ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const original = row.sale.items.filter(item => item.lot_allocations === undefined);
  const quantities = new Map<string, number>();
  original.forEach(item => quantities.set(item.product_id, (quantities.get(item.product_id) ?? 0) + item.quantity));
  const isLotConflict = row.sale.items.some(item => item.lot_allocations) || row.last_error_code?.startsWith("LOT_") || row.last_error?.includes("LOT_");
  if (!isLotConflict) return null;
  const save = async () => {
    if (busy) return;
    if (!Object.entries(parts).length || Object.entries(parts).some(([product, allocations]) => !allocationValid(allocations, quantities.get(product) ?? 0))) { setError("Completa las unidades cobradas para cada producto a conciliar."); return; }
    setBusy(true); setError("");
    try { await reconcileLegacyLots(tenantId, row.client_uuid, parts); await onRetry(); setOpen(false); }
    catch (err) { setError(err instanceof Error ? err.message : "No pudimos conciliar la venta."); }
    finally { setBusy(false); }
  };
  return <div className="mt-3 space-y-3">
    <p className="text-sm">La venta cobrada sigue guardada. Sus lotes no se reemplazarán al reintentar.</p>
    {row.sale.items.map(item => <Link key={item.product_id} className="block min-h-11 text-sm underline" to={`/inventory?product=${encodeURIComponent(item.product_id)}`}>Revisar existencias y lotes del producto</Link>)}
    {canAdjust && original.length > 0 && <Button type="button" variant="outline" onClick={() => setOpen(!open)}>Conciliar lotes de una versión anterior</Button>}
    {open && <div className="space-y-3">{[...quantities].map(([productId, quantity]) => <details key={productId}><summary className="min-h-11 cursor-pointer">Asignar {quantity} unidades cobradas</summary><LotAllocationEditor productId={productId} branchId={row.branch_id ?? tenantId} quantity={quantity} value={parts[productId] ?? []} onChange={allocations => setParts(previous => ({ ...previous, [productId]: allocations }))} /></details>)}
      <p className="text-xs">Registra únicamente el lote realmente entregado. Esta decisión quedará en auditoría y conservará el comprobante original.</p>
      {error && <p role="alert">{error}</p>}
      <Button type="button" disabled={busy} onClick={() => void save()}>Confirmar conciliación y reintentar</Button>
    </div>}
  </div>;
}
