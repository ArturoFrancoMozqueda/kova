import { resolveApiErrorMessage, safeUserMessage, resolveUserFacingError } from "@/lib/apiError";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, Minus, Plus, Save, ShoppingBag, Trash2 } from "lucide-react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { useAuth } from "@/auth/useAuth";
import { useFeature } from "@/auth/useFeature";
import { getActiveBranchId } from "@/branches/activeBranch";
import { listCustomers, resolveActiveCustomer, type Customer } from "@/customers/api";
import { listProducts } from "@/catalog/api";
import type { Product } from "@/catalog/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ViewHeader } from "@/components/ui/view-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewLayout } from "@/components/ui/view-layout";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { listStock } from "@/inventory/api";
import { formatMoney } from "@/orders/format";
import { ModifierSelectionModal, type SelectedModifier } from "@/register/ModifierSelectionModal";
import { RegisterProductCard } from "@/register/RegisterPresentation";
import { confirmCustomerOrder, createCustomerOrder, getCustomerOrder, updateCustomerOrder } from "./api";
import { channelLabels, fulfillmentLabels } from "./labels";
import type { CustomerOrder, CustomerOrderInput, FulfillmentType, SourceChannel } from "./types";

type DraftLine = {
  key: string;
  existingId?: string;
  productId: string;
  productName: string;
  unitPrice: string;
  quantity: number;
  modifiers: SelectedModifier[];
  note: string;
};

function moneyToCents(value: string): number {
  const [whole = "0", fraction = ""] = value.split(".");
  return Number.parseInt(whole, 10) * 100 + Number.parseInt(`${fraction}00`.slice(0, 2), 10);
}

