import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  OperationsSession,
  type WorkspaceIdentity,
} from "@/automations/workspace";
import { useOperationsPanel } from "@/automations/useOperationsPanel";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewError } from "@/components/ui/view-states";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import type { Customer } from "@/customers/api";
import { CatalogOrderReview } from "./CatalogOrderReview";
import { useAuth } from "@/auth/useAuth";

type RequestRow = {
  id: string;
  name: string;
  contact: string;
  message: string;
  product_ids: string[];
  status: "new" | "converted" | "dismissed" | "accepted";
  order_lines?: { product_id: string; product_name: string; quantity: number; unit_price_amount: string; line_total_amount: string }[];
  origin?: "remote" | "in_store" | null;
  customer_order_id?: string | null;
  customer_id: string | null;
  opportunity_id: string | null;
  version: number;
  created_at: string;
};
type RequestList = { requests: RequestRow[]; has_more: boolean };
const labels = {
  new: "Por revisar",
  converted: "Oportunidad creada",
  dismissed: "Descartada",
  accepted: "Pedido creado",
};
export default function CommercialRequestsView() {
  useDocumentTitle("Solicitudes del catálogo");
  return (
    <OperationsSession>
      {(identity) => <RequestsWorkspace identity={identity} />}
    </OperationsSession>
  );
}
function RequestsWorkspace({ identity }: { identity: WorkspaceIdentity }) {
  const { state } = useAuth();
  const ordersEnabled = state.status === "authenticated" && state.featureFlags?.customer_orders === true;
  const [offset, setOffset] = useState(0);
  const panel = useOperationsPanel<RequestList>(
    "/api/v1",
    identity,
    `/crm/requests?limit=50&offset=${offset}`,
  );
  const { request } = panel;
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<RequestRow | null>(null);
  const [orderReview, setOrderReview] = useState<RequestRow | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [customerError, setCustomerError] = useState("");
  useEffect(() => {
    let active = true;
    setCustomers([]);
    const timer = window.setTimeout(() => {
      void request<Customer[]>(`/customers?q=${encodeURIComponent(search)}`)
        .then((rows) => {
          if (active) {
            setCustomers(rows);
            setCustomerError("");
          }
        })
        .catch(() => {
          if (active)
            setCustomerError(
              "No pudimos buscar clientes. Cambia la búsqueda para reintentar.",
            );
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [request, search]);
  const resolve = async (status: "converted" | "dismissed") => {
    if (!selected) return;
    if (
      await panel.mutate(
        `/crm/requests/${selected.id}/resolve`,
        "POST",
        {
          expected_version: selected.version,
          status,
          ...(status === "converted" ? { customer_id: customerId } : {}),
        },
        status === "converted"
          ? "Oportunidad creada con el cliente que elegiste."
          : "Solicitud descartada.",
      )
    ) {
      setSelected(null);
      setCustomerId("");
    }
  };
  return (
    <ViewLayout className="space-y-6">
      <ViewHeader
        eyebrow="Captación"
        title="Solicitudes del catálogo"
        meta="Recibe pedidos y consultas del menú digital, en el negocio y a distancia."
      />
      <p className="max-w-3xl text-sm text-kova-muted">
        Abre una solicitud para revisar sus productos y elegir al cliente.
        Después podrás confirmar, preparar y cobrar el pedido desde Pedidos.
      </p>
      {panel.error && (
        <ViewError
          message={panel.error}
          onRetry={() => void panel.load()}
          retryLabel="Volver a cargar"
        />
      )}
      {panel.notice && (
        <p role="status" className="rounded-xl bg-kova-mist p-4">
          {panel.notice}
        </p>
      )}
      {panel.loading && <p role="status">Cargando solicitudes…</p>}
      {panel.data?.requests.length === 0 && (
        <section className="rounded-2xl border border-kova-border bg-white p-6">
          <h2 className="font-semibold">
            Aquí llegarán los pedidos y consultas de tu menú
          </h2>
          <p className="mt-2 text-sm text-kova-muted">
            Comparte tu enlace o QR para que tus clientes puedan dejar una
            solicitud.
          </p>
          <Link
            className="mt-3 inline-flex min-h-11 items-center underline"
            to="/settings/public-catalog"
          >
            Preparar catálogo y QR
          </Link>
        </section>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {panel.data?.requests.map((row) => (
          <article
            key={row.id}
            className="min-w-0 space-y-3 rounded-2xl border border-kova-border bg-white p-5"
          >
            <div className="flex flex-wrap justify-between gap-2">
              <h2 className="break-words font-semibold">{row.name}</h2>
              <span className="text-sm text-kova-muted">
                {labels[row.status]}
              </span>
            </div>
            <p className="break-words text-sm">{row.contact}</p>
            <p className="whitespace-pre-wrap break-words text-sm">
              {row.message}
            </p>
            <p className="text-xs text-kova-muted">
              {new Date(row.created_at).toLocaleString("es-MX")} ·{" "}
              {row.product_ids.length} productos de la solicitud
            </p>
            {row.status === "converted" && row.opportunity_id && panel.online && (
              <Link
                to={`/crm?opportunity_id=${encodeURIComponent(row.opportunity_id)}`}
                className="inline-flex min-h-11 items-center rounded-md text-sm font-medium text-kova-blue underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kova-blue"
              >
                Ver oportunidad
              </Link>
            )}
            {row.customer_order_id && panel.online && ordersEnabled && <Link to={`/pedidos/${encodeURIComponent(row.customer_order_id)}`} className="inline-flex min-h-11 items-center text-sm font-medium text-kova-blue underline">Ver pedido</Link>}
            {row.status === "new" && ordersEnabled && Boolean(row.order_lines?.length) && <Button className="h-auto min-h-11 whitespace-normal" disabled={panel.busy || !panel.online} onClick={() => { setOrderReview(row); setSelected(null); setSearch(""); }}>Revisar pedido de {row.name}</Button>}
            {row.status === "new" && (
              <Button
                className="h-auto min-h-11 whitespace-normal text-left"
                variant="outline"
                disabled={panel.busy || !panel.online}
                onClick={() => {
                  setSelected(row);
                  setCustomerId("");
                }}
              >
                Revisar solicitud de {row.name}
              </Button>
            )}
          </article>
        ))}
      </div>
      {orderReview && ordersEnabled && <CatalogOrderReview key={orderReview.id} identity={identity} row={orderReview} customers={customers} search={search} onSearch={setSearch} customerError={customerError} onAccepted={() => void panel.load()} onClose={() => setOrderReview(null)} />}
      {selected && (
        <section
          aria-label="Resolver solicitud"
          className="space-y-4 rounded-2xl border border-kova-border bg-white p-6"
        >
          <h2 className="text-xl font-semibold">Revisar a {selected.name}</h2>
          <label className="block text-sm">
            Buscar cliente
            <input
              className="mt-1 min-h-11 w-full rounded-lg border p-3"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {customerError && <p role="alert">{customerError}</p>}
          <label className="block text-sm">
            Vincular con cliente registrado
            <select
              className="mt-1 min-h-11 w-full rounded-lg border p-3"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">Selecciona un cliente verificado</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-kova-muted">
            Si aún no existe,{" "}
            <Link className="underline" to="/customers">
              registra al cliente
            </Link>{" "}
            y vuelve a revisar. Kova no une contactos automáticamente.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              className="h-auto min-h-11 whitespace-normal text-left"
              disabled={!customerId || panel.busy || !panel.online}
              onClick={() => void resolve("converted")}
            >
              Crear oportunidad con este cliente
            </Button>
            <Button
              className="h-auto min-h-11 whitespace-normal text-left"
              variant="outline"
              disabled={panel.busy || !panel.online}
              onClick={() => void resolve("dismissed")}
            >
              Confirmar descarte
            </Button>
            <Button
              className="h-auto min-h-11 whitespace-normal text-left"
              variant="ghost"
              disabled={panel.busy}
              onClick={() => setSelected(null)}
            >
              Cerrar revisión
            </Button>
          </div>
        </section>
      )}
      <nav aria-label="Páginas de solicitudes" className="flex flex-wrap gap-3">
        <Button
          className="h-auto min-h-11 whitespace-normal text-left"
          variant="outline"
          disabled={offset === 0 || panel.loading}
          onClick={() => setOffset((value) => Math.max(0, value - 50))}
        >
          Anteriores
        </Button>
        <Button
          className="h-auto min-h-11 whitespace-normal text-left"
          variant="outline"
          disabled={!panel.data?.has_more || panel.loading}
          onClick={() => setOffset((value) => value + 50)}
        >
          Siguientes
        </Button>
      </nav>
    </ViewLayout>
  );
}
