import { useTaskMeasurement } from "@/telemetry/useTaskMeasurement";
import { formatPurchaseQuantity, stockUnitOf } from "@/catalog/units";
import { useOptionalAuth } from "@/auth/useAuth";
import { hasPlanFeature } from "@/billing/entitlements";
import { PlanFeatureNotice } from "@/billing/PlanFeatureNotice";
import { LotAllocationEditor } from "@/inventory/LotControls";
import { allocationValid, type LotAllocation } from "@/inventory/lots";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { INVENTORY_ADJUST_PERMISSION, usePermission } from "@/auth/permissions";
import { listProducts } from "@/catalog/api";
import type { Product } from "@/catalog/types";
import { Button } from "@/components/ui/button";
import { semanticIcon } from "@/components/ui/semantic-icons";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewEmpty, ViewPermissionDenied } from "@/components/ui/view-states";
import { Truck } from "lucide-react";
import { Meter, type VisualTone } from "@/components/visual";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { formatMoney } from "@/orders/format";
import { cancelPurchase, createPurchase, createSupplier, listPurchases, listSuppliers, receivePurchase, type Purchase, type Supplier } from "./api";

import { formatPurchaseTotal } from "./formatPurchaseTotal";
import { buildReceiveLines, openLines, pendingUnits, receiveDifference } from "./receiveDifferences";
import { resolveUserFacingError } from "@/lib/apiError";

function PurchaseStatusIcon({ status }: { status: string }) {
  const { icon: Icon, tone } = semanticIcon("purchase", status);
  return <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tone === "success" ? "bg-kova-growth/15 text-kova-growth-strong" : tone === "warning" ? "bg-warning/20 text-warning-foreground" : "bg-kova-mist text-kova-ink"}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>;
}
function receiptTone(status: Purchase["status"], received: number, ordered: number): VisualTone {
  if (status === "cancelled") return "muted";
  return ordered > 0 && received >= ordered ? "growth" : "blue";
}

/** Whole-purchase receipt progress: units that arrived vs. units ordered. */
function PurchaseReceiptProgress({ purchase }: { purchase: Purchase }) {
  // A line closed short expects only what arrived; extra units do not count as progress.
  const ordered = purchase.items.reduce((sum, item) => sum + (item.closed_at ? Math.min(item.received_quantity, item.quantity) : item.quantity), 0);
  const received = purchase.items.reduce((sum, item) => sum + Math.min(item.received_quantity, item.quantity), 0);
  if (ordered <= 0) return null;
  return <Meter showLabel label={purchase.status === "cancelled" ? "Recibido antes de cancelar" : "Avance de la recepción"} value={received} max={ordered} valueLabel={`${received} de ${ordered} unidades`} tone={receiptTone(purchase.status, received, ordered)} />;
}
const statusLabel = { pending: "Pendiente", partial: "Recibida parcialmente", received: "Recibida", cancelled: "Cancelada" };
const purchaseDate = (value: string) => new Date(value).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
type DraftLine = { product_id: string; quantity: number; unit_cost: string };