function centsToMoney(value: number): string {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

function lineKey(productId: string, modifiers: readonly SelectedModifier[]): string {
  return [productId, ...modifiers.map((modifier) => modifier.optionId).sort()].join(":");
}

function localDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function availableStock(rows: Awaited<ReturnType<typeof listStock>>, order?: CustomerOrder) {
  if (!order || order.payment_status !== "unpaid" || !["confirmed", "in_progress", "ready"].includes(order.status)) {
    return Object.fromEntries(rows.map(item => [item.product_id, item.available_quantity]));
  }
  const ownReserved = new Map<string, number>();
  for (const item of order.items) {
    ownReserved.set(item.product_id, (ownReserved.get(item.product_id) ?? 0) + item.quantity);
  }
  // Preserve this order's own reservations while excluding reservations of others.
  return Object.fromEntries(rows.map(item => [item.product_id,
    Math.max(0, item.stock_on_hand - Math.max(0, item.reserved_quantity - (ownReserved.get(item.product_id) ?? 0))),
  ]));
}

export default function CustomerOrderFormView() {
  const { orderId } = useParams();
  const { state } = useAuth();
  const [params] = useSearchParams();
  const incomingCustomerId = !orderId ? params.get("customerId") ?? "" : "";
  const identity = state.status === "authenticated"
    ? `${state.tenantId}:${state.user.id}:${state.user.role}:${getActiveBranchId(state.tenantId, state.user.id)}`
    : state.status;
  return <CustomerOrderFormSession key={`${identity}:${orderId ?? "new"}:${incomingCustomerId}`} orderId={orderId} incomingCustomerId={incomingCustomerId} />;
}

function CustomerOrderFormSession({ orderId, incomingCustomerId }: { orderId?: string; incomingCustomerId: string }) {
  const formId = useId();
  useDocumentTitle("Nuevo pedido");
  const enabled = useFeature("customer_orders");
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [stockError, setStockError] = useState(false);
  const [stockAttempt, setStockAttempt] = useState(0);
  const [stockRetrying, setStockRetrying] = useState(false);
  const [existing, setExisting] = useState<CustomerOrder | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [modifierProduct, setModifierProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState("");
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>("pickup");
  const [sourceChannel, setSourceChannel] = useState<SourceChannel>("counter");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerOptions, setCustomerOptions] = useState<Customer[]>([]);
  const [customerSelectorOpen, setCustomerSelectorOpen] = useState(Boolean(incomingCustomerId));
  const [customerLoading, setCustomerLoading] = useState(Boolean(incomingCustomerId));
  const [customerError, setCustomerError] = useState("");
  const [customerSearchError, setCustomerSearchError] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryReference, setDeliveryReference] = useState("");
  const [promisedAt, setPromisedAt] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  // A response may be lost after the server commits. Replay each unchanged
  // mutation with its original identity, including the save/confirm sequence.
  const mutationKeys = useRef(new Map<string, string>());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!incomingCustomerId || orderId) return;
    let active = true;
    const controller = new AbortController();
    void resolveActiveCustomer(incomingCustomerId, { signal: controller.signal })
      .then((customer) => {
        if (!active) return;
        setCustomerId(customer.id);
        setCustomerName(customer.name);
        setCustomerPhone(customer.phone ?? "");
        setCustomerOptions((rows) => [customer, ...rows.filter((row) => row.id !== customer.id)]);
      })
      .catch((caught: unknown) => {
        if (active) setCustomerError(resolveUserFacingError(caught, "No pudimos confirmar el cliente del pedido."));
      })
      .finally(() => { if (active) setCustomerLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [incomingCustomerId, orderId]);
  useEffect(() => {
    if (orderId || !customerSelectorOpen) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void listCustomers(customerSearch)
        .then((rows) => { if (active) { setCustomerOptions(rows); setCustomerSearchError(""); } })
        .catch(() => { if (active) setCustomerSearchError("No pudimos buscar clientes. Cambia la búsqueda para reintentar."); });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [customerSearch, customerSelectorOpen, orderId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listProducts(), listStock().catch(() => null)])
      .then(async ([catalog, stockRows]) => {
        if (cancelled) return;
        setProducts(catalog);
        setStockError(stockRows === null);
        if (stockRows) setStock(availableStock(stockRows));
        if (!orderId) return;
        const order = await getCustomerOrder(orderId);
        if (cancelled) return;
        if (stockRows) setStock(availableStock(stockRows, order));
        setExisting(order);
        setFulfillmentType(order.fulfillment_type);
        setSourceChannel(order.source_channel);
        setCustomerName(order.customer_name ?? "");
        setCustomerPhone(order.customer_phone ?? "");
        setCustomerId(order.customer_id ?? "");
        setDeliveryAddress(order.delivery_address ?? "");
        setDeliveryReference(order.delivery_reference ?? "");
        setPromisedAt(localDateTime(order.promised_at));
        setNote(order.note ?? "");
        setLines(
          order.items.map((item) => ({
            key: item.id,
            existingId: item.id,
            productId: item.product_id,
            productName: item.product_name,
            unitPrice: item.unit_price_amount,
            quantity: item.quantity,
            note: item.note ?? "",
            modifiers: item.modifiers.map((modifier) => ({
              groupId: modifier.modifier_group_id,
              groupName: modifier.modifier_group_name,
              optionId: modifier.modifier_option_id,
              optionName: modifier.modifier_option_name,
              priceDelta: modifier.price_delta_amount,
            })),
          })),
        );
      })
      .catch(() => setError("No se pudo cargar la información del pedido."))
      .finally(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  useEffect(() => {
    if (stockAttempt === 0) return;
    let active = true;
    setStockRetrying(true);
    void listStock().then(rows => {
      if (active) { setStock(availableStock(rows, existing ?? undefined)); setStockError(false); }
    }).catch(() => { if (active) setStockError(true); })
      .finally(() => { if (active) setStockRetrying(false); });
    return () => { active = false; };
  }, [stockAttempt, existing]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("es-MX");
    if (!query) return products;
    return products.filter((product) =>
      `${product.name} ${product.sku ?? ""}`.toLocaleLowerCase("es-MX").includes(query),
    );
  }, [products, search]);

  const totalCents = lines.reduce(
    (sum, line) => sum + moneyToCents(line.unitPrice) * line.quantity,
    0,
  );

  if (!enabled) return <Navigate to="/register" replace />;

  const addProduct = (product: Product) => {
    const activeGroups = product.modifier_groups.filter((group) => group.is_active);
    if (activeGroups.length > 0) {
      setModifierProduct(product);
      return;
    }
    addLine(product, []);
  };

  const addLine = (product: Product, modifiers: SelectedModifier[]) => {
    const key = lineKey(product.id, modifiers);
    const modifierCents = modifiers.reduce((sum, modifier) => sum + moneyToCents(modifier.priceDelta), 0);
    const unitPrice = centsToMoney(moneyToCents(product.price_amount) + modifierCents);
    setLines((current) => {
      const found = current.find((line) =>
        !line.existingId && !line.note && lineKey(line.productId, line.modifiers) === key,
      );
      if (found) {
        return current.map((line) => line.key === found.key ? { ...line, quantity: line.quantity + 1 } : line);
      }
      return [
        ...current,
        {
          key: `${key}:${crypto.randomUUID()}`,
          productId: product.id,
          productName: product.name,
          unitPrice,
          quantity: 1,
          modifiers,
          note: "",
        },
      ];
    });
  };

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  };

  const payload = (): CustomerOrderInput => ({
    fulfillment_type: fulfillmentType,
    source_channel: sourceChannel,
    ...(!orderId ? { customer_id: customerId || null } : {}),
    customer_name: customerName.trim() || null,
    customer_phone: customerPhone.trim() || null,
    delivery_address: fulfillmentType === "delivery" ? deliveryAddress.trim() || null : null,
    delivery_reference: fulfillmentType === "delivery" ? deliveryReference.trim() || null : null,
    promised_at: promisedAt ? new Date(promisedAt).toISOString() : null,
    note: note.trim() || null,
    items: lines.map((line) => ({
      id: line.existingId,
      product_id: line.productId,
      quantity: line.quantity,
      modifier_option_ids: line.modifiers.map((modifier) => modifier.optionId),
      note: line.note.trim() || null,
    })),
  });

  const persist = async (action: "save" | "confirm" | "checkout") => {
    if (submittingRef.current || customerLoading || customerError) return;
    setError(null);
    if (lines.length === 0) {
      setError("Agrega al menos un producto.");
      return;
    }
    if (fulfillmentType === "delivery" && (!customerName.trim() || !deliveryAddress.trim())) {
      setError("Para entrega indica el nombre y la dirección del cliente.");
      return;
    }
    const keyFor = (operation: string, body: unknown) => {
      const signature = JSON.stringify([operation, body]);
      const key = mutationKeys.current.get(signature) ?? crypto.randomUUID();
      mutationKeys.current.set(signature, key);
      return key;
    };
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const body = payload();
      let saved = existing
        ? await updateCustomerOrder(existing.id, { ...body, version: existing.version },
          keyFor(`update:${existing.id}`, { ...body, version: existing.version }))
        : await createCustomerOrder(body, keyFor("create", body));
      if ((action === "confirm" || action === "checkout") && saved.status === "new") {
        saved = await confirmCustomerOrder(saved.id, saved.version,
          keyFor(`confirm:${saved.id}`, { version: saved.version }));
      }
      if (action === "checkout") {
        navigate(`/register?customerOrderId=${saved.id}`);
      } else {
        navigate(`/pedidos/${saved.id}`);
      }
    } catch (caught) {
      const body = caught as { detail?: { detail?: { message?: string } } };
      setError(resolveApiErrorMessage(caught, safeUserMessage(body.detail?.detail?.message, "No se pudo guardar el pedido. Revisa los datos e intenta de nuevo.")));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (loading) {
    return <ViewLayout width="wide"><Skeleton className="h-96 w-full rounded-kova-lg" /></ViewLayout>;
  }

  return (
    <ViewLayout width="wide" className="animate-fade-in">
      <ViewHeader
        eyebrow={<Link to={existing ? `/pedidos/${existing.id}` : "/pedidos"} className="inline-flex items-center text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-4 w-4" /> Volver</Link>}
        title={existing ? `Editar ${existing.folio}` : "Nuevo pedido"}
        meta="Los precios se congelan al guardar. El inventario se reserva al confirmar."
      />

      {error ? <div className="my-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">{error}</div> : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_420px]">
        <div className="space-y-4">
          <Label htmlFor={`${formId}-search`} className="sr-only">Buscar producto o SKU</Label>
          <Input id={`${formId}-search`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto o SKU" />
          {stockError && <div role="alert" className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
            <p className="font-medium">No pudimos consultar las existencias.</p>
            <p className="mt-1 text-kova-muted">La disponibilidad está por confirmar. Conservamos tu pedido mientras vuelves a consultar.</p>
            <Button type="button" variant="outline" className="mt-3" disabled={stockRetrying || submitting} onClick={() => setStockAttempt(value => value + 1)}>{stockRetrying ? "Consultando existencias…" : "Volver a consultar existencias"}</Button>
          </div>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredProducts.map((product) => {
              const available = product.track_inventory && !stockError ? stock[product.id] : undefined;
              const disabled = product.track_inventory && (stockError || (available ?? 0) <= 0);
              return (
                <RegisterProductCard
                  key={product.id}
                  name={product.name}
                  price={product.price_amount}
                  ariaLabel={`Agregar ${product.name}`}
                  disabled={disabled}
                  status={stockError && product.track_inventory ? { label: "Por consultar", tone: "muted" } : available !== undefined ? { label: `${available} disp.`, tone: available <= 2 ? "warning" : "muted" } : undefined}
                  onAdd={() => addProduct(product)}
                  onDisabledSelect={() => setError(stockError ? `Consulta las existencias antes de agregar ${product.name}.` : `${product.name} no tiene disponibilidad.`)}
                />
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ShoppingBag className="h-4 w-4" /> Artículos</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {lines.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Selecciona productos del catálogo.</p> : lines.map((line) => (
                <div key={line.key} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p id={`${formId}-${line.key}-product`} className="font-medium">{line.productName}</p><p className="text-xs text-muted-foreground">{line.modifiers.map((modifier) => modifier.optionName).join(" · ") || "Sin modificadores"}</p></div>
                    <p className="font-semibold tabular-nums">{formatMoney(centsToMoney(moneyToCents(line.unitPrice) * line.quantity))}</p>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Button type="button" size="icon" variant="outline" aria-label="Quitar una unidad" aria-describedby={`${formId}-${line.key}-product`} onClick={() => line.quantity === 1 ? setLines((current) => current.filter((item) => item.key !== line.key)) : updateLine(line.key, { quantity: line.quantity - 1 })}><Minus className="h-3.5 w-3.5" /></Button>
                    <span className="w-8 text-center font-semibold tabular-nums">{line.quantity}</span>
                    <Button type="button" size="icon" variant="outline" aria-label="Agregar una unidad" aria-describedby={`${formId}-${line.key}-product`} disabled={stock[line.productId] !== undefined && lines.filter((item) => item.productId === line.productId).reduce((sum, item) => sum + item.quantity, 0) >= stock[line.productId]} onClick={() => updateLine(line.key, { quantity: line.quantity + 1 })}><Plus className="h-3.5 w-3.5" /></Button>
                    <Button type="button" size="icon" variant="ghost" className="ml-auto text-destructive" aria-label="Eliminar artículo" aria-describedby={`${formId}-${line.key}-product`} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                  <Label htmlFor={`${formId}-${line.key}-note`} className="sr-only">Nota de {line.productName} (opcional)</Label>
                  <Input id={`${formId}-${line.key}-note`} className="mt-3" value={line.note} maxLength={200} onChange={(event) => updateLine(line.key, { note: event.target.value })} placeholder="Nota del artículo (opcional)" />
                </div>
              ))}
              <div className="flex items-center justify-between border-t pt-3 text-lg font-bold"><span>Total</span><span className="tabular-nums">{formatMoney(centsToMoney(totalCents))}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Entrega y cliente</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              {orderId ? customerId && <p className="text-sm">Cliente registrado: <Link className="font-medium text-primary underline underline-offset-4" to={`/customers?customerId=${encodeURIComponent(customerId)}`}>{customerName || "Ver cliente"}</Link>. La asociación se conserva al editar.</p> : <details open={customerSelectorOpen} onToggle={(event) => setCustomerSelectorOpen(event.currentTarget.open)} className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">{customerId ? `Cliente registrado: ${customerName}` : "Asociar cliente registrado (opcional)"}</summary>
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-muted-foreground">Al cobrar, la compra quedará en su historial. También puedes crear el pedido sin asociarlo a un cliente registrado.</p>
                  {customerLoading && <p role="status" className="text-sm">Confirmando el cliente del pedido…</p>}
                  {customerError && <p role="alert" className="text-sm text-destructive-strong">{customerError}</p>}
                  <Label htmlFor={`${formId}-customer-search`}>Buscar cliente registrado</Label>
                  <Input id={`${formId}-customer-search`} value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Nombre, correo o teléfono" disabled={customerLoading} />
                  {customerSearchError && <p role="alert" className="text-sm text-destructive-strong">{customerSearchError}</p>}
                  <Label htmlFor={`${formId}-registered-customer`}>Cliente registrado</Label>
                  <Select id={`${formId}-registered-customer`} value={customerId} disabled={customerLoading} onChange={(event) => {
                    const selected = customerOptions.find((customer) => customer.id === event.target.value);
                    setCustomerId(selected?.id ?? "");
                    setCustomerError("");
                    if (selected) { setCustomerName(selected.name); setCustomerPhone(selected.phone ?? ""); }
                  }}>
                    <option value="">Sin asociar cliente registrado</option>
                    {customerId && !customerOptions.some((row) => row.id === customerId) && <option value={customerId}>{customerName}</option>}
                    {customerOptions.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
                  </Select>
                  {customerError && <Button type="button" variant="outline" size="sm" onClick={() => { setCustomerError(""); setCustomerId(""); }}>Continuar sin cliente registrado</Button>}
                </div>
              </details>}
              <div><Label htmlFor={`${formId}-fulfillment`}>Modalidad</Label><Select id={`${formId}-fulfillment`} value={fulfillmentType} onChange={(event) => setFulfillmentType(event.target.value as FulfillmentType)}><option value="pickup">{fulfillmentLabels.pickup}</option><option value="delivery">{fulfillmentLabels.delivery}</option></Select></div>
              <div><Label htmlFor={`${formId}-channel`}>Canal</Label><Select id={`${formId}-channel`} value={sourceChannel} onChange={(event) => setSourceChannel(event.target.value as SourceChannel)}><option value="counter">{channelLabels.counter}</option><option value="phone_whatsapp">{channelLabels.phone_whatsapp}</option><option value="other">{channelLabels.other}</option></Select></div>
              <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor={`${formId}-customer-name`}>Nombre</Label><Input id={`${formId}-customer-name`} value={customerName} onChange={(event) => setCustomerName(event.target.value)} maxLength={160} /></div><div><Label htmlFor={`${formId}-customer-phone`}>Teléfono</Label><Input id={`${formId}-customer-phone`} value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} inputMode="tel" maxLength={32} /></div></div>
              {fulfillmentType === "delivery" ? <><div><Label htmlFor={`${formId}-address`}>Dirección</Label><Input id={`${formId}-address`} value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} maxLength={300} /></div><div><Label htmlFor={`${formId}-reference`}>Referencia</Label><Input id={`${formId}-reference`} value={deliveryReference} onChange={(event) => setDeliveryReference(event.target.value)} maxLength={200} /></div></> : null}
              <div><Label htmlFor={`${formId}-promised-at`}>Prometido para</Label><Input id={`${formId}-promised-at`} type="datetime-local" value={promisedAt} onChange={(event) => setPromisedAt(event.target.value)} /></div>
              <div><Label htmlFor={`${formId}-note`}>Nota general</Label><textarea id={`${formId}-note`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>
            </CardContent>
          </Card>

          <div className="grid gap-2 sm:grid-cols-3">
            <Button variant="outline" disabled={submitting || customerLoading || Boolean(customerError)} onClick={() => void persist("save")}><Save className="mr-2 h-4 w-4" /> Guardar</Button>
            <Button variant="secondary" disabled={submitting || customerLoading || Boolean(customerError)} onClick={() => void persist("confirm")}>Guardar y confirmar</Button>
            <Button disabled={submitting || customerLoading || Boolean(customerError)} onClick={() => void persist("checkout")}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Confirmar y cobrar</Button>
          </div>
        </div>
      </div>

      {modifierProduct ? (
        <ModifierSelectionModal
          productName={modifierProduct.name}
          modifierGroups={modifierProduct.modifier_groups.filter((group) => group.is_active)}
          onCancel={() => setModifierProduct(null)}
          onConfirm={(selected) => {
            addLine(modifierProduct, selected);
            setModifierProduct(null);
          }}
        />
      ) : null}
    </ViewLayout>
  );
}
