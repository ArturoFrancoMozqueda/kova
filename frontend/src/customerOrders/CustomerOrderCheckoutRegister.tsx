import { LotAllocationEditor } from "@/inventory/LotControls";
import { allocationValid, type LotAllocation } from "@/inventory/lots";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Banknote, Building2, CheckCircle2, CreditCard, Loader2, Plus, Printer, SplitSquareHorizontal, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

import { useAuth } from "@/auth/useAuth";
import { useCashDrawer } from "@/hardware/useCashDrawer";
import { DrawerActions } from "@/hardware/DrawerActions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TicketPaper } from "@/components/ui/ticket";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { formatTenantName } from "@/lib/formatTenantName";
import { centsToMoney, moneyToCents } from "@/lib/money";
import { getReceipt } from "@/orders/api";
import { formatMoney } from "@/orders/format";
import { ReceiptTemplate } from "@/orders/ReceiptTemplate";
import type { Receipt } from "@/orders/types";
import { RegisterPaymentMethodSelector } from "@/register/RegisterPresentation";
import { getOpenShift } from "@/shifts/api";
import { checkoutCustomerOrder, CustomerOrderApiError, getCustomerOrder } from "./api";
import type { CustomerOrder, CustomerOrderPayments } from "./types";

type Method = "cash" | "bank_transfer" | "manual_card";
type DraftPayment = { id: string; method: Method; amount: string; tendered: string; reference: string };

const paymentOptions = [
  { value: "cash" as const, label: "Efectivo", icon: <Banknote className="h-5 w-5" /> },
  { value: "bank_transfer" as const, label: "Transferencia", icon: <Building2 className="h-5 w-5" /> },
  { value: "manual_card" as const, label: "Tarjeta", icon: <CreditCard className="h-5 w-5" /> },
];

export function CustomerOrderCheckoutRegister({ orderId }: { orderId: string }) {
  // Each pedido owns its payments, confirmation and durable retry identity.
  return <CustomerOrderCheckoutSession key={orderId} orderId={orderId} />;
}

