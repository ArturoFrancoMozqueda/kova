import { getActiveBranchId } from "@/branches/activeBranch";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, ClipboardList, CloudOff, PackageCheck, Plus, Search } from "lucide-react";
import { Link, Navigate } from "react-router-dom";

import { useAuth } from "@/auth/useAuth";
import { useFeature } from "@/auth/useFeature";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ViewHeader } from "@/components/ui/view-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewEmpty, ViewError } from "@/components/ui/view-states";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useIsOnline } from "@/offline/useSyncQueue";
import { formatDateTime, formatMoney } from "@/orders/format";
import { listCustomerOrders } from "./api";
import { readCustomerOrderCache, saveCustomerOrderList } from "./cache";
import { fulfillmentLabels, paymentLabels, statusLabels } from "./labels";
import type { CustomerOrderListResponse, CustomerOrderPaymentStatus, CustomerOrderStatus, FulfillmentType } from "./types";

const PAGE_SIZE = 25;

function promisedRange(date: string): { promised_from?: string; promised_to?: string } {
  if (!date) return {};
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { promised_from: start.toISOString(), promised_to: end.toISOString() };
}

const statuses: Array<CustomerOrderStatus | undefined> = [
  undefined,
  "new",
  "confirmed",
  "in_progress",
  "ready",
  "fulfilled",
  "cancelled",
];

