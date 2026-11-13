import { useAuth } from "@/auth/useAuth";
import { hasPlanFeature } from "@/billing/entitlements";
import { PlanFeatureNotice } from "@/billing/PlanFeatureNotice";
import { SectionSkeleton } from "@/components/ui/section-skeleton";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { OperationsSession, useOnline, useOperationsRequest, type WorkspaceIdentity } from "@/automations/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewEmpty, ViewError } from "@/components/ui/view-states";
import { Meter, StackedBar } from "@/components/visual";
import { PackageCheck } from "lucide-react";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { formatPurchaseTotal } from "@/purchasing/formatPurchaseTotal";
import type { Purchase } from "@/purchasing/api";
import { resolveUserFacingError } from "@/lib/apiError";

type Suggestion = { product_id: string; product_name: string; available_quantity: number; reserved_quantity: number; incoming_quantity: number; low_stock_threshold: number; suggested_quantity: number; unit_cost: string | null; evidence_version: string };
type Supplier = { id: string; name: string };
type DraftRow = Suggestion & { selected: boolean; quantity: string; cost: string };

/**
 * Units on hand, held for orders and already on the way, plus how far
 * available + incoming units get against the configured minimum (marker).
 */
function StockPicture({ row }: { row: Suggestion }) {
  const covered = row.available_quantity + row.incoming_quantity;
  const tone = row.available_quantity <= 0 ? "danger" : covered > row.low_stock_threshold ? "growth" : "warning";
  return <div className="space-y-3">
    <StackedBar label={`Existencias de ${row.product_name}`} segments={[
      { id: "available", label: "Disponibles", value: row.available_quantity, tone: "blue" },
      { id: "reserved", label: "Reservados", value: row.reserved_quantity, tone: "warning" },
      { id: "incoming", label: "Por recibir", value: row.incoming_quantity, tone: "growth" },
    ]} />
    <Meter showLabel label="Disponibles y por recibir frente al mínimo" value={covered} max={row.low_stock_threshold + 1} marker={row.low_stock_threshold} markerLabel={`Mínimo ${row.low_stock_threshold}`} valueLabel={`${covered} de mínimo ${row.low_stock_threshold}`} tone={tone} />
  </div>;
}

export default function ReplenishmentView() {
  useDocumentTitle("Reposición");
  const { state } = useAuth();
  if (!hasPlanFeature(state.status === "authenticated" ? state.commercialAccess : undefined, "advanced_reports")) return <ViewLayout className="space-y-6"><ViewHeader title="Reposición" /><PlanFeatureNotice>Las recomendaciones de reposición están incluidas en Gestión. Puedes seguir consultando existencias en Inventario.</PlanFeatureNotice></ViewLayout>;
  return <OperationsSession>{identity => <ReplenishmentWorkspace identity={identity} />}</OperationsSession>;
}

