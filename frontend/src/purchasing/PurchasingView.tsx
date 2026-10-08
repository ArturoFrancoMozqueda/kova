import { LotAllocationEditor } from "@/inventory/LotControls";
import { allocationValid, type LotAllocation } from "@/inventory/lots";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { INVENTORY_ADJUST_PERMISSION, usePermission } from "@/auth/permissions";
import { listProducts } from "@/catalog/api";
import type { Product } from "@/catalog/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { formatMoney } from "@/orders/format";
import { cancelPurchase, createPurchase, createSupplier, listPurchases, listSuppliers, receivePurchase, type Purchase, type Supplier } from "./api";

import { formatPurchaseTotal } from "./formatPurchaseTotal";

const statusLabel = { pending: "Pendiente", partial: "Recibida parcialmente", received: "Recibida", cancelled: "Cancelada" };
type DraftLine = { product_id: string; quantity: number; unit_cost: string };

export default function PurchasingView() {
  useDocumentTitle("Compras y proveedores");
  const allowed = usePermission(INVENTORY_ADJUST_PERMISSION);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [supplierName, setSupplierName] = useState("");
  const [contact, setContact] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ product_id: "", quantity: 1, unit_cost: "0.00" }]);
  const [receiving, setReceiving] = useState<Purchase | null>(null);
  const [receiveLots, setReceiveLots] = useState<Record<string, LotAllocation[]>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [updateCost, setUpdateCost] = useState(false);
  const [offset, setOffset] = useState(0);
  const keys = useRef(new Map<string, string>());
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p, o] = await Promise.all([listSuppliers(), listProducts(), listPurchases(offset)]);
      setSuppliers(s); setProducts(p.filter(item => item.is_active && item.track_inventory)); setPurchases(o);
    } catch (e) { setError(e instanceof Error ? e.message : "No pudimos cargar tus compras."); }
    finally { setLoading(false); }
  }, [offset]);
  useEffect(() => { if (allowed) void load(); }, [allowed, load]);
  useEffect(() => {
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener("online", changed); window.addEventListener("offline", changed);
    return () => { window.removeEventListener("online", changed); window.removeEventListener("offline", changed); };
  }, []);
  async function mutate(payload: unknown, action: (key: string) => Promise<unknown>, done: () => void) {
    if (busy || !navigator.onLine) return;
    const signature = JSON.stringify(payload);
    const key = keys.current.get(signature) ?? crypto.randomUUID();
    keys.current.set(signature, key);
    setBusy(true); setError("");
    try { await action(key); keys.current.delete(signature); done(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "No pudimos guardar el cambio."); }
    finally { setBusy(false); }
  }
  function submitSupplier(event: FormEvent) {
    event.preventDefault();
    void mutate({ supplierName, contact }, key => createSupplier(supplierName, contact, key), () => { setSupplierName(""); setContact(""); });
  }
  function submitPurchase(event: FormEvent) {
    event.preventDefault();
    void mutate({ supplierId, notes, lines }, key => createPurchase(supplierId, notes, lines, key), () => { setNotes(""); setLines([{ product_id: "", quantity: 1, unit_cost: "0.00" }]); });
  }
  const disabled = busy || !online;
  if (!allowed) return <ViewLayout><ViewHeader title="Compras y proveedores" /><p className="mt-6">Necesitas permiso para administrar inventario.</p></ViewLayout>;
  return <ViewLayout className="space-y-6">
    <ViewHeader title="Compras y proveedores" meta="Pide mercancía, recibe lo que llegó y conserva el costo de cada compra." />
    {!online && <p role="status" className="rounded-lg bg-amber-50 p-4">Conéctate a internet para crear compras y recibir mercancía.</p>}
    {error && <div role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{error}<Button variant="outline" className="ml-3" onClick={() => void load()}>Actualizar</Button></div>}
    <div className="grid gap-6 lg:grid-cols-3">
      <Card><CardContent className="space-y-4 pt-6"><h2 className="text-lg font-semibold">Nuevo proveedor</h2>
        <form onSubmit={submitSupplier} className="space-y-3">
          <Label htmlFor="supplier-name">Nombre</Label><Input id="supplier-name" required maxLength={160} value={supplierName} onChange={e => setSupplierName(e.target.value)} />
          <Label htmlFor="supplier-contact">Teléfono o correo (opcional)</Label><Input id="supplier-contact" maxLength={200} value={contact} onChange={e => setContact(e.target.value)} />
          <Button disabled={disabled} type="submit">Guardar proveedor</Button>
        </form>
        {suppliers.length === 0 ? <p className="text-sm text-muted-foreground">Agrega tu primer proveedor para preparar una compra.</p> : <ul className="space-y-2 text-sm">{suppliers.map(s => <li key={s.id}><strong>{s.name}</strong>{s.contact && <p className="text-muted-foreground">{s.contact}</p>}</li>)}</ul>}
      </CardContent></Card>
      <Card className="lg:col-span-2"><CardContent className="space-y-4 pt-6"><h2 className="text-lg font-semibold">Preparar compra</h2>
        <form onSubmit={submitPurchase} className="space-y-4">
          <Label htmlFor="purchase-supplier">Proveedor</Label><Select id="purchase-supplier" required value={supplierId} onChange={e => setSupplierId(e.target.value)}><option value="">Selecciona un proveedor</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          {products.length === 0 && <p className="text-sm">Activa el control de inventario de tus productos en Catálogo para comprarlos.</p>}
          {lines.map((line, index) => <div key={index} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
            <div><Label htmlFor={`purchase-product-${index}`}>Producto</Label><Select id={`purchase-product-${index}`} required value={line.product_id} onChange={e => setLines(rows => rows.map((row, i) => i === index ? { ...row, product_id: e.target.value } : row))}><option value="">Selecciona</option>{products.filter(p => p.id === line.product_id || !lines.some(l => l.product_id === p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></div>
            <div><Label htmlFor={`purchase-qty-${index}`}>Unidades</Label><Input id={`purchase-qty-${index}`} type="number" min={1} max={2147483647} step={1} required value={line.quantity} onChange={e => setLines(rows => rows.map((row, i) => i === index ? { ...row, quantity: Number(e.target.value) } : row))} /></div>
            <div><Label htmlFor={`purchase-cost-${index}`}>Costo unitario MXN</Label><Input id={`purchase-cost-${index}`} type="number" min={0} max="9999999999.99" step="0.01" required value={line.unit_cost} onChange={e => setLines(rows => rows.map((row, i) => i === index ? { ...row, unit_cost: e.target.value } : row))} /></div>
            <Button type="button" variant="ghost" disabled={lines.length === 1 || disabled} onClick={() => setLines(rows => rows.filter((_, i) => i !== index))} aria-label={`Quitar partida ${index + 1}`}>Quitar</Button>
          </div>)}
          <Button type="button" variant="outline" disabled={disabled || lines.length >= 200 || lines.length >= products.length} onClick={() => setLines(rows => [...rows, { product_id: "", quantity: 1, unit_cost: "0.00" }])}>Agregar producto</Button>
          <div><Label htmlFor="purchase-notes">Referencia o notas (opcional)</Label><Input id="purchase-notes" maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} /></div>
          <p>Total de la compra: <strong>{formatPurchaseTotal(lines)}</strong></p>
          <Button type="submit" disabled={disabled || products.length === 0 || suppliers.length === 0}>Crear compra pendiente</Button>
        </form>
      </CardContent></Card>
    </div>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Compras de esta sucursal</h2>
      {loading && <p role="status">Cargando compras…</p>}
      {!loading && purchases.length === 0 && <p>No hay compras en esta página.</p>}
      {purchases.map(purchase => <Card key={purchase.id}><CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{purchase.supplier_name} · {statusLabel[purchase.status]}</h3><span>{new Date(purchase.created_at).toLocaleDateString("es-MX")}</span></div>
        <p className="text-sm text-muted-foreground">Referencia {purchase.id.slice(0, 8)}{purchase.notes && ` · ${purchase.notes}`}</p>
        <ul className="space-y-1 text-sm">{purchase.items.map(item => <li key={item.id}>{item.product_name}: {item.received_quantity} de {item.quantity} recibidas · {formatMoney(item.unit_cost)} por unidad</li>)}</ul>
        {(purchase.status === "pending" || purchase.status === "partial") && <div className="flex flex-wrap gap-2"><Button disabled={disabled} onClick={() => { setReceiving(purchase); setReceiveLots({}); setUpdateCost(false); setQuantities(Object.fromEntries(purchase.items.map(item => [item.id, item.quantity - item.received_quantity]))); }}>Recibir mercancía</Button><Button variant="outline" disabled={disabled} onClick={() => { if (window.confirm("¿Cancelar las unidades pendientes? Las recepciones registradas se conservarán.")) void mutate({ cancel: purchase.id }, key => cancelPurchase(purchase.id, key), () => { if (receiving?.id === purchase.id) setReceiving(null); }); }}>Cancelar pendiente</Button></div>}
      </CardContent></Card>)}
      <div className="flex gap-3"><Button variant="outline" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 100))}>Anteriores</Button><Button variant="outline" disabled={loading || purchases.length < 100} onClick={() => setOffset(value => value + 100)}>Más compras</Button></div>
    </section>
    {receiving && <Card><CardContent className="space-y-4 pt-6"><h2 className="text-lg font-semibold">Recibir compra de {receiving.supplier_name}</h2><p>Registra únicamente las unidades que llegaron. El resto quedará pendiente.</p>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (receiving.items.some(item => (quantities[item.id] ?? 0) > 0 && products.find(product => product.id === item.product_id)?.track_lots && !allocationValid(receiveLots[item.id] ?? [], quantities[item.id]))) { setError("Asigna a sus lotes todas las unidades a recibir."); return; } const items = receiving.items.filter(item => (quantities[item.id] ?? 0) > 0).map(item => ({ item_id: item.id, quantity: quantities[item.id], ...(products.find(product => product.id === item.product_id)?.track_lots ? { lot_allocations: receiveLots[item.id] ?? [] } : {}) })); void mutate({ receive: receiving.id, items, updateCost }, key => receivePurchase(receiving.id, items, updateCost, key), () => setReceiving(null)); }}>
        {receiving.items.filter(item => item.quantity > item.received_quantity).map(item => <div key={item.id}><Label htmlFor={`receive-${item.id}`}>{item.product_name} · pendientes {item.quantity - item.received_quantity}</Label><Input id={`receive-${item.id}`} type="number" required min={0} max={item.quantity - item.received_quantity} step={1} value={quantities[item.id] ?? 0} onChange={e => setQuantities(rows => ({ ...rows, [item.id]: Number(e.target.value) }))} />{products.find(product => product.id === item.product_id)?.track_lots && (quantities[item.id] ?? 0) > 0 && <LotAllocationEditor productId={item.product_id} quantity={quantities[item.id] ?? 0} value={receiveLots[item.id] ?? []} onChange={parts => setReceiveLots(previous => ({ ...previous, [item.id]: parts }))} incoming canCreate />}</div>)}
        <label className="flex items-start gap-3"><input type="checkbox" checked={updateCost} onChange={e => setUpdateCost(e.target.checked)} /><span>Actualizar el costo del catálogo con el costo unitario de esta compra. Las ventas anteriores conservan su costo registrado.</span></label>
        <div className="flex gap-3"><Button disabled={disabled || !Object.values(quantities).some(value => value > 0)} type="submit">Confirmar recepción</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setReceiving(null)}>Cerrar</Button></div>
      </form>
    </CardContent></Card>}
  </ViewLayout>;
}
