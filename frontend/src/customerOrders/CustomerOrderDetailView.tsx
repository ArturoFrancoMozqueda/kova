import { getActiveBranchId } from "@/branches/activeBranch";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Banknote, ChevronLeft, ChevronRight, MapPin, Pencil, Phone, Printer, Store, XCircle } from "lucide-react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";

import { useAuth } from "@/auth/useAuth";
import { useFeature } from "@/auth/useFeature";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewError } from "@/components/ui/view-states";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useIsOnline } from "@/offline/useSyncQueue";
import { formatDateTime, formatMoney } from "@/orders/format";
import { cancelCustomerOrder, changeCustomerOrderStatus, confirmCustomerOrder, getCustomerOrder } from "./api";
import { readCustomerOrderCache, saveCustomerOrderDetail } from "./cache";
import { channelLabels, fulfillmentLabels, nextStatus, paymentLabels, previousStatus, statusLabels } from "./labels";
import { CustomerOrderStatusTracker } from "./CustomerOrderStatusTracker";
import type { CustomerOrder } from "./types";

export default function CustomerOrderDetailView() {
  const { orderId = "" } = useParams();
  const navigate = useNavigate();
  const enabled = useFeature("customer_orders");
  const { state } = useAuth();
  const tenantId = state.status === "authenticated" ? state.tenantId : "";
  const branchId = getActiveBranchId(tenantId, state.status === "authenticated" ? state.user.id : "");
  const role = state.status === "authenticated" ? state.user.role : "";
  const isManager = role === "owner" || role === "manager";
  const isOnline = useIsOnline();
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState<"customer_request" | "out_of_stock" | "duplicate" | "other">("customer_request");
  const [cancelNote, setCancelNote] = useState("");
  useDocumentTitle(order?.folio ?? "Detalle de pedido");

  const load = useCallback(async () => {
    if (!tenantId || !orderId) return;
    setLoading(true);
    setError(null);
    if (!isOnline) {
      const cached = await readCustomerOrderCache(tenantId, branchId);
      setOrder(cached?.details[orderId] ?? null);
      setCachedAt(cached?.cached_at ?? null);
      setError(cached?.details[orderId] ? null : "Este pedido no se había abierto en este dispositivo.");
      setLoading(false);
      return;
    }
    try {
      const detail = await getCustomerOrder(orderId);
      setOrder(detail);
      setCachedAt(null);
      await saveCustomerOrderDetail(tenantId, detail, branchId);
    } catch {
      const cached = await readCustomerOrderCache(tenantId, branchId);
      const detail = cached?.details[orderId] ?? null;
      setOrder(detail);
      setCachedAt(detail ? cached?.cached_at ?? null : null);
      setError(detail ? null : "No se pudo cargar el pedido.");
    } finally {
      setLoading(false);
    }
  }, [branchId, isOnline, orderId, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!enabled) return <Navigate to="/register" replace />;
  if (loading) return <ViewLayout width="focused"><div className="h-96 animate-pulse rounded-xl bg-muted" /></ViewLayout>;
  if (!order || error) return <ViewLayout width="focused"><ViewError message={error ?? "Pedido no encontrado"} onRetry={() => void load()} retryLabel="Reintentar" /></ViewLayout>;

  const applyMutation = async (mutation: () => Promise<CustomerOrder>) => {
    setMutating(true);
    setError(null);
    try {
      const updated = await mutation();
      setOrder(updated);
      await saveCustomerOrderDetail(tenantId, updated, branchId);
    } catch (caught) {
      const api = caught as { detail?: { detail?: { message?: string } } };
      setError(api.detail?.detail?.message ?? "No se pudo actualizar el pedido.");
    } finally {
      setMutating(false);
    }
  };

  const following = nextStatus(order.status);
  const previous = previousStatus(order.status);
  const editable = order.payment_status === "unpaid" && !["fulfilled", "cancelled"].includes(order.status);
  const canCheckout = order.payment_status === "unpaid" && ["confirmed", "in_progress", "ready"].includes(order.status);

  return (
    <ViewLayout width="focused" className="animate-fade-in print:max-w-none print:p-0">
      <div className="print:hidden">
        <ViewHeader
          eyebrow={<Link to="/pedidos" className="inline-flex items-center text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-4 w-4" /> Pedidos</Link>}
          title={order.folio}
          meta={`Creado ${formatDateTime(order.created_at)} · ${channelLabels[order.source_channel]}`}
          actions={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Imprimir</Button>{editable && isOnline ? <Link to={`/pedidos/${order.id}/editar`} className={buttonVariants({ variant: "outline" })}><Pencil className="mr-2 h-4 w-4" /> Editar</Link> : null}</div>}
        />
      </div>

      <div className="hidden print:block">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Pedido · no es recibo de pago</p>
        <h1 className="mt-1 text-2xl font-bold">{order.folio}</h1>
      </div>

      {cachedAt ? <div className="my-4 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground print:hidden">Solo lectura · actualizado {formatDateTime(cachedAt)}.</div> : null}
      {error ? <div className="my-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive print:hidden" role="alert">{error}</div> : null}

      <Card className="mt-5 print:border-0 print:shadow-none">
        <CardContent className="p-5"><CustomerOrderStatusTracker status={order.status} /></CardContent>
      </Card>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Cliente y entrega</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-start gap-2"><Store className="mt-0.5 h-4 w-4 text-muted-foreground" /><div><p className="font-medium">{fulfillmentLabels[order.fulfillment_type]}</p><p className="text-muted-foreground">{order.promised_at ? formatDateTime(order.promised_at) : "Lo antes posible"}</p></div></div>
            <div><p className="font-medium">{order.customer_name || "Cliente sin nombre"}</p>{order.customer_phone ? <p className="mt-1 flex items-center text-muted-foreground"><Phone className="mr-1.5 h-3.5 w-3.5" /> {order.customer_phone}</p> : null}</div>
            {order.delivery_address ? <div className="flex items-start gap-2 text-muted-foreground"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /><span>{order.delivery_address}{order.delivery_reference ? ` · ${order.delivery_reference}` : ""}</span></div> : null}
            {order.note ? <p className="rounded-md bg-muted/60 p-3 text-muted-foreground">{order.note}</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Cobro</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center justify-between"><Badge variant={order.payment_status === "paid" ? "success" : "outline"}>{paymentLabels[order.payment_status]}</Badge><span className="text-2xl font-bold tabular-nums">{formatMoney(order.total_amount)}</span></div>
            {order.sale_order_id ? <Link className="mt-4 inline-flex text-sm font-medium text-primary hover:underline print:hidden" to={`/orders/${order.sale_order_id}`}>Ver venta vinculada</Link> : null}
            {order.stock_conflict ? <div className="mt-4 flex gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning-foreground"><AlertTriangle className="h-4 w-4 shrink-0" /> El stock físico ya no cubre todas las reservas. Corrige inventario o artículos antes de cobrar.</div> : null}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4 print:border-0 print:shadow-none">
        <CardHeader><CardTitle>Artículos</CardTitle></CardHeader>
        <CardContent className="divide-y p-0">
          {order.items.map((item) => (
            <div key={item.id} className="grid grid-cols-[auto_1fr_auto] gap-3 px-5 py-4 text-sm">
              <span className="font-semibold tabular-nums">{item.quantity}×</span>
              <div><p className="font-medium">{item.product_name}</p>{item.modifiers.length ? <p className="text-xs text-muted-foreground">{item.modifiers.map((modifier) => modifier.modifier_option_name).join(" · ")}</p> : null}{item.note ? <p className="mt-1 text-xs font-medium text-primary">Nota: {item.note}</p> : null}</div>
              <span className="font-semibold tabular-nums">{formatMoney(item.line_total_amount)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-5 py-4 text-lg font-bold"><span>Total</span><span className="tabular-nums">{formatMoney(order.total_amount)}</span></div>
        </CardContent>
      </Card>

      {isOnline && !["fulfilled", "cancelled"].includes(order.status) ? (
        <Card className="mt-4 print:hidden">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap">
            {order.status === "new" ? <Button disabled={mutating} onClick={() => void applyMutation(() => confirmCustomerOrder(order.id, order.version))}>Confirmar y reservar</Button> : null}
            {canCheckout ? <Button disabled={mutating || order.stock_conflict} onClick={() => navigate(`/register?customerOrderId=${order.id}`)}><Banknote className="mr-2 h-4 w-4" /> Cobrar en Caja</Button> : null}
            {following && following !== "confirmed" ? <Button variant="secondary" disabled={mutating || (following === "fulfilled" && order.payment_status !== "paid")} onClick={() => void applyMutation(() => changeCustomerOrderStatus(order.id, order.version, following))}><ChevronRight className="mr-2 h-4 w-4" /> Marcar {statusLabels[following].toLocaleLowerCase("es-MX")}</Button> : null}
            {isManager && previous ? <Button variant="outline" disabled={mutating} onClick={() => void applyMutation(() => changeCustomerOrderStatus(order.id, order.version, previous))}><ChevronLeft className="mr-2 h-4 w-4" /> Corregir a {statusLabels[previous]}</Button> : null}
            <Button variant="ghost" className="sm:ml-auto text-destructive" disabled={mutating} onClick={() => setCancelOpen(true)}><XCircle className="mr-2 h-4 w-4" /> Cancelar pedido</Button>
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)}>
        <DialogHeader><DialogTitle>Cancelar {order.folio}</DialogTitle><DialogDescription>Se liberará el inventario reservado. Si ya fue cobrado, primero deberá revertirse la venta.</DialogDescription></DialogHeader>
        <div className="space-y-3"><div><Label>Motivo</Label><Select value={cancelReason} onChange={(event) => setCancelReason(event.target.value as typeof cancelReason)}><option value="customer_request">Solicitud del cliente</option><option value="out_of_stock">Sin existencias</option><option value="duplicate">Duplicado</option><option value="other">Otro</option></Select></div><div><Label>Nota opcional</Label><Input value={cancelNote} onChange={(event) => setCancelNote(event.target.value)} maxLength={300} /></div></div>
        <DialogFooter><Button variant="outline" onClick={() => setCancelOpen(false)}>Volver</Button><Button variant="destructive" disabled={mutating} onClick={() => { void applyMutation(() => cancelCustomerOrder(order.id, order.version, cancelReason, cancelNote)).then(() => setCancelOpen(false)); }}>Cancelar pedido</Button></DialogFooter>
      </Dialog>
    </ViewLayout>
  );
}
