import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { OperationsSession, useOnline, useOperationsRequest, type WorkspaceIdentity } from "@/automations/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewError } from "@/components/ui/view-states";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { formatPurchaseTotal } from "@/purchasing/formatPurchaseTotal";
import type { Purchase } from "@/purchasing/api";

type Suggestion = { product_id: string; product_name: string; available_quantity: number; reserved_quantity: number; incoming_quantity: number; low_stock_threshold: number; suggested_quantity: number; unit_cost: string | null; evidence_version: string };
type Supplier = { id: string; name: string };
type DraftRow = Suggestion & { selected: boolean; quantity: string; cost: string };

export default function ReplenishmentView() {
  useDocumentTitle("Reposición");
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
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "No pudimos consultar la reposición."); }
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
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "No pudimos crear la compra."); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  };
  return <ViewLayout className="space-y-6">
    <ViewHeader eyebrow="Abastecimiento" title="Reponer con evidencia" meta="Revisa existencias, reservas y mercancía pendiente antes de preparar una compra." actions={<Button variant="outline" onClick={() => void load()} disabled={busy || !online || loading}>Actualizar datos</Button>} />
    <p className="max-w-2xl text-sm text-kova-muted">La sugerencia busca superar el mínimo configurado y descuenta compras pendientes. Revisa demanda, caducidad y tiempos del proveedor. Crear la compra no recibe mercancía, envía mensajes ni mueve dinero.</p>
    {error && <ViewError message={error} onRetry={() => void load()} retryLabel="Revisar datos actuales" />}
    {notice && <p role="status" className="rounded-xl bg-kova-growth/10 p-4 text-kova-growth-strong">{notice} <Link to={createdPurchaseId ? `/purchasing?purchase_id=${encodeURIComponent(createdPurchaseId)}` : "/purchasing"} className="inline-flex min-h-11 items-center underline">Revisar compra creada</Link></p>}
    {!online && <p role="status">Conéctate para crear o actualizar una compra.</p>}
    {loading ? <p role="status">Consultando existencias y compras pendientes…</p> : rows.length === 0 ? <section className="rounded-2xl border bg-white p-7"><h2 className="font-semibold">Sin productos debajo del mínimo</h2><p className="mt-2 text-sm text-kova-muted">Configura mínimos de inventario para los productos que quieras supervisar.</p></section> : <form className="space-y-6" onSubmit={event => void submit(event)}>
      <fieldset disabled={busy || !online || reviewing} className="grid gap-4 md:grid-cols-2"><legend className="sr-only">Productos para reponer</legend>{rows.map(row => <article key={row.product_id} className="min-w-0 space-y-4 rounded-2xl border border-kova-border bg-white p-5"><label className="flex items-start gap-3 font-semibold"><input type="checkbox" className="mt-1" checked={row.selected} onChange={e => edit(row.product_id, { selected: e.target.checked })} />{row.product_name}</label><dl className="grid grid-cols-3 gap-2 text-sm"><div><dt className="text-kova-muted">Disponibles</dt><dd>{row.available_quantity}</dd></div><div><dt className="text-kova-muted">Reservados</dt><dd>{row.reserved_quantity}</dd></div><div><dt className="text-kova-muted">Por recibir</dt><dd>{row.incoming_quantity}</dd></div></dl><p className="text-sm text-kova-muted">Mínimo: {row.low_stock_threshold}. Sugerencia: {row.suggested_quantity} unidades.</p><div className="grid grid-cols-2 gap-3"><div><Label htmlFor={`qty-${row.product_id}`}>Cantidad</Label><Input id={`qty-${row.product_id}`} inputMode="numeric" value={row.quantity} onChange={e => edit(row.product_id, { quantity: e.target.value })} /></div><div><Label htmlFor={`cost-${row.product_id}`}>Costo unitario MXN</Label><Input id={`cost-${row.product_id}`} inputMode="decimal" placeholder="Captura el costo" value={row.cost} onChange={e => edit(row.product_id, { cost: e.target.value })} /></div></div>{row.unit_cost === null && <p className="text-sm text-kova-muted">No hay costo registrado. Confírmalo con el proveedor antes de seleccionar este producto.</p>}</article>)}</fieldset>
      <div className="max-w-md"><Label htmlFor="restock-supplier">Proveedor</Label><select id="restock-supplier" className="mt-1 min-h-11 w-full rounded-xl border bg-white px-3" value={supplier} disabled={busy || reviewing || !online} onChange={e => { setSupplier(e.target.value); key.current = null; }}><option value="">Elige un proveedor</option>{suppliers.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>{suppliers.length === 0 && <p className="mt-2 text-sm">Agrega un proveedor en <Link to="/purchasing" className="underline">Compras</Link>.</p>}</div>
      {reviewing && <section aria-label="Confirmación de compra" className="rounded-2xl border border-kova-ink p-5"><h2 className="font-semibold">Revisa antes de crear la compra</h2><p className="mt-2">Proveedor: {suppliers.find(row => row.id === supplier)?.name}</p><ul className="mt-3 space-y-2">{selected.map(row => <li key={row.product_id}>{row.quantity} × {row.product_name} · {formatPurchaseTotal([{ quantity: 1, unit_cost: row.cost }])} por unidad</li>)}</ul><p className="mt-4 font-semibold">Total de mercancía: {total}</p><p className="mt-2 text-sm">Se registrará como compra pendiente de recepción.</p></section>}
      <div className="flex flex-wrap gap-3">{reviewing && <Button type="button" variant="outline" disabled={busy} onClick={() => setReviewing(false)}>Volver a editar</Button>}<Button disabled={!valid || busy || !online} type="submit">{busy ? "Creando compra…" : reviewing ? "Confirmar y crear compra pendiente" : "Revisar compra"}</Button></div>
    </form>}
  </ViewLayout>;
}