export default function CustomerOrderListView() {
  useDocumentTitle("Pedidos");
  const enabled = useFeature("customer_orders");
  const { state } = useAuth();
  const tenantId = state.status === "authenticated" ? state.tenantId : "";
  const branchId = getActiveBranchId(tenantId, state.status === "authenticated" ? state.user.id : "");
  const isOnline = useIsOnline();
  const [status, setStatus] = useState<CustomerOrderStatus | undefined>();
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<CustomerOrderPaymentStatus | "">("");
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType | "">("");
  const [promisedDate, setPromisedDate] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<CustomerOrderListResponse | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    const isCurrent = () => generation === loadGeneration.current;
    if (!tenantId) return;
    setLoading(true);
    setError(false);
    if (!isOnline) {
      const cached = await readCustomerOrderCache(tenantId, branchId);
      if (!isCurrent()) return;
      setData(cached?.list ?? null);
      setCachedAt(cached?.cached_at ?? null);
      setError(!cached);
      setLoading(false);
      return;
    }
    try {
      const result = await listCustomerOrders({
        status,
        search: submittedSearch || undefined,
        payment_status: paymentStatus || undefined,
        fulfillment_type: fulfillmentType || undefined,
        ...promisedRange(promisedDate),
        limit: PAGE_SIZE,
        offset,
      });
      if (!isCurrent()) return;
      setData(result);
      setCachedAt(null);
      await saveCustomerOrderList(tenantId, result, branchId);
    } catch {
      if (!isCurrent()) return;
      const cached = await readCustomerOrderCache(tenantId, branchId);
      if (!isCurrent()) return;
      setData(cached?.list ?? null);
      setCachedAt(cached?.cached_at ?? null);
      setError(!cached);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [branchId, fulfillmentType, isOnline, offset, paymentStatus, promisedDate, status, submittedSearch, tenantId]);

  useEffect(() => {
    void load();
    return () => { loadGeneration.current += 1; };
  }, [load]);

  if (!enabled) return <Navigate to="/register" replace />;

  const promisedBounds = promisedRange(promisedDate);
  const promisedFrom = promisedBounds.promised_from ? new Date(promisedBounds.promised_from).getTime() : NaN;
  const promisedTo = promisedBounds.promised_to ? new Date(promisedBounds.promised_to).getTime() : NaN;
  const visibleItems = cachedAt
    ? (data?.items ?? []).filter((item) => {
        const statusMatches = !status || item.status === status;
        const paymentMatches = !paymentStatus || item.payment_status === paymentStatus;
        const fulfillmentMatches = !fulfillmentType || item.fulfillment_type === fulfillmentType;
        // Match the inclusive API range using instants, not the UTC date text.
        const promisedAt = item.promised_at ? new Date(item.promised_at).getTime() : NaN;
        const promisedMatches = !promisedDate || (
          promisedAt >= promisedFrom && promisedAt <= promisedTo
        );
        const query = submittedSearch.toLocaleLowerCase("es-MX");
        const searchMatches =
          !query ||
          item.folio.toLocaleLowerCase("es-MX").includes(query) ||
          item.customer_name?.toLocaleLowerCase("es-MX").includes(query) ||
          item.customer_phone?.includes(query);
        return statusMatches && paymentMatches && fulfillmentMatches && promisedMatches && searchMatches;
      })
    : (data?.items ?? []);

  return (
    <ViewLayout width="wide" className="animate-fade-in">
      <ViewHeader
        title="Pedidos"
        meta="Prepara, cobra y entrega sin mezclar el trabajo pendiente con tus ventas."
        actions={
          isOnline ? (
            <div className="flex flex-wrap gap-2">
            {state.status === "authenticated" && ["owner", "manager"].includes(state.user.role) && <Link to="/commercial-requests" className={buttonVariants({ variant: "outline" })}>Solicitudes del menú</Link>}
            <Link to="/pedidos/nuevo" className={buttonVariants()}>
              <Plus className="mr-2 h-4 w-4" /> Nuevo pedido
            </Link>
            </div>
          ) : null
        }
      />

      {cachedAt ? (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          <CloudOff className="h-4 w-4 shrink-0" />
          <span>Solo lectura · última actualización {formatDateTime(cachedAt)}.</span>
        </div>
      ) : null}

      <div className="mb-4 flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 overflow-x-auto pb-1">
          <SegmentedControl<CustomerOrderStatus | "all">
            ariaLabel="Estado del pedido"
            value={status ?? "all"}
            onValueChange={(value) => { setStatus(value === "all" ? undefined : value); setOffset(0); }}
            options={statuses.map((value) => ({
              value: value ?? "all",
              label: `${value ? statusLabels[value] : "Activos y recientes"}${value && data?.status_counts[value] !== undefined ? ` ${data.status_counts[value]}` : ""}`,
            }))}
          />
        </div>
        <form
          className="flex w-full shrink-0 gap-2 xl:w-80"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmittedSearch(search.trim());
            setOffset(0);
          }}
        >
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Buscar pedidos por folio, cliente o teléfono"
              placeholder="Folio, cliente o teléfono"
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="outline">Buscar</Button>
        </form>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Select aria-label="Filtrar por pago" value={paymentStatus} onChange={(event) => { setPaymentStatus(event.target.value as CustomerOrderPaymentStatus | ""); setOffset(0); }}>
          <option value="">Cualquier estado de pago</option>
          {Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Select aria-label="Filtrar por modalidad" value={fulfillmentType} onChange={(event) => { setFulfillmentType(event.target.value as FulfillmentType | ""); setOffset(0); }}>
          <option value="">Cualquier modalidad</option>
          {Object.entries(fulfillmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Input aria-label="Filtrar por fecha prometida" type="date" value={promisedDate} onChange={(event) => { setPromisedDate(event.target.value); setOffset(0); }} />
      </div>

      {loading ? (
        <div className="grid gap-3">
          {[1, 2, 3].map((key) => <Skeleton key={key} className="h-28 w-full rounded-kova-lg" />)}
        </div>
      ) : error ? (
        <ViewError message={isOnline ? "No pudimos consultar los pedidos. Intenta de nuevo." : "No hay pedidos guardados para consultar sin conexión."} onRetry={() => void load()} retryLabel="Reintentar" />
      ) : visibleItems.length === 0 ? (
        <ViewEmpty
          icon={<ClipboardList className="h-6 w-6" />}
          title="No hay pedidos con estos filtros"
          body="Crea un pedido para reservar producto, prepararlo y cobrarlo después."
          primaryCta={isOnline ? { label: "Crear pedido", to: "/pedidos/nuevo" } : undefined}
        />
      ) : (
        <div className="grid gap-3">
          {visibleItems.map((order) => (
            <Link key={order.id} to={`/pedidos/${order.id}`} className="group block">
              <Card className="transition-[border-color,box-shadow] duration-hover group-hover:border-primary/30 group-hover:shadow-kova-card-hover">
                <CardContent className="grid gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="font-semibold tabular-nums">{order.folio}</span>
                      <Badge variant={order.status === "cancelled" ? "destructive" : order.status === "fulfilled" ? "success" : "secondary"}>
                        {statusLabels[order.status]}
                      </Badge>
                      <Badge variant={order.payment_status === "paid" ? "success" : "outline"}>
                        {paymentLabels[order.payment_status]}
                      </Badge>
                      {order.stock_conflict ? (
                        <Badge variant="warning"><AlertTriangle className="mr-1 h-3 w-3" /> Stock comprometido</Badge>
                      ) : null}
                      {order.promised_at && new Date(order.promised_at) < new Date() && !["fulfilled", "cancelled"].includes(order.status) ? (
                        <Badge variant="warning">Vencido</Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-sm font-medium">
                      {order.customer_name || "Cliente sin nombre"}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span>{fulfillmentLabels[order.fulfillment_type]}</span>
                      <span>{order.promised_at ? formatDateTime(order.promised_at) : "Lo antes posible"}</span>
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-4 sm:block sm:text-right">
                    <p className="text-lg font-bold tabular-nums">{formatMoney(order.total_amount)}</p>
                    <span className="mt-1 inline-flex items-center text-xs font-medium text-primary">
                      <PackageCheck className="mr-1 h-3.5 w-3.5" /> Ver pedido
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
          {!cachedAt && data && data.total > PAGE_SIZE ? (
            <div className="flex items-center justify-between pt-2">
              <Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}><ChevronLeft className="mr-2 h-4 w-4" /> Anterior</Button>
              <span className="text-sm text-muted-foreground">{offset + 1}–{Math.min(offset + PAGE_SIZE, data.total)} de {data.total}</span>
              <Button variant="outline" disabled={offset + PAGE_SIZE >= data.total} onClick={() => setOffset(offset + PAGE_SIZE)}>Siguiente <ChevronRight className="ml-2 h-4 w-4" /></Button>
            </div>
          ) : null}
        </div>
      )}
    </ViewLayout>
  );
}