function ReplenishmentWorkspace({ identity }: { identity: WorkspaceIdentity }) {
  const request = useOperationsRequest("/api/v1", identity);
  const online = useOnline();
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplier, setSupplier] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createdPurchaseId, setCreatedPurchaseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const alive = useRef(true);
  const locked = useRef(false);
  const key = useRef<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [suggestions, providers] = await Promise.all([request<Suggestion[]>("/replenishment"), request<Supplier[]>("/purchasing/suppliers")]);
      if (!alive.current) return;
      setRows(suggestions.map(row => ({ ...row, selected: row.suggested_quantity > 0 && row.unit_cost !== null, quantity: String(row.suggested_quantity), cost: row.unit_cost ?? "" })));
      setSuppliers(providers); setReviewing(false); key.current = null; setError("");
    } catch (e) { if (alive.current) setError(resolveUserFacingError(e, "No pudimos consultar la reposición. Revisa los datos actuales e intenta de nuevo.")); }
    finally { if (alive.current) setLoading(false); }
  }, [request]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  const selected = rows.filter(row => row.selected);
  const total = formatPurchaseTotal(selected.map(row => ({ quantity: Number(row.quantity), unit_cost: row.cost })));
  const valid = selected.length > 0 && !!supplier && selected.every(row => /^\d+$/.test(row.quantity) && Number(row.quantity) > 0 && Number(row.quantity) <= 2147483647 && /^\d+(\.\d{1,2})?$/.test(row.cost));
  const edit = (id: string, changes: Partial<DraftRow>) => { setRows(current => current.map(row => row.product_id === id ? { ...row, ...changes } : row)); setReviewing(false); key.current = null; };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (locked.current || !valid || !online) return;
    if (!reviewing) { setReviewing(true); return; }
    locked.current = true; setBusy(true); setError(""); setNotice(""); setCreatedPurchaseId(null);
    key.current ??= crypto.randomUUID();
    try {
      const purchase = await request<Purchase>("/replenishment/approve-purchase", "POST", { supplier_id: supplier, items: selected.map(row => ({ product_id: row.product_id, quantity: Number(row.quantity), unit_cost: row.cost, evidence_version: row.evidence_version })) }, key.current);
      if (alive.current) { await load(); if (alive.current) { setCreatedPurchaseId(purchase.id); setNotice("Compra pendiente creada. Revisa su recepción en Compras cuando llegue la mercancía."); } }
    } catch (e) { if (alive.current) setError(resolveUserFacingError(e, "No pudimos crear la compra. Revisa las cantidades y el proveedor.")); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  };
  return <ViewLayout className="space-y-6">
    <ViewHeader eyebrow="Abastecimiento" title="Reposición de productos" meta="Revisa existencias, reservas y mercancía pendiente antes de preparar una compra." actions={<Button variant="outline" onClick={() => void load()} disabled={busy || !online || loading}>Actualizar datos</Button>} />
    <p className="max-w-2xl text-sm text-kova-muted">Las cantidades sugeridas consideran tu mínimo y las compras pendientes. Confirma costos y entrega con el proveedor; registra la recepción cuando llegue la mercancía.</p>
    {error && <ViewError message={error} onRetry={() => void load()} retryLabel="Revisar datos actuales" />}
    {notice && <p role="status" className="rounded-xl bg-kova-growth/10 p-4 text-kova-growth-strong">{notice} <Link to={createdPurchaseId ? `/purchasing?purchase_id=${encodeURIComponent(createdPurchaseId)}` : "/purchasing"} className="inline-flex min-h-11 items-center underline">Revisar compra creada</Link></p>}
    {!online && <p role="status">Conéctate para crear o actualizar una compra.</p>}
    {loading ? <SectionSkeleton label="Consultando existencias y compras pendientes…" variant="list" /> : rows.length === 0 ? <ViewEmpty illustration="box" icon={<PackageCheck className="h-6 w-6" />} title="Sin productos debajo del mínimo" body="Configura mínimos de inventario para los productos que quieras supervisar." primaryCta={{ label: "Ir a Catálogo", to: "/catalog" }} /> : <form className="space-y-6" onSubmit={event => void submit(event)}>
      <fieldset disabled={busy || !online || reviewing} className="grid gap-4 md:grid-cols-2"><legend className="sr-only">Productos para reponer</legend>{rows.map(row => <article key={row.product_id} className="min-w-0 space-y-4 rounded-2xl border border-kova-border bg-white p-5"><label className="flex items-start gap-3 font-semibold"><input type="checkbox" className="mt-1" checked={row.selected} onChange={e => edit(row.product_id, { selected: e.target.checked })} />{row.product_name}</label><StockPicture row={row} /><p className="text-sm text-kova-muted">Mínimo: {row.low_stock_threshold}. Sugerencia: {row.suggested_quantity} unidades.</p><div className="grid grid-cols-2 gap-3"><div><Label htmlFor={`qty-${row.product_id}`}>Cantidad</Label><Input id={`qty-${row.product_id}`} inputMode="numeric" value={row.quantity} onChange={e => edit(row.product_id, { quantity: e.target.value })} /></div><div><Label htmlFor={`cost-${row.product_id}`}>Costo unitario MXN</Label><Input id={`cost-${row.product_id}`} inputMode="decimal" placeholder="Captura el costo" value={row.cost} onChange={e => edit(row.product_id, { cost: e.target.value })} /></div></div>{row.unit_cost === null && <p className="text-sm text-kova-muted">No hay costo registrado. Confírmalo con el proveedor antes de seleccionar este producto.</p>}</article>)}</fieldset>
      <div className="max-w-md"><Label htmlFor="restock-supplier">Proveedor</Label><select id="restock-supplier" className="mt-1 min-h-11 w-full rounded-xl border bg-white px-3" value={supplier} disabled={busy || reviewing || !online} onChange={e => { setSupplier(e.target.value); key.current = null; }}><option value="">Elige un proveedor</option>{suppliers.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>{suppliers.length === 0 && <p className="mt-2 text-sm">Agrega un proveedor en <Link to="/purchasing" className="underline">Compras</Link>.</p>}</div>
      {reviewing && <section aria-label="Confirmación de compra" className="rounded-2xl border border-kova-ink p-5"><h2 className="font-semibold">Revisa antes de crear la compra</h2><p className="mt-2">Proveedor: {suppliers.find(row => row.id === supplier)?.name}</p><ul className="mt-3 space-y-2">{selected.map(row => <li key={row.product_id}>{row.quantity} × {row.product_name} · {formatPurchaseTotal([{ quantity: 1, unit_cost: row.cost }])} por unidad</li>)}</ul><p className="mt-4 font-semibold">Total de mercancía: {total}</p><p className="mt-2 text-sm">Se registrará como compra pendiente de recepción.</p></section>}
      {!valid && <p role="status" className="text-sm text-kova-muted">{selected.length === 0 ? "Selecciona los productos que quieres reponer." : !supplier ? "Elige un proveedor para continuar." : "Revisa que cada producto tenga una cantidad entera mayor que cero y un costo válido en MXN."}</p>}
      <div className="flex flex-wrap gap-3">{reviewing && <Button type="button" variant="outline" disabled={busy} onClick={() => setReviewing(false)}>Volver a editar</Button>}<Button disabled={!valid || busy || !online} type="submit">{busy ? "Creando compra…" : reviewing ? "Confirmar y crear compra pendiente" : "Revisar compra"}</Button></div>
    </form>}
  </ViewLayout>;
}
