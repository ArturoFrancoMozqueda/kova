import { resolveApiErrorMessage, safeUserMessage, resolveUserFacingError } from "@/lib/apiError";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { FileText, Plus } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useLinkedRecord } from "@/operationsQueue/useLinkedRecord";
import {
  OperationsError,
  OperationsSession,
  useOnline,
  useOperationsRequest,
  type WorkspaceIdentity,
} from "@/automations/workspace";
import type { Product } from "@/catalog/types";
import type { Customer } from "@/customers/api";
import { statusLabels as orderStatusLabels } from "@/customerOrders/labels";
import type { CustomerOrderStatus } from "@/customerOrders/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewEmpty, ViewError } from "@/components/ui/view-states";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import type { CrmData, Opportunity } from "@/crm/types";
import type { Quote, QuotesPage } from "./types";

const money = (amount: string) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    Number(amount),
  );
const statusLabel = {
  draft: "Borrador",
  sent: "Compartida por el equipo",
  accepted: "Aceptada",
  expired: "Vencida",
  cancelled: "Cancelada",
};
const selectClass =
  "mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm";
type Action = "mark-sent" | "accept" | "cancel";

export default function QuotesView() {
  useDocumentTitle("Cotizaciones");
  return (
    <OperationsSession>
      {(identity) => <QuotesWorkspace identity={identity} />}
    </OperationsSession>
  );
}