function CustomerOrderCheckoutSession({ orderId }: { orderId: string }) {
  const { state } = useAuth();
  const drawer = useCashDrawer();
  const canOpenDrawer = state.status === "authenticated" && ["owner", "manager", "cashier"].includes(state.user?.role);
  const tenantName = formatTenantName(state.status === "authenticated" ? state.tenantName : "");
  const logoUrl = state.status === "authenticated" ? state.tenantLogoUrl ?? undefined : undefined;
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [lotParts, setLotParts] = useState<Record<string, LotAllocation[]>>({});
  const [payments, setPayments] = useState<DraftPayment[]>([
    { id: crypto.randomUUID(), method: "cash", amount: "", tendered: "", reference: "" },
  ]);
  const [split, setSplit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const checkoutKeyRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [completedSaleOrderId, setCompletedSaleOrderId] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState(false);
  const [openShift, setOpenShift] = useState<boolean | undefined>(undefined);
  const [shiftCheckFailed, setShiftCheckFailed] = useState(false);

  useEffect(() => {
    void getCustomerOrder(orderId)
      .then((detail) => {
        setOrder(detail);
        setPayments((current) => [{ ...current[0], amount: detail.total_amount }]);
      })
      .catch(() => setError("No se pudo cargar el pedido. Pedidos requiere conexión para cobrar."))
      .finally(() => setLoading(false));
  }, [orderId]);

  useEffect(() => {
    let cancelled = false;
    void getOpenShift()
      .then((shift) => {
        if (cancelled) return;
        setOpenShift(Boolean(shift));
        if (!shift) {
          setPayments((current) => current.map((payment) =>
            payment.method === "cash"
              ? { ...payment, method: "bank_transfer", tendered: "" }
              : payment,
          ));
        }
        setShiftCheckFailed(false);
      })
      .catch(() => {
        if (!cancelled) setShiftCheckFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);


  const totalCents = moneyToCents(order?.total_amount ?? "0");
  const assignedCents = payments.reduce((sum, payment) => sum + moneyToCents(payment.amount), 0);
  const remainingCents = totalCents - assignedCents;
  const includesCash = payments.some((payment) => payment.method === "cash");
  const cashBlocked = includesCash && openShift !== true;
  const valid = useMemo(
    () =>
      !cashBlocked &&
      assignedCents === totalCents &&
      payments.every((payment) =>
        (moneyToCents(payment.amount) > 0 ||
          (totalCents === 0 && payments.length === 1 && moneyToCents(payment.amount) === 0)) &&
        (payment.method !== "cash" || moneyToCents(payment.tendered) >= moneyToCents(payment.amount)),
      ),
    [assignedCents, cashBlocked, payments, totalCents],
  );

  const updatePayment = (id: string, patch: Partial<DraftPayment>) => {
    checkoutKeyRef.current = null;
    setPayments((current) => current.map((payment) => payment.id === id ? { ...payment, ...patch } : payment));
  };

  const submit = async () => {
    if (!order || !valid || submittingRef.current) return;
    if (Object.entries(order.lot_reservations ?? {}).some(([productId, original]) => !allocationValid(lotParts[productId] ?? original, order.items.filter(item => item.product_id === productId).reduce((sum, item) => sum + item.quantity, 0)))) { setError("Completa la asignación de lotes antes de cobrar."); return; }
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    const payload: CustomerOrderPayments = payments.map((payment) => ({
      method: payment.method,
      amount: centsToMoney(moneyToCents(payment.amount)),
      ...(payment.method === "cash" ? { amount_tendered: centsToMoney(moneyToCents(payment.tendered)) } : { reference: payment.reference.trim() || undefined }),
    }));
    const idempotencyKey = checkoutKeyRef.current ?? crypto.randomUUID();
    checkoutKeyRef.current = idempotencyKey;
    try {
      const result = await checkoutCustomerOrder(order.id, order.version, payload, idempotencyKey,
        Object.keys(order.lot_reservations ?? {}).length ? { ...order.lot_reservations, ...lotParts } : undefined);
      setOrder(result.customer_order);
      setCompletedSaleOrderId(result.sale_order.id);
      checkoutKeyRef.current = null;
      if (payload.some(payment => payment.method === "cash" && moneyToCents(payment.amount) > 0)) {
        void drawer.open("sale", "", result.sale_order.id);
      }
      try {
        setReceipt(await getReceipt(result.sale_order.id));
      } catch {
        setReceiptError(true);
      }
    } catch (caught) {
      const api = caught as { detail?: { detail?: { message?: string } } };
      setError(api.detail?.detail?.message ?? "No se pudo cobrar el pedido.");
      if (caught instanceof CustomerOrderApiError && caught.status < 500) {
        checkoutKeyRef.current = null;
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (loading) return <ViewLayout width="wide"><div className="h-96 animate-pulse rounded-xl bg-muted" /></ViewLayout>;
  if (!order) return <ViewLayout width="focused"><div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 text-destructive">{error}</div></ViewLayout>;

  if (completedSaleOrderId) {
    return (
      <ViewLayout width="focused" className="animate-fade-in">
        <DrawerActions drawer={drawer} canOpen={openShift === true && canOpenDrawer} />
        <Card className="print:hidden">
          <CardContent className="flex flex-col items-center p-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-kova-growth" />
            <h1 className="mt-3 text-2xl font-bold">Pedido cobrado</h1>
            <p className="mt-1 text-muted-foreground">La venta quedó vinculada a {order.folio}.</p>
            {receiptError ? (
              <p className="mt-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-foreground" role="status">
                El cobro se completó, pero el recibo no pudo cargarse. Puedes abrir el pedido para consultarlo.
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {receipt ? <Button onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Imprimir recibo</Button> : null}
              <Link to={`/pedidos/${order.id}`} className={buttonVariants({ variant: "outline" })}>Volver al pedido</Link>
            </div>
          </CardContent>
        </Card>
        {receipt ? (
          <TicketPaper className="mx-auto mt-5 max-w-sm">
            <ReceiptTemplate
              businessName={receipt.tenant_name || tenantName}
              logoUrl={logoUrl}
              receiptNumber={receipt.receipt_number}
              createdAt={receipt.created_at}
              items={receipt.items}
              subtotalAmount={receipt.subtotal_amount}
              totalAmount={receipt.total_amount}
              payments={receipt.payments}
              totalTendered={receipt.total_tendered}
              totalChange={receipt.total_change}
            />
          </TicketPaper>
        ) : null}
      </ViewLayout>
    );
  }

  return (
    <ViewLayout width="wide" className="animate-fade-in">
      <DrawerActions drawer={drawer} canOpen={openShift === true && canOpenDrawer} />
      <ViewHeader
        eyebrow={<Link to={`/pedidos/${order.id}`} className="inline-flex items-center text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-4 w-4" /> Volver al pedido</Link>}
        title={`Caja · ${order.folio}`}
        meta="Los artículos están bloqueados. Regresa al pedido para corregirlos."
      />
      {error ? <div className="my-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">{error}</div> : null}
      {(openShift === false || shiftCheckFailed) ? (
        <div className="my-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{openShift === false ? "Abre un turno antes de cobrar este pedido en efectivo." : "No pudimos comprobar el turno. Usa otro método o inténtalo de nuevo con conexión."}</span>
        </div>
      ) : null}
      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_420px]">
        <Card><CardHeader><CardTitle>Pedido listo para cobrar</CardTitle></CardHeader><CardContent className="divide-y p-0">{order.items.map((item) => <div key={item.id} className="grid grid-cols-[auto_1fr_auto] gap-3 px-5 py-4"><span className="font-semibold">{item.quantity}×</span><div><p className="font-medium">{item.product_name}</p>{item.modifiers.length ? <p className="text-xs text-muted-foreground">{item.modifiers.map((modifier) => modifier.modifier_option_name).join(" · ")}</p> : null}</div><span className="font-semibold tabular-nums">{formatMoney(item.line_total_amount)}</span></div>)}<div className="flex justify-between px-5 py-5 text-xl font-bold"><span>Total</span><span>{formatMoney(order.total_amount)}</span></div></CardContent></Card>

        <Card><CardHeader><CardTitle>Pago</CardTitle></CardHeader><CardContent className="space-y-5">
          {Object.entries(order.lot_reservations ?? {}).map(([productId, original]) => {
            const quantity = order.items.filter(item => item.product_id === productId).reduce((sum, item) => sum + item.quantity, 0);
            return <div key={productId}><p className="font-semibold">{order.items.find(item => item.product_id === productId)?.product_name} · lotes reservados</p><LotAllocationEditor productId={productId} quantity={quantity} reservedParts={original} value={lotParts[productId] ?? original} onChange={parts => { setLotParts(previous => ({ ...previous, [productId]: parts })); checkoutKeyRef.current = null; }} /></div>;
          })}
          {!split ? <RegisterPaymentMethodSelector value={payments[0].method} options={paymentOptions.map((option) => ({ ...option, disabled: option.value === "cash" && openShift !== true }))} onChange={(method) => updatePayment(payments[0].id, { method, tendered: "", reference: "" })} label="Método de pago" /> : null}
          <Button variant="ghost" className="w-full" onClick={() => {
            checkoutKeyRef.current = null;
            setSplit((current) => !current);
            if (split) setPayments([{ ...payments[0], amount: order.total_amount }]);
          }}><SplitSquareHorizontal className="mr-2 h-4 w-4" /> {split ? "Usar un solo pago" : "Dividir pago"}</Button>
          <div className="space-y-3">
            {payments.map((payment, index) => {
              const amountId = `customer-order-payment-${payment.id}-amount`;
              const detailId = `customer-order-payment-${payment.id}-detail`;
              return <div key={payment.id} className="rounded-lg border p-3"><div className="mb-3 flex items-center gap-2"><span className="text-sm font-semibold">Pago {index + 1}</span>{split ? <select aria-label={`Método del pago ${index + 1}`} value={payment.method} onChange={(event) => updatePayment(payment.id, { method: event.target.value as Method, tendered: "", reference: "" })} className="ml-auto rounded-md border bg-background px-2 py-1 text-sm"><option value="cash" disabled={openShift !== true}>Efectivo</option><option value="bank_transfer">Transferencia</option><option value="manual_card">Tarjeta</option></select> : null}{split && payments.length > 1 ? <Button size="icon" variant="ghost" aria-label="Quitar pago" onClick={() => { checkoutKeyRef.current = null; setPayments((current) => current.filter((item) => item.id !== payment.id)); }}><Trash2 className="h-4 w-4" /></Button> : null}</div>{split ? <div><Label htmlFor={amountId}>Monto</Label><Input id={amountId} type="number" min="0" step="0.01" inputMode="decimal" value={payment.amount} onChange={(event) => updatePayment(payment.id, { amount: event.target.value })} /></div> : null}{payment.method === "cash" ? <div className="mt-3"><Label htmlFor={detailId}>Efectivo recibido</Label><Input id={detailId} type="number" min="0" step="0.01" inputMode="decimal" value={payment.tendered} onChange={(event) => updatePayment(payment.id, { tendered: event.target.value })} placeholder={payment.amount} /></div> : <div className="mt-3"><Label htmlFor={detailId}>Referencia opcional</Label><Input id={detailId} value={payment.reference} onChange={(event) => updatePayment(payment.id, { reference: event.target.value })} /></div>}</div>;
            })}
          </div>
          {split ? <Button variant="outline" className="w-full" disabled={remainingCents <= 0} onClick={() => { checkoutKeyRef.current = null; setPayments((current) => [...current, { id: crypto.randomUUID(), method: "bank_transfer", amount: centsToMoney(Math.max(remainingCents, 0)), tendered: "", reference: "" }]); }}><Plus className="mr-2 h-4 w-4" /> Agregar pago</Button> : null}
          <div className="rounded-lg bg-muted/60 p-3 text-sm"><div className="flex justify-between"><span>Asignado</span><span>{formatMoney(centsToMoney(assignedCents))}</span></div><div className="mt-1 flex justify-between font-semibold"><span>Restante</span><span className={remainingCents === 0 ? "text-kova-growth" : "text-destructive"}>{formatMoney(centsToMoney(Math.abs(remainingCents)))}</span></div></div>
          {cashBlocked ? <p className="text-sm text-destructive" role="alert">{openShift === false ? "Abre un turno para cobrar en efectivo." : "No se pudo comprobar el turno para este cobro en efectivo."}</p> : null}
          <Button className="w-full" size="lg" disabled={!valid || submitting} onClick={() => void submit()}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Banknote className="mr-2 h-4 w-4" />} Cobrar {formatMoney(order.total_amount)}</Button>
        </CardContent></Card>
      </div>
    </ViewLayout>
  );
}
