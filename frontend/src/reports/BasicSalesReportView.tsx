import { getActiveBranchId } from "@/branches/activeBranch";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Receipt, RotateCcw, ShoppingBag, ShoppingCart, TrendingUp } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { REPORTS_VIEW_ALL_PERMISSION, usePermission } from "@/auth/permissions";
import { commercialPlanIdentity } from "@/billing/entitlements";
import { PlanFeatureNotice } from "@/billing/PlanFeatureNotice";
import { SubscriptionInactivePanel } from "@/billing/SubscriptionInactivePanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewEmpty, ViewError } from "@/components/ui/view-states";
import { DonutChart, KpiCard, RankBars } from "@/components/visual";
import { getDashboardOverview } from "@/dashboard/api";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useTenantTimezone } from "@/hooks/useTenantTimezone";
import { formatMoney } from "@/orders/format";
import { getPaymentBreakdown, getSalesSummary, getTopProducts } from "./api";
import { PermissionDenied } from "./components/ReportStates";
import { isValidDateRange, presetRange } from "./utils/dateRange";

/** Core reports stay useful after a downgrade and never request premium analysis. */
export function BasicSalesReportView({ dashboard = false }: { dashboard?: boolean }) {
  useDocumentTitle(dashboard ? "Inicio · Kova" : "Reportes de ventas · Kova");
  const { state } = useAuth();
  const permitted = usePermission(REPORTS_VIEW_ALL_PERMISSION);
  const { timezone, isResolved } = useTenantTimezone();
  const [customRange, setCustomRange] = useState<{ startDate: string; endDate: string } | null>(null);
  const [draft, setDraft] = useState<{ startDate: string; endDate: string } | null>(null);
  const range = customRange ?? presetRange("today", timezone);
  const inputs = draft ?? range;
  const access = state.status === "authenticated" ? state.commercialAccess : undefined;
  const branchId = state.status === "authenticated" ? getActiveBranchId(state.tenantId, state.user.id) : undefined;
  const identity = state.status === "authenticated"
    ? [state.tenantId, state.user.id, state.user.role, branchId, commercialPlanIdentity(access)] : [];
  const enabled = permitted && isResolved && state.status === "authenticated" && access?.allowed !== false;
  const key = ["core-sales-report", ...identity, range.startDate, range.endDate];
  const summary = useQuery({
    queryKey: [...key, "summary", dashboard], enabled,
    queryFn: async () => {
      if (dashboard && customRange === null) {
        const overview = await getDashboardOverview("day", branchId ?? "all");
        if (overview?.summary) return overview.summary;
      }
      return getSalesSummary(range.startDate, range.endDate);
    },
  });
  const payments = useQuery({ queryKey: [...key, "payments"], enabled,
    queryFn: () => getPaymentBreakdown(range.startDate, range.endDate) });
  const products = useQuery({ queryKey: [...key, "products"], enabled,
    queryFn: () => getTopProducts(range.startDate, range.endDate) });
  const retry = () => { void summary.refetch(); void payments.refetch(); void products.refetch(); };

  if (!permitted) return <PermissionDenied />;
  return (
    <ViewLayout className="space-y-6">
      <ViewHeader title={dashboard ? "Tu negocio hoy" : "Reportes de ventas"}
        eyebrow="Ventas, cobros y productos" meta="Consulta tus resultados de operación. El análisis avanzado está incluido en Gestión." />
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => {
        event.preventDefault();
        if (isValidDateRange(inputs.startDate, inputs.endDate)) setCustomRange(inputs);
      }}>
        <div className="space-y-1"><Label htmlFor="core-report-start">Desde</Label>
          <Input id="core-report-start" type="date" value={inputs.startDate} required max={inputs.endDate}
            onChange={(event) => setDraft({ ...inputs, startDate: event.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="core-report-end">Hasta</Label>
          <Input id="core-report-end" type="date" value={inputs.endDate} required min={inputs.startDate}
            onChange={(event) => setDraft({ ...inputs, endDate: event.target.value })} /></div>
        <Button type="submit" disabled={!isResolved || !isValidDateRange(inputs.startDate, inputs.endDate)}>Consultar</Button>
      </form>
      {access?.allowed === false ? <SubscriptionInactivePanel /> : <>
        {summary.isError ? <ViewError message="No pudimos cargar el resumen de ventas." onRetry={retry} retryLabel="Reintentar" />
          : summary.data ? <>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Resumen de ventas" role="group">
              <KpiCard emphasis label="Ventas netas" value={formatMoney(summary.data.net_sales)} icon={<TrendingUp />} note="Después de devoluciones" />
              <KpiCard label="Ventas completadas" value={summary.data.order_count.toLocaleString("es-MX")} icon={<ShoppingBag />} note="En el periodo" />
              <KpiCard label="Devoluciones" value={formatMoney(summary.data.refund_total)} icon={<RotateCcw />}
                note={`${summary.data.refund_count.toLocaleString("es-MX")} ${summary.data.refund_count === 1 ? "devolución" : "devoluciones"}`} />
              <KpiCard label="Ventas brutas" value={formatMoney(summary.data.gross_sales)} icon={<Receipt />} note="Antes de devoluciones" />
            </div>
            {summary.data.order_count === 0 && <ViewEmpty icon={<ShoppingCart className="h-5 w-5" />} illustration="chart" title="Aún no hay ventas en este periodo"
              body="Elige otro periodo o registra una venta para ver aquí sus resultados." />}
          </> : <SectionLoading label="Cargando resumen de ventas" />}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card><CardContent className="space-y-4 p-5"><h2 className="font-semibold">Formas de pago</h2>
            {payments.isError ? <ViewError message="No pudimos cargar las formas de pago." onRetry={() => void payments.refetch()} retryLabel="Reintentar" />
              : payments.data ? payments.data.payments.length ? <DonutChart label="Cobros netos por forma de pago"
                centerLabel="Cobros" centerValue={formatMoney(payments.data.net_total)} emptyLabel="No hay cobros en este periodo."
                slices={payments.data.payments.map((payment) => ({ id: payment.method, label: paymentLabel(payment.method),
                  value: Number(payment.net_amount), valueLabel: formatMoney(payment.net_amount) }))} />
                : <p className="text-sm text-muted-foreground">No hay cobros en este periodo.</p> : <SectionLoading label="Cargando formas de pago" />}
          </CardContent></Card>
          <Card><CardContent className="space-y-4 p-5"><h2 className="font-semibold">Productos más vendidos</h2>
            {products.isError ? <ViewError message="No pudimos cargar los productos vendidos." onRetry={() => void products.refetch()} retryLabel="Reintentar" />
              : products.data ? products.data.products.length ? <RankBars label="Productos más vendidos por importe bruto"
                emptyLabel="No hay productos vendidos en este periodo."
                rows={products.data.products.map((product) => ({ id: product.product_id, label: product.product_name,
                  value: Number(product.gross_sales), valueLabel: formatMoney(product.gross_sales),
                  detail: `${product.quantity_sold.toLocaleString("es-MX")} ${product.quantity_sold === 1 ? "unidad" : "unidades"}` }))} />
                : <p className="text-sm text-muted-foreground">No hay productos vendidos en este periodo.</p> : <SectionLoading label="Cargando productos vendidos" />}
          </CardContent></Card>
        </div>
        <PlanFeatureNotice>Tu plan incluye estos reportes de ventas. Gestión añade análisis del negocio y recomendaciones.</PlanFeatureNotice>
      </>}
    </ViewLayout>
  );
}
function SectionLoading({ label }: { label: string }) {
  return <div role="status" aria-label={label} aria-busy="true" className="space-y-3"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-24 w-full" /></div>;
}
function paymentLabel(method: string) {
  // Backend payment methods: cash | bank_transfer | manual_card (backend/app/orders/schemas.py).
  return ({ cash: "Efectivo", manual_card: "Tarjeta", bank_transfer: "Transferencia" } as Record<string, string>)[method] ?? "Otra forma de pago";
}