export default function PurchasingView() {
  useDocumentTitle("Compras y proveedores");
  const allowed = usePermission(INVENTORY_ADJUST_PERMISSION);
  const auth = useOptionalAuth();
  const canCreate = hasPlanFeature(auth?.state.status === "authenticated" ? auth.state.commercialAccess : undefined, "purchasing");
  const [searchParams] = useSearchParams();
  const linkedPurchaseId = searchParams.get("purchase_id");
  const linkedPurchaseRef = useRef<HTMLDivElement>(null);
  const [activeSetup, setActiveSetup] = useState<"purchase" | "supplier" | null>(null);
  const purchasePanelId = useId();
  const supplierPanelId = useId();
  const setupPanelRef = useRef<HTMLDivElement>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [supplierName, setSupplierName] = useState("");
  const [contact, setContact] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ product_id: "", quantity: 1, unit_cost: "0.00" }]);
  const purchaseUnitFor = (productId: string) => products.find(product => product.id === productId)?.purchase_unit_label ?? null;
  const measurementOwner = auth?.state.status === "authenticated" && auth.state.user?.id
    ? { tenantId: auth.state.tenantId, userId: auth.state.user.id } : null;
  const receiptMeasurement = useTaskMeasurement("purchase_receipt", measurementOwner ? `${measurementOwner.tenantId}:${measurementOwner.userId}` : "", measurementOwner);
  const [receiving, setReceiving] = useState<Purchase | null>(null);
  const [receiveLots, setReceiveLots] = useState<Record<string, LotAllocation[]>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  // Lines the person closes short, and the reason for any difference.
  const [closures, setClosures] = useState<Record<string, boolean>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const draftFor = (itemId: string) => ({ quantity: quantities[itemId] ?? 0, closeRemaining: closures[itemId] ?? false, reason: reasons[itemId] ?? "" });
  const [updateCost, setUpdateCost] = useState(false);
  const [offset, setOffset] = useState(0);
  const keys = useRef(new Map<string, string>());
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p, o] = await Promise.all([listSuppliers(), listProducts(), listPurchases(offset)]);
      setSuppliers(s); setProducts(p.filter(item => item.is_active && item.track_inventory)); setPurchases(o);
      setError("");
    } catch (e) { setError(resolveUserFacingError(e, "No pudimos cargar tus compras. Actualiza para volver a consultar.")); }
    finally { setLoading(false); }
  }, [offset]);
  useEffect(() => { if (allowed) void load(); }, [allowed, load]);
  useEffect(() => {
    if (!allowed || loading || !linkedPurchaseId) return;
    const target = linkedPurchaseRef.current;
    if (target) {
      target.focus();
      target.scrollIntoView?.({ block: "nearest" });
    }
  }, [allowed, loading, linkedPurchaseId, purchases]);
  useEffect(() => {
    if (activeSetup && setupPanelRef.current) {
      setupPanelRef.current.focus();
      setupPanelRef.current.scrollIntoView?.({ block: "nearest" });
    }
  }, [activeSetup]);
  useEffect(() => {
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener("online", changed); window.addEventListener("offline", changed);
    return () => { window.removeEventListener("online", changed); window.removeEventListener("offline", changed); };
  }, []);
  async function mutate<T>(payload: unknown, action: (key: string) => Promise<T>, done: (result: T) => void) {
    if (busy || !navigator.onLine) return;
    const signature = JSON.stringify(payload);
    const key = keys.current.get(signature) ?? crypto.randomUUID();
    keys.current.set(signature, key);
    const isReceipt = typeof payload === "object" && payload !== null && "receive" in payload;
    if (isReceipt) { receiptMeasurement.start(); receiptMeasurement.pause(); }
    setBusy(true); setError(""); setNotice("");
    try { const result = await action(key); keys.current.delete(signature); if (isReceipt) receiptMeasurement.finish("completed"); done(result); await load(); }
    catch (e) { if (isReceipt) receiptMeasurement.finish("failed"); setError(resolveUserFacingError(e, "No pudimos guardar el cambio. Revisa los datos e intenta de nuevo.")); }
    finally { setBusy(false); }
  }
  function submitSupplier(event: FormEvent) {
    event.preventDefault();
    if (!canCreate) return;
    void mutate({ supplierName, contact }, key => createSupplier(supplierName, contact, key), supplier => {
      setSuppliers(current => [...current.filter(row => row.id !== supplier.id), supplier]);
      setSupplierId(supplier.id); setSupplierName(""); setContact(""); setActiveSetup("purchase");
      setNotice(`${supplier.name} está listo para tu compra. Conservamos los productos y las notas que habías capturado.`);
    });
  }
  function submitPurchase(event: FormEvent) {
    event.preventDefault();
    if (!canCreate) return;
    void mutate({ supplierId, notes, lines }, key => createPurchase(supplierId, notes, lines, key), () => { setNotes(""); setLines([{ product_id: "", quantity: 1, unit_cost: "0.00" }]); });
  }
  const disabled = busy || !online;
  if (!allowed) return <ViewPermissionDenied title="Compras y proveedores" description="Necesitas permiso para administrar inventario." />;
  return <ViewLayout className="space-y-6">
    <ViewHeader title="Compras y proveedores" meta="Pide mercancía, recibe lo que llegó y conserva el costo de cada compra." actions={<div className="flex flex-wrap gap-2">
      <Button type="button" disabled={!canCreate} aria-expanded={activeSetup === "purchase"} aria-controls={purchasePanelId} onClick={() => setActiveSetup(current => current === "purchase" ? null : "purchase")}>Preparar compra</Button>
      <Button type="button" variant="outline" disabled={!canCreate} aria-expanded={activeSetup === "supplier"} aria-controls={supplierPanelId} onClick={() => setActiveSetup(current => current === "supplier" ? null : "supplier")}>Nuevo proveedor</Button>
    </div>} />
    {!canCreate && <PlanFeatureNotice /> }
    {!online && <p role="status" className="rounded-kova-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">Conéctate a internet para crear compras y recibir mercancía.</p>}
    {notice && <p role="status" className="rounded-kova-md bg-kova-growth/10 p-4 text-sm text-kova-growth-strong">{notice}</p>}
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-kova-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive-strong"><span>{error}</span><Button variant="outline" size="sm" onClick={() => void load()}>Actualizar</Button></div>}
    <section className="space-y-3"><h2 className="text-lg font-semibold">Compras de esta sucursal</h2>
      {linkedPurchaseId && !loading && !error && (
        <p role="status" className="rounded-kova-md border border-kova-blue/20 bg-kova-blue/5 p-4 text-sm">
          {purchases.some(purchase => purchase.id === linkedPurchaseId)
            ? "Estás revisando la compra del enlace. Confirma la recepción sólo cuando llegue la mercancía."
            : "La compra del enlace no aparece en esta página de la sucursal actual. Revisa otras páginas o verifica la sucursal; no se realizó ningún cambio."}
        </p>
      )}
      {loading && <div aria-busy="true" className="space-y-3"><p role="status" className="sr-only">Cargando compras…</p>{[0, 1].map(i => <Card key={i}><CardContent className="space-y-3 pt-6"><Skeleton className="h-5 w-56" /><Skeleton className="h-4 w-72" /></CardContent></Card>)}</div>}
      {!loading && !error && purchases.length === 0 && <ViewEmpty illustration="truck" icon={<Truck className="h-6 w-6" />} title="No hay compras en esta página." body="Cuando prepares una compra, aquí podrás recibir la mercancía que llegó y ver lo pendiente." />}
      {purchases.map(purchase => <Card key={purchase.id} ref={purchase.id === linkedPurchaseId ? linkedPurchaseRef : undefined} tabIndex={purchase.id === linkedPurchaseId ? -1 : undefined} role="region" aria-label={`Compra de ${purchase.supplier_name} · ${purchaseDate(purchase.created_at)}`} className={purchase.id === linkedPurchaseId ? "border-kova-blue ring-2 ring-kova-blue/20 focus:outline-none" : undefined}><CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap justify-between gap-2"><h3 className="inline-flex items-center gap-2 font-semibold"><PurchaseStatusIcon status={purchase.status} />{purchase.supplier_name} · {statusLabel[purchase.status]}</h3><span className="text-sm text-muted-foreground">{purchaseDate(purchase.created_at)}</span></div>
        {purchase.notes && <p className="text-sm text-muted-foreground">{purchase.notes}</p>}
        <PurchaseReceiptProgress purchase={purchase} />
        <ul className="space-y-2.5 text-sm">{purchase.items.map(item => <li key={item.id} className="space-y-1"><p>{item.product_name}: <span className="tabular-nums">{item.received_quantity} de {item.quantity} {item.purchase_unit_label ? `× ${item.purchase_unit_label}` : ""} recibidas · {formatMoney(item.unit_cost)} por {item.purchase_unit_label ?? "unidad"}</span></p><Meter size="sm" label={`${item.product_name}, unidades recibidas`} value={Math.min(item.received_quantity, item.quantity)} max={item.quantity} valueLabel={`${item.received_quantity} de ${item.quantity}`} tone={item.closed_at ? "muted" : receiptTone(purchase.status, item.received_quantity, item.quantity)} />{item.difference_reason && <p className="text-muted-foreground">{item.closed_at ? `Cerrada con ${item.quantity - item.received_quantity} sin llegar` : `Llegaron ${item.received_quantity - item.quantity} de más`} · {item.difference_reason}</p>}</li>)}</ul>
        {(purchase.status === "pending" || purchase.status === "partial") && <div className="flex flex-wrap gap-2"><Button disabled={disabled} onClick={() => { receiptMeasurement.finish("cancelled"); receiptMeasurement.start(); setReceiving(purchase); setReceiveLots({}); setUpdateCost(false); setClosures({}); setReasons({}); setQuantities(Object.fromEntries(openLines(purchase.items).map(item => [item.id, pendingUnits(item)]))); }}>Recibir mercancía</Button><Button variant="outline" disabled={disabled} onClick={() => { if (window.confirm("¿Cancelar las unidades pendientes? Las recepciones registradas se conservarán.")) void mutate({ cancel: purchase.id }, key => cancelPurchase(purchase.id, key), () => { if (receiving?.id === purchase.id) setReceiving(null); }); }}>Cancelar pendiente</Button></div>}
      </CardContent></Card>)}
      <div className="flex gap-3"><Button variant="outline" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 100))}>Anteriores</Button><Button variant="outline" disabled={loading || purchases.length < 100} onClick={() => setOffset(value => value + 100)}>Más compras</Button></div>
    </section>
    {receiving && <Card><CardContent className="space-y-4 pt-6"><h2 className="text-lg font-semibold">Recibir compra de {receiving.supplier_name}</h2><p>Registra las unidades que llegaron. Si llegó de más o el resto ya no llegará, escribe el motivo; queda como evidencia en la compra.</p>
      <form className="space-y-4" onChangeCapture={() => receiptMeasurement.start()} onSubmit={e => { e.preventDefault(); if (receiving.items.some(item => (quantities[item.id] ?? 0) > 0 && products.find(product => product.id === item.product_id)?.track_lots && !allocationValid(receiveLots[item.id] ?? [], quantities[item.id] * (item.units_per_purchase ?? 1)))) { setError("Asigna a sus lotes todas las unidades a recibir."); return; } const { lines, missingReason } = buildReceiveLines(receiving.items, Object.fromEntries(openLines(receiving.items).map(item => [item.id, draftFor(item.id)]))); if (missingReason) { setError("Escribe el motivo de cada diferencia: lo que llegó de más o lo que ya no llegará."); return; } const items = lines.map(line => { const item = receiving.items.find(row => row.id === line.item_id)!; return { ...line, ...(line.quantity > 0 && products.find(product => product.id === item.product_id)?.track_lots ? { lot_allocations: receiveLots[item.id] ?? [] } : {}) }; }); void mutate({ receive: receiving.id, items, updateCost }, key => receivePurchase(receiving.id, items, updateCost, key), () => setReceiving(null)); }}>
        {openLines(receiving.items).map(item => { const pending = pendingUnits(item); const draft = draftFor(item.id); const difference = receiveDifference(item, draft); return <div key={item.id} className="space-y-2"><Label htmlFor={`receive-${item.id}`}>{item.product_name} · pendientes {item.purchase_unit_label ? formatPurchaseQuantity(pending, item.purchase_unit_label, item.units_per_purchase, stockUnitOf(products.find(product => product.id === item.product_id))) : pending}</Label><Input id={`receive-${item.id}`} type="number" required min={0} max={2147483647} step={1} value={quantities[item.id] ?? 0} onChange={e => setQuantities(rows => ({ ...rows, [item.id]: Number(e.target.value) }))} />
          {draft.quantity < pending && <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={draft.closeRemaining} onChange={e => setClosures(rows => ({ ...rows, [item.id]: e.target.checked }))} /><span>Ya no llegará el resto: cerrar la partida con {pending - draft.quantity} sin llegar</span></label>}
          {difference && <div className="space-y-1"><Label htmlFor={`receive-reason-${item.id}`}>{difference === "over" ? `Motivo de las ${draft.quantity - pending} de más` : "Motivo del faltante"}</Label><Input id={`receive-reason-${item.id}`} required maxLength={200} placeholder={difference === "over" ? "Ej. bonificación del proveedor" : "Ej. el proveedor no tenía existencias"} value={reasons[item.id] ?? ""} onChange={e => setReasons(rows => ({ ...rows, [item.id]: e.target.value }))} /></div>}
{products.find(product => product.id === item.product_id)?.track_lots && (quantities[item.id] ?? 0) > 0 && <LotAllocationEditor productId={item.product_id} quantity={(quantities[item.id] ?? 0) * (item.units_per_purchase ?? 1)} value={receiveLots[item.id] ?? []} onChange={parts => setReceiveLots(previous => ({ ...previous, [item.id]: parts }))} incoming canCreate />}</div>; })}
        <label className="flex items-start gap-3"><input type="checkbox" checked={updateCost} onChange={e => setUpdateCost(e.target.checked)} /><span>Actualizar el costo del catálogo con el costo unitario de esta compra. Las ventas anteriores conservan su costo registrado.</span></label>
        <div className="flex gap-3"><Button disabled={disabled || buildReceiveLines(receiving.items, Object.fromEntries(openLines(receiving.items).map(item => [item.id, draftFor(item.id)]))).lines.length === 0} type="submit">Confirmar recepción</Button><Button type="button" variant="outline" disabled={busy} onClick={() => { receiptMeasurement.finish("cancelled"); setReceiving(null); }}>Cerrar</Button></div>
      </form>
    </CardContent></Card>}
    {canCreate && activeSetup === "supplier" && <Card id={supplierPanelId} ref={setupPanelRef} tabIndex={-1} role="region" aria-label="Registrar proveedor" className="max-w-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue/30"><CardContent className="space-y-4 pt-6"><h2 className="text-lg font-semibold">Nuevo proveedor</h2>
        <form onSubmit={submitSupplier} className="space-y-3">
          <Label htmlFor="supplier-name">Nombre</Label><Input id="supplier-name" required maxLength={160} value={supplierName} onChange={e => setSupplierName(e.target.value)} />
          <Label htmlFor="supplier-contact">Teléfono o correo (opcional)</Label><Input id="supplier-contact" maxLength={200} value={contact} onChange={e => setContact(e.target.value)} />
          <Button disabled={disabled} type="submit">Guardar proveedor</Button>
        </form>
        {suppliers.length === 0 ? (
          loading ? <p role="status" className="text-sm text-muted-foreground">Cargando proveedores…</p>
            : !error ? <p className="text-sm text-muted-foreground">Agrega tu primer proveedor para preparar una compra.</p> : null
        ) : <ul className="space-y-2 text-sm">{suppliers.map(s => <li key={s.id}><strong>{s.name}</strong>{s.contact && <p className="text-muted-foreground">{s.contact}</p>}</li>)}</ul>}
    </CardContent></Card>}
    {canCreate && activeSetup === "purchase" && <Card id={purchasePanelId} ref={setupPanelRef} tabIndex={-1} role="region" aria-label="Preparar compra pendiente" className="focus:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue/30"><CardContent className="space-y-4 pt-6"><h2 className="text-lg font-semibold">Preparar compra</h2>
        <form onSubmit={submitPurchase} className="space-y-4">
          <Label htmlFor="purchase-supplier">Proveedor</Label><Select id="purchase-supplier" required value={supplierId} onChange={e => setSupplierId(e.target.value)}><option value="">Selecciona un proveedor</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <Button type="button" variant="link" className="px-0" disabled={disabled} onClick={() => setActiveSetup("supplier")}>Registrar proveedor sin perder la compra</Button>
          {products.length === 0 && (
            loading ? <p role="status" className="text-sm text-muted-foreground">Cargando productos con inventario…</p>
              : !error ? <p className="text-sm">Activa el control de inventario de tus productos en Catálogo para comprarlos.</p> : null
          )}
          {lines.map((line, index) => <div key={index} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
            <div><Label htmlFor={`purchase-product-${index}`}>Producto</Label><Select id={`purchase-product-${index}`} required value={line.product_id} onChange={e => setLines(rows => rows.map((row, i) => i === index ? { ...row, product_id: e.target.value } : row))}><option value="">Selecciona</option>{products.filter(p => p.id === line.product_id || !lines.some(l => l.product_id === p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></div>
            <div><Label htmlFor={`purchase-qty-${index}`}>{purchaseUnitFor(line.product_id) ? `Cantidad (${purchaseUnitFor(line.product_id)})` : "Unidades"}</Label><Input id={`purchase-qty-${index}`} type="number" min={1} max={2147483647} step={1} required value={line.quantity} onChange={e => setLines(rows => rows.map((row, i) => i === index ? { ...row, quantity: Number(e.target.value) } : row))} /></div>
            <div><Label htmlFor={`purchase-cost-${index}`}>{purchaseUnitFor(line.product_id) ? `Costo por ${purchaseUnitFor(line.product_id)} MXN` : "Costo unitario MXN"}</Label><Input id={`purchase-cost-${index}`} type="number" min={0} max="9999999999.99" step="0.01" required value={line.unit_cost} onChange={e => setLines(rows => rows.map((row, i) => i === index ? { ...row, unit_cost: e.target.value } : row))} /></div>
            <Button type="button" variant="ghost" disabled={lines.length === 1 || disabled} onClick={() => setLines(rows => rows.filter((_, i) => i !== index))} aria-label={`Quitar partida ${index + 1}`}>Quitar</Button>
          </div>)}
          <Button type="button" variant="outline" disabled={disabled || lines.length >= 200 || lines.length >= products.length} onClick={() => setLines(rows => [...rows, { product_id: "", quantity: 1, unit_cost: "0.00" }])}>Agregar producto</Button>
          <div><Label htmlFor="purchase-notes">Referencia o notas (opcional)</Label><Input id="purchase-notes" maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} /></div>
          <p className="flex items-baseline justify-between gap-3 border-t pt-4 text-sm text-muted-foreground">Total de la compra <strong className="text-lg text-kova-ink tabular-nums">{formatPurchaseTotal(lines)}</strong></p>
          <Button type="submit" disabled={disabled || products.length === 0 || suppliers.length === 0}>Crear compra pendiente</Button>
        </form>
    </CardContent></Card>}
  </ViewLayout>;
}