function QuotesWorkspace({ identity }: { identity: WorkspaceIdentity }) {
  const request = useOperationsRequest("/api/v1", identity);
  const online = useOnline();
  const location = useLocation();
  const navigate = useNavigate();
  const linked = useLinkedRecord<Opportunity>(identity, "opportunity_id", "/api/v1/crm/opportunities");
  const [sourceOpportunity, setSourceOpportunity] = useState<Opportunity | null>(null);
  const dismissedLink = useRef(false);
  const consumeOpportunityLink = useCallback(() => {
    const params = new URLSearchParams(location.search);
    params.delete("opportunity_id");
    navigate({ pathname: location.pathname, search: params.toString(), hash: location.hash }, {
      replace: true,
      state: location.state,
    });
  }, [location, navigate]);
  const [page, setPage] = useState<QuotesPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [opportunityId, setOpportunityId] = useState("");
  const [opportunitiesError, setOpportunitiesError] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [items, setItems] = useState<
    { product_id: string; quantity: number }[]
  >([]);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState<{
    id: string;
    action: Action;
  } | null>(null);
  const [attested, setAttested] = useState(false);
  const mounted = useRef(true);
  const locked = useRef(false);
  const generation = useRef(0);
  const command = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => {
    dismissedLink.current = false;
    if (!linked.requested) return;
    setCreateOpen(false);
    setSourceOpportunity(null);
    setCustomerId("");
    setOpportunityId("");
    setItems([]);
    setExpiresAt("");
  }, [linked.id, linked.requested]);
  useEffect(() => {
    if (!linked.requested || !linked.record || dismissedLink.current) return;
    setSourceOpportunity(linked.record);
    setCustomerId(linked.record.customer_id);
    setOpportunityId(linked.record.id);
    setCreateOpen(true);
    consumeOpportunityLink();
  }, [linked.requested, linked.record, consumeOpportunityLink]);
  const closeOpportunityLink = () => {
    dismissedLink.current = true;
    consumeOpportunityLink();
  };
  const toggleCreate = () => {
    if (createOpen && sourceOpportunity) {
      setSourceOpportunity(null);
      setCustomerId("");
      setOpportunityId("");
    }
    setCreateOpen((value) => !value);
  };
  const load = useCallback(async () => {
    const revision = ++generation.current;
    setLoading(true);
    try {
      const [result, catalog] = await Promise.all([
        request<QuotesPage>(`/quotes?limit=50&offset=${offset}`),
        request<Product[]>("/catalog/products"),
      ]);
      if (mounted.current && revision === generation.current) {
        setPage(result);
        setProducts(
          catalog.filter(
            (row) => row.is_active && row.modifier_groups.length === 0,
          ),
        );
        setError("");
      }
    } catch (e) {
      if (
        mounted.current &&
        revision === generation.current &&
        !(e instanceof DOMException && e.name === "AbortError")
      )
        setError(
          resolveUserFacingError(e, "No pudimos cargar las cotizaciones."),
        );
    } finally {
      if (mounted.current && revision === generation.current) setLoading(false);
    }
  }, [request, offset]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);
  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      void request<Customer[]>(`/customers?q=${encodeURIComponent(search)}`)
        .then((result) => {
          if (active) setCustomers(result);
        })
        .catch((e: unknown) => {
          if (active && !(e instanceof DOMException && e.name === "AbortError"))
            setError(
              "No pudimos buscar los clientes. Vuelve a intentar la búsqueda.",
            );
        });
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [request, search]);
  useEffect(() => {
    let active = true;
    setOpportunities([]);
    setOpportunitiesError("");
    if (customerId)
      void request<CrmData>(
        `/crm?customer_id=${encodeURIComponent(customerId)}&limit=100&offset=0`,
      )
        .then((result) => {
          if (active) setOpportunities(result.opportunities ?? []);
        })
        .catch(() => {
          if (active)
            setOpportunitiesError(
              "No pudimos consultar oportunidades. Puedes continuar sin vincular una.",
            );
        });
    return () => {
      active = false;
    };
  }, [customerId, request]);
  const mutate = async (
    action: () => Promise<unknown>,
    success: string,
    after?: () => void,
  ) => {
    if (locked.current || !online) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (!mounted.current) return;
      after?.();
      setConfirmation(null);
      setAttested(false);
      setNotice(success);
      await load();
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof OperationsError && e.status === 409) {
        setConfirmation(null);
        setAttested(false);
        await load();
      }
      if (mounted.current)
        setError(
          resolveApiErrorMessage(e, safeUserMessage(e instanceof OperationsError ? (e.detail ?? e.message) : undefined, "No pudimos guardar la cotización.")),
        );
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const addItem = () => {
    const units = Number(quantity);
    if (
      !productId ||
      !Number.isInteger(units) ||
      units < 1 ||
      units > 100000 ||
      items.some((item) => item.product_id === productId) ||
      items.length >= 100
    )
      return;
    setItems((current) => [
      ...current,
      { product_id: productId, quantity: units },
    ]);
    setProductId("");
    setQuantity("1");
  };
  const create = (event: FormEvent) => {
    event.preventDefault();
    if (!items.length || !customerId || !expiresAt) return;
    const expiration = new Date(expiresAt);
    if (
      !Number.isFinite(expiration.getTime()) ||
      expiration.getTime() <= Date.now()
    ) {
      setError("Elige una vigencia futura para la cotización.");
      return;
    }
    const body = {
      customer_id: customerId,
      ...(opportunityId ? { opportunity_id: opportunityId } : {}),
      expires_at: expiration.toISOString(),
      items,
    };
    const serialized = JSON.stringify(body);
    if (command.current?.body !== serialized)
      command.current = { body: serialized, key: crypto.randomUUID() };
    const key = command.current.key;
    void mutate(
      () => request("/quotes", "POST", body, key),
      "Cotización creada con precios del catálogo. No se reservaron existencias ni se registró ingreso.",
      () => {
        command.current = null;
        setCreateOpen(false);
        setItems([]);
        setExpiresAt("");
      },
    );
  };
  const execute = (quote: Quote, action: Action) => {
    if (action !== "cancel" && !attested) return;
    const body = {
      expected_version: quote.version,
      ...(action === "mark-sent"
        ? { confirmed_shared: true }
        : action === "accept"
          ? { confirmed_customer_acceptance: true }
          : {}),
    };
    void mutate(
      () =>
        request(
          `/quotes/${quote.id}/${action}`,
          "POST",
          body,
          crypto.randomUUID(),
        ),
      action === "accept"
        ? "Aceptación registrada y pedido creado. Revisa el pedido antes de confirmar inventario o cobrar."
        : action === "mark-sent"
          ? "El equipo registró que compartió la cotización. Kova no envió mensajes."
          : "Cotización cancelada.",
    );
  };
  return (
    <ViewLayout className="space-y-7 [&_.animate-fade-in]:animate-none">
      <ViewHeader
        eyebrow="De la propuesta al pedido"
        title="Cotizaciones"
        meta="Acuerda productos, cantidades y vigencia antes de comprometer la operación."
        actions={
          <Button
            disabled={busy || !online || !page || linked.requested}
            onClick={toggleCreate}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {createOpen ? "Cerrar formulario" : "Nueva cotización"}
          </Button>
        }
      />
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
        Una cotización guarda precios del catálogo y su vigencia. El equipo
        comparte la propuesta y registra la aceptación del cliente. Aceptarla
        crea un pedido nuevo; no cobra ni reserva inventario automáticamente.
      </p>
      {!online && (
        <p role="status" className="rounded-xl border p-4 text-sm">
          Conéctate para crear o actualizar cotizaciones.
        </p>
      )}
      {linked.requested && (
        <section aria-label="Oportunidad de origen" className="space-y-3 rounded-xl border p-4">
          {linked.loading && <p role="status">Verificando la oportunidad de origen…</p>}
          {linked.error && <p role="alert">{linked.error}</p>}
          {linked.error && online && linked.id && <Button variant="outline" onClick={linked.reload}>Reintentar oportunidad</Button>}
          <Button variant="outline" onClick={closeOpportunityLink}>Cancelar precarga</Button>
        </section>
      )}
      {error && (
        <ViewError
          message={error}
          onRetry={() => void load()}
          retryLabel="Consultar datos actualizados"
        />
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl border border-kova-growth/30 bg-kova-growth/10 p-4 text-sm text-kova-growth-strong"
        >
          {notice}
        </p>
      )}
      {loading && !page && <p role="status">Cargando cotizaciones…</p>}
      {createOpen && !linked.requested && (
        <form
          onSubmit={create}
          aria-label="Nueva cotización"
          className="space-y-5 rounded-2xl border bg-card p-5"
        >
          <h2 className="text-lg font-semibold">Prepara la propuesta</h2>
          <fieldset
            disabled={busy || !online}
            className="grid gap-4 sm:grid-cols-2"
          >
            <legend className="sr-only">Cliente y vigencia</legend>
            <div>
              <Label htmlFor="quote-search">Buscar cliente</Label>
              <Input
                id="quote-search"
                value={search}
                maxLength={160}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="quote-customer">Cliente registrado</Label>
              <select
                id="quote-customer"
                required
                className={selectClass}
                value={customerId}
                onChange={(event) => {
                  setCustomerId(event.target.value);
                  setOpportunityId("");
                  setSourceOpportunity(null);
                }}
              >
                <option value="">Elige un cliente</option>
                {customerId &&
                  (!customers.some((row) => row.id === customerId) || sourceOpportunity?.customer_id === customerId) && (
                    <option value={customerId}>
                      {sourceOpportunity?.customer_id === customerId ? sourceOpportunity.customer_name : "Cliente seleccionado"}
                    </option>
                  )}
                {customers.filter((row) => row.id !== sourceOpportunity?.customer_id).map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="quote-opportunity">
                Oportunidad de origen (opcional)
              </Label>
              <select
                id="quote-opportunity"
                className={selectClass}
                value={opportunityId}
                disabled={!customerId}
                onChange={(event) => setOpportunityId(event.target.value)}
              >
                <option value="">Sin oportunidad vinculada</option>
                {sourceOpportunity?.customer_id === customerId && (
                    <option value={sourceOpportunity.id}>{sourceOpportunity.title}</option>
                  )}
                {opportunities.filter((row) => row.id !== sourceOpportunity?.id).map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.title}
                  </option>
                ))}
              </select>
              {opportunitiesError && (
                <p className="mt-2 text-sm" role="status">
                  {opportunitiesError}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="quote-expires">
                Vigencia (hora de este dispositivo)
              </Label>
              <Input
                id="quote-expires"
                required
                type="datetime-local"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </div>
          </fieldset>
          <fieldset disabled={busy || !online} className="space-y-4">
            <legend className="font-medium">Productos de la propuesta</legend>
            <p className="text-sm text-muted-foreground">
              Los precios se toman de tu catálogo al crear la cotización.
              Para productos con opciones adicionales, prepara un pedido.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <Label htmlFor="quote-product">Producto</Label>
                <select
                  id="quote-product"
                  className={selectClass}
                  value={productId}
                  onChange={(event) => setProductId(event.target.value)}
                >
                  <option value="">Elige un producto</option>
                  {products
                    .filter(
                      (row) =>
                        !items.some((item) => item.product_id === row.id),
                    )
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name} · {money(row.price_amount)}
                      </option>
                    ))}
                </select>
              </div>
              <div className="sm:max-w-28">
                <Label htmlFor="quote-quantity">Cantidad</Label>
                <Input
                  id="quote-quantity"
                  type="number"
                  min="1"
                  max="100000"
                  step="1"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={addItem}
                disabled={!productId || items.length >= 100}
              >
                Agregar producto
              </Button>
            </div>
            {items.length > 0 && (
              <ul className="divide-y rounded-xl border px-4">
                {items.map((item) => (
                  <li
                    key={item.product_id}
                    className="flex items-center justify-between gap-3 py-3 text-sm"
                  >
                    <span>
                      {item.quantity} ×{" "}
                      {products.find((row) => row.id === item.product_id)
                        ?.name ?? "Producto seleccionado"}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      onClick={() =>
                        setItems((rows) =>
                          rows.filter(
                            (row) => row.product_id !== item.product_id,
                          ),
                        )
                      }
                      aria-label={`Quitar ${products.find((row) => row.id === item.product_id)?.name ?? "producto"}`}
                    >
                      Quitar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
          <Button
            type="submit"
            disabled={
              busy || !online || !customerId || !expiresAt || items.length === 0
            }
          >
            Crear cotización
          </Button>
        </form>
      )}
      {page && (
        <section className="space-y-4" aria-labelledby="quote-history">
          <h2 id="quote-history" className="text-lg font-semibold">
            Propuestas y pedidos vinculados
          </h2>
          {page.items.length === 0 ? (
            <ViewEmpty
              icon={<FileText className="h-6 w-6" />}
              title="Una propuesta clara para cada cliente"
              body="Crea una cotización con productos reales del catálogo y una vigencia. Sólo conviértela en pedido después de registrar la aceptación del cliente."
            />
          ) : (
            page.items.map((quote) => (
              <article
                key={quote.id}
                className="space-y-4 rounded-2xl border bg-card p-5"
              >
                <QuoteJourney
                  key={`${quote.id}:${quote.version}`}
                  identity={identity}
                  quoteId={quote.id}
                />
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words font-semibold">
                      {quote.folio} · {quote.customer_name}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Vigencia:{" "}
                      {new Date(quote.expires_at).toLocaleString("es-MX")}
                    </p>
                    <span className="mt-2 inline-block rounded-full bg-muted px-2 py-1 text-xs">
                      {statusLabel[quote.status]}
                    </span>
                  </div>
                  <p className="font-semibold">{money(quote.total_amount)}</p>
                </div>
                <details className="rounded-xl bg-muted p-4 text-sm">
                  <summary className="cursor-pointer font-medium">
                    Revisar productos y precios acordados
                  </summary>
                  <ul className="mt-3 space-y-2">
                    {quote.items.map((item) => (
                      <li key={item.id} className="flex justify-between gap-3">
                        <span className="min-w-0 break-words">
                          {item.quantity} × {item.product_name} ·{" "}
                          {money(item.unit_price_amount)} c/u
                        </span>
                        <span className="shrink-0">
                          {money(item.line_total_amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
                {quote.customer_order_id && (
                  <Link
                    to={`/pedidos/${quote.customer_order_id}`}
                    className="inline-flex min-h-11 items-center text-sm text-kova-blue underline"
                  >
                    Revisar pedido creado
                  </Link>
                )}
                {confirmation?.id === quote.id ? (
                  <div className="space-y-3 rounded-xl border p-4">
                    <p className="text-sm">
                      {confirmation.action === "mark-sent"
                        ? "Registra únicamente una propuesta que ya compartiste por tu cuenta."
                        : confirmation.action === "accept"
                          ? "Se creará un pedido nuevo con estos artículos. El cobro y la confirmación de inventario se realizan después en Pedidos."
                          : "Cancelar retira esta propuesta; su historial se conserva."}
                    </p>
                    {confirmation.action !== "cancel" && (
                      <label className="flex min-h-11 items-start gap-3 text-sm leading-6">
                        <input
                          className="mt-1"
                          type="checkbox"
                          checked={attested}
                          onChange={(event) =>
                            setAttested(event.target.checked)
                          }
                          disabled={busy || !online}
                        />
                        {confirmation.action === "mark-sent"
                          ? "Confirmo que el equipo ya compartió esta cotización con el cliente."
                          : "Confirmo que el cliente aceptó esta cotización y sus condiciones."}
                      </label>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        className="h-auto min-h-11 max-w-full whitespace-normal"
                        disabled={
                          busy ||
                          !online ||
                          (confirmation.action !== "cancel" && !attested)
                        }
                        onClick={() => execute(quote, confirmation.action)}
                      >
                        {confirmation.action === "accept"
                          ? "Registrar aceptación y crear pedido"
                          : confirmation.action === "mark-sent"
                            ? "Registrar que fue compartida"
                            : "Confirmar cancelación"}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setConfirmation(null);
                          setAttested(false);
                        }}
                      >
                        Volver
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {quote.status === "draft" && (
                      <Button
                        variant="outline"
                        disabled={busy || !online}
                        onClick={() => {
                          setConfirmation({
                            id: quote.id,
                            action: "mark-sent",
                          });
                          setAttested(false);
                        }}
                      >
                        Registrar propuesta compartida
                      </Button>
                    )}
                    {quote.status === "sent" && (
                      <Button
                        disabled={busy || !online}
                        onClick={() => {
                          setConfirmation({ id: quote.id, action: "accept" });
                          setAttested(false);
                        }}
                      >
                        Registrar aceptación
                      </Button>
                    )}
                    {["draft", "sent"].includes(quote.status) && (
                      <Button
                        variant="ghost"
                        disabled={busy || !online}
                        onClick={() => {
                          setConfirmation({ id: quote.id, action: "cancel" });
                          setAttested(false);
                        }}
                      >
                        Cancelar cotización
                      </Button>
                    )}
                  </div>
                )}
              </article>
            ))
          )}
        </section>
      )}
      {page && (offset > 0 || offset + page.items.length < page.total) && (
        <nav
          aria-label="Páginas de cotizaciones"
          className="flex flex-wrap items-center gap-3"
        >
          <Button
            variant="outline"
            disabled={busy || loading || !online || offset === 0}
            onClick={() => setOffset((value) => Math.max(0, value - 50))}
          >
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {Math.floor(offset / 50) + 1}
          </span>
          <Button
            variant="outline"
            disabled={
              busy ||
              loading ||
              !online ||
              offset + page.items.length >= page.total
            }
            onClick={() => setOffset((value) => value + 50)}
          >
            Más cotizaciones
          </Button>
        </nav>
      )}
    </ViewLayout>
  );
}

type Journey = {
  quote_id: string;
  catalog_request_id?: string | null;
  opportunity_id: string | null;
  opportunity_stage: string | null;
  customer_order_id: string | null;
  customer_order_status: CustomerOrderStatus | null;
  sale_order_id: string | null;
  sale_status: "completed" | "voided" | null;
  sale_total_amount: string | null;
  recorded_payments_amount: string | null;
  external_collection_verified: false;
};
function QuoteJourney({
  identity,
  quoteId,
}: {
  identity: WorkspaceIdentity;
  quoteId: string;
}) {
  const request = useOperationsRequest("/api/v1/quotes", identity);
  const [data, setData] = useState<Journey | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await request<Journey>(`/${quoteId}/journey`);
      if (active.current) setData(result);
    } catch (e) {
      if (active.current)
        setError(
          resolveUserFacingError(e, "No pudimos consultar el recorrido."),
        );
    } finally {
      if (active.current) setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => void load()}
      >
        {busy ? "Consultando recorrido…" : "Ver recorrido comercial"}
      </Button>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      {data && (
        <div className="space-y-2 rounded-xl bg-kova-mist p-4 text-sm">
          <p className="font-medium">Origen y resultado registrado</p>
          {data.catalog_request_id && (
            <p>
              Solicitud de catálogo vinculada.{" "}
              <Link to="/commercial-requests" className="underline">
                Consultar solicitudes
              </Link>
            </p>
          )}
          <p>
            {data.opportunity_id
              ? "Oportunidad comercial vinculada"
              : "Sin oportunidad de origen"}
            .{" "}
            {data.opportunity_id && (
              <Link to={`/crm?opportunity_id=${encodeURIComponent(data.opportunity_id)}`} className="underline">
                Ver seguimiento
              </Link>
            )}
          </p>
          <p>
            {data.customer_order_id
              ? `Pedido vinculado: ${(data.customer_order_status ? orderStatusLabels[data.customer_order_status] : "estado no disponible")}`
              : "Todavía no se convierte en pedido"}
            .{" "}
            {data.customer_order_id && (
              <Link
                to={`/pedidos/${data.customer_order_id}`}
                className="underline"
              >
                Consultar pedido
              </Link>
            )}
          </p>
          {data.sale_order_id ? (
            <p>
              Venta {data.sale_status === "voided" ? "anulada" : "registrada"}:{" "}
              {data.sale_total_amount
                ? money(data.sale_total_amount)
                : "importe no disponible"}
              . Pagos registrados:{" "}
              {data.recorded_payments_amount
                ? money(data.recorded_payments_amount)
                : "sin información"}
              .{" "}
              <Link to={`/orders/${data.sale_order_id}`} className="underline">
                Consultar venta
              </Link>
            </p>
          ) : (
            <p>Sin venta vinculada.</p>
          )}
          <p className="text-xs text-kova-muted">
            Los pagos registrados en POS no acreditan un cobro electrónico
            verificado por un proveedor.
          </p>
        </div>
      )}
    </div>
  );
}
