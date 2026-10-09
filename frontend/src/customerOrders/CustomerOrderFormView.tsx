import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, Minus, Plus, Save, ShoppingBag, Trash2 } from "lucide-react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";

import { useFeature } from "@/auth/useFeature";
import { listProducts } from "@/catalog/api";
import type { Product } from "@/catalog/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ViewHeader } from "@/components/ui/view-header";
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

export default function CustomerOrderFormView() {
  const { orderId } = useParams();
  return <CustomerOrderFormSession key={orderId ?? "new"} orderId={orderId} />;
}

function CustomerOrderFormSession({ orderId }: { orderId?: string }) {
  const formId = useId();
  useDocumentTitle("Nuevo pedido");
  const enabled = useFeature("customer_orders");
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [existing, setExisting] = useState<CustomerOrder | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [modifierProduct, setModifierProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState("");
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>("pickup");
  const [sourceChannel, setSourceChannel] = useState<SourceChannel>("counter");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
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
    let cancelled = false;
    void Promise.all([listProducts(), listStock().catch(() => [])])
      .then(async ([catalog, stockRows]) => {
        if (cancelled) return;
        setProducts(catalog);
        setStock(Object.fromEntries(stockRows.map((item) => [item.product_id, item.available_quantity])));
        if (!orderId) return;
        const order = await getCustomerOrder(orderId);
        if (cancelled) return;
        if (order.payment_status === "unpaid" && ["confirmed", "in_progress", "ready"].includes(order.status)) {
          const ownReserved = new Map<string, number>();
          for (const item of order.items) {
            ownReserved.set(item.product_id, (ownReserved.get(item.product_id) ?? 0) + item.quantity);
          }
          // Drafts have no reservations. For active pedidos, aggregate all
          // their lines and keep other pedidos' reservations deducted even
          // when physical stock has fallen below the total reserved quantity.
          setStock(Object.fromEntries(stockRows.map((item) => [
            item.product_id,
            Math.max(0, item.stock_on_hand - Math.max(0, item.reserved_quantity - (ownReserved.get(item.product_id) ?? 0))),
          ])));
        }
        setExisting(order);
        setFulfillmentType(order.fulfillment_type);
        setSourceChannel(order.source_channel);
        setCustomerName(order.customer_name ?? "");
        setCustomerPhone(order.customer_phone ?? "");
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
    if (submittingRef.current) return;
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
      setError(body.detail?.detail?.message ?? "No se pudo guardar el pedido. Revisa los datos e intenta de nuevo.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (loading) {
    return <ViewLayout width="wide"><div className="h-96 animate-pulse rounded-xl bg-muted" /></ViewLayout>;
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredProducts.map((product) => {
              const available = product.track_inventory ? stock[product.id] : undefined;
              const disabled = product.track_inventory && (available ?? 0) <= 0;
              return (
                <RegisterProductCard
                  key={product.id}
                  name={product.name}
                  price={product.price_amount}
                  ariaLabel={`Agregar ${product.name}`}
                  disabled={disabled}
                  status={available !== undefined ? { label: `${available} disp.`, tone: available <= 2 ? "warning" : "muted" } : undefined}
                  onAdd={() => addProduct(product)}
                  onDisabledSelect={() => setError(`${product.name} no tiene disponibilidad.`)}
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
              <div><Label htmlFor={`${formId}-fulfillment`}>Modalidad</Label><Select id={`${formId}-fulfillment`} value={fulfillmentType} onChange={(event) => setFulfillmentType(event.target.value as FulfillmentType)}><option value="pickup">{fulfillmentLabels.pickup}</option><option value="delivery">{fulfillmentLabels.delivery}</option></Select></div>
              <div><Label htmlFor={`${formId}-channel`}>Canal</Label><Select id={`${formId}-channel`} value={sourceChannel} onChange={(event) => setSourceChannel(event.target.value as SourceChannel)}><option value="counter">{channelLabels.counter}</option><option value="phone_whatsapp">{channelLabels.phone_whatsapp}</option><option value="other">{channelLabels.other}</option></Select></div>
              <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor={`${formId}-customer-name`}>Nombre</Label><Input id={`${formId}-customer-name`} value={customerName} onChange={(event) => setCustomerName(event.target.value)} maxLength={160} /></div><div><Label htmlFor={`${formId}-customer-phone`}>Teléfono</Label><Input id={`${formId}-customer-phone`} value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} inputMode="tel" maxLength={32} /></div></div>
              {fulfillmentType === "delivery" ? <><div><Label htmlFor={`${formId}-address`}>Dirección</Label><Input id={`${formId}-address`} value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} maxLength={300} /></div><div><Label htmlFor={`${formId}-reference`}>Referencia</Label><Input id={`${formId}-reference`} value={deliveryReference} onChange={(event) => setDeliveryReference(event.target.value)} maxLength={200} /></div></> : null}
              <div><Label htmlFor={`${formId}-promised-at`}>Prometido para</Label><Input id={`${formId}-promised-at`} type="datetime-local" value={promisedAt} onChange={(event) => setPromisedAt(event.target.value)} /></div>
              <div><Label htmlFor={`${formId}-note`}>Nota general</Label><textarea id={`${formId}-note`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>
            </CardContent>
          </Card>

          <div className="grid gap-2 sm:grid-cols-3">
            <Button variant="outline" disabled={submitting} onClick={() => void persist("save")}><Save className="mr-2 h-4 w-4" /> Guardar</Button>
            <Button variant="secondary" disabled={submitting} onClick={() => void persist("confirm")}>Guardar y confirmar</Button>
            <Button disabled={submitting} onClick={() => void persist("checkout")}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Confirmar y cobrar</Button>
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
