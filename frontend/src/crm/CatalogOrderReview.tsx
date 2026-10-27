import { resolveUserFacingError } from "@/lib/apiError";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ShoppingBag } from "lucide-react";
import { OperationsError, useOnline, useOperationsRequest, type WorkspaceIdentity } from "@/automations/workspace";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Customer } from "@/customers/api";
import { formatMoney } from "@/orders/format";

export type CatalogOrderPreview = {
  request_id: string; version: number;
  items: { product_id: string; product_name: string; quantity: number; unit_price_amount: string; line_total_amount: string; available_quantity: number | null }[];
  total_amount: string; can_accept: boolean; issues: string[]; preview_fingerprint: string;
  customer_order_id: string | null;
};
type AcceptedOrder = { customer_order: { id: string; folio: string }; request: { id: string } };

export function CatalogOrderReview({ identity, row, customers, search, onSearch, customerError, onAccepted, onClose }: {
  identity: WorkspaceIdentity;
  row: { id: string; name: string; contact: string; origin?: "remote" | "in_store" | null };
  customers: Customer[]; search: string; onSearch: (value: string) => void; customerError: string;
  onAccepted: () => void; onClose: () => void;
}) {
  const request = useOperationsRequest("/api/v1", identity);
  const online = useOnline();
  const [preview, setPreview] = useState<CatalogOrderPreview | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState<AcceptedOrder["customer_order"] | null>(null);
  const alive = useRef(false);
  const generation = useRef(0);
  const locked = useRef(false);
  const command = useRef<{ fingerprint: string; key: string } | null>(null);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setPreview(null);
    setConfirmed(false);
    try {
      const value = await request<CatalogOrderPreview>(`/crm/requests/${encodeURIComponent(row.id)}/order-preview`);
      if (alive.current && generation.current === current) { setPreview(value); setError(""); }
    } catch (failure) {
      if (alive.current && generation.current === current) setError(resolveUserFacingError(failure, "No pudimos revisar los productos de la solicitud."));
    } finally { if (alive.current && generation.current === current) setLoading(false); }
  }, [request, row.id]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; generation.current += 1; }; }, [load]);

  const accept = async () => {
    if (locked.current || !preview?.can_accept || !customerId || !confirmed || !online || preview.customer_order_id) return;
    locked.current = true; setBusy(true); setError("");
    const body = { customer_id: customerId, expected_version: preview.version, preview_fingerprint: preview.preview_fingerprint, confirmed: true };
    const fingerprint = JSON.stringify(body);
    if (command.current?.fingerprint !== fingerprint) command.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const result = await request<AcceptedOrder>(`/crm/requests/${encodeURIComponent(row.id)}/accept-order`, "POST", body, command.current.key);
      if (alive.current) { setAccepted(result.customer_order); onAccepted(); }
    } catch (failure) {
      if (alive.current) {
        if (failure instanceof OperationsError && failure.status === 409) await load();
        if (alive.current) { setConfirmed(false); setError(resolveUserFacingError(failure, "No pudimos confirmar la creación. Revisa el estado antes de reintentar.")); }
      }
    } finally { locked.current = false; if (alive.current) setBusy(false); }
  };

  return <Dialog open onClose={() => { if (!busy) onClose(); }} className="sm:max-w-xl">
    <DialogHeader className="pr-8"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-kova-blue">Solicitud del menú</p><DialogTitle>{accepted ? "Pedido creado" : `Revisar pedido de ${row.name}`}</DialogTitle><DialogDescription>{accepted ? "Continúa la operación desde el pedido exacto." : "Revisa precios vigentes y vincula al cliente antes de continuar."}</DialogDescription></DialogHeader>
    {accepted ? <div className="space-y-4">
      <div role="status" className="rounded-2xl border border-kova-growth/25 bg-kova-growth/10 p-5"><CheckCircle2 className="mb-2 h-6 w-6 text-kova-growth-strong" aria-hidden="true" /><p className="font-semibold">{accepted.folio}</p><p className="mt-2 text-sm">Pedido creado para confirmar. Todavía no reserva inventario ni registra un cobro.</p></div>
      <Link to={`/pedidos/${encodeURIComponent(accepted.id)}`} className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-kova-blue px-4 py-3 text-sm font-medium text-white">Abrir pedido</Link>
    </div> : <div className="space-y-5">
      <div className="rounded-xl bg-kova-mist px-4 py-3 text-sm"><p className="break-words font-medium">{row.name}</p><p className="mt-1 break-words text-kova-muted">{row.contact}</p>{row.origin && <p className="mt-1 text-xs text-kova-muted">{row.origin === "in_store" ? "Solicitud en el negocio" : "Solicitud a distancia"}</p>}</div>
      {loading && <p role="status" className="text-sm text-kova-muted">Revisando productos y precios actuales…</p>}
      {!online && <p role="status" className="text-sm text-kova-muted">Conéctate para revisar y crear el pedido.</p>}
      {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive-strong">{error}</p>}
      {!loading && !preview && <Button type="button" variant="outline" onClick={() => void load()}>Volver a revisar</Button>}
      {preview && <>
        <section aria-label="Productos y precios revisados" className="overflow-hidden rounded-2xl border border-kova-border">
          <div className="flex items-center gap-2 border-b border-kova-border bg-kova-mist/50 p-4 text-sm font-medium"><ShoppingBag className="h-4 w-4 text-kova-blue" aria-hidden="true" />Precios vigentes del negocio</div>
          <ul className="divide-y divide-kova-border px-4">{preview.items.map(item => <li key={item.product_id} className="flex items-start justify-between gap-3 py-3 text-sm"><div className="min-w-0"><p className="break-words font-medium">{item.quantity} × {item.product_name}</p><p className="mt-1 text-xs text-kova-muted">{formatMoney(item.unit_price_amount)} cada uno</p></div><p className="shrink-0 font-semibold tabular-nums">{formatMoney(item.line_total_amount)}</p></li>)}</ul>
          <p className="flex flex-wrap justify-between gap-2 border-t border-kova-border p-4 text-sm font-semibold"><span>Total por registrar</span><span className="tabular-nums">{formatMoney(preview.total_amount)} MXN</span></p>
        </section>
        {preview.issues.length > 0 && <div role="status" className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning-foreground"><ul className="list-inside list-disc space-y-1">{preview.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
        {preview.customer_order_id ? <Link to={`/pedidos/${encodeURIComponent(preview.customer_order_id)}`} className="inline-flex min-h-11 items-center text-sm font-medium text-kova-blue underline">Abrir pedido existente</Link> : <>
          <label htmlFor="order-review-customer-search" className="block text-sm font-medium">Buscar cliente<Input id="order-review-customer-search" className="mt-2" value={search} onChange={event => { onSearch(event.target.value); setCustomerId(""); setConfirmed(false); }} disabled={busy} /></label>
          {customerError && <p role="alert" className="text-sm text-destructive-strong">{customerError}</p>}
          <label htmlFor="order-review-customer" className="block text-sm font-medium">Vincular con cliente registrado<Select id="order-review-customer" className="mt-2" value={customerId} disabled={busy} onChange={event => { setCustomerId(event.target.value); setConfirmed(false); }}><option value="">Selecciona un cliente registrado</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</Select></label>
          <p className="text-xs leading-relaxed text-kova-muted">Si aún no existe, <Link to="/customers" className="underline">registra al cliente</Link> y vuelve a revisar. El contacto de la solicitud no se vincula automáticamente.</p>
          <label className="flex items-start gap-3 rounded-xl border border-kova-border p-3 text-sm leading-relaxed"><input type="checkbox" className="mt-1" checked={confirmed} disabled={busy || !preview.can_accept} onChange={event => setConfirmed(event.target.checked)} /><span>Revisé productos, cantidades, precios y cliente. Crearé el pedido para confirmarlo desde Pedidos; todavía no reserva inventario ni registra un cobro.</span></label>
          <Button type="button" className="h-auto min-h-12 w-full whitespace-normal" disabled={busy || !online || !preview.can_accept || !customerId || !confirmed} onClick={() => void accept()}>{busy ? "Creando pedido…" : "Crear pedido para confirmar"}</Button>
        </>}
      </>}
    </div>}
  </Dialog>;
}
