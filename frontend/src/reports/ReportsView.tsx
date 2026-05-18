import { type ComponentType, FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import {
  REPORTS_VIEW_ALL_PERMISSION,
  usePermission,
} from "../auth/permissions";
import { copy } from "../i18n/messages";
import { formatMoney, reasonLabel } from "../orders/format";
import {
  getPaymentBreakdown,
  getRefundsByReason,
  getSalesByEmployee,
  getSalesByHour,
  getSalesSummary,
  getTopProducts,
} from "./api";
import { InteractiveBarChart, InteractiveRankChart, type ChartRow } from "./InteractiveCharts";
import type {
  PaymentBreakdown,
  RefundsByReasonRow,
  SalesByEmployeeRow,
  SalesByHourRow,
  SalesSummary,
  TopProducts,
} from "./types";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  DollarSign,
  RotateCcw,
  TrendingUp,
  ShoppingCart,
  XCircle,
  BarChart3,
  RefreshCw,
  AlertCircle,
  ShieldOff,
  Filter,
  Sparkles,
} from "lucide-react";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "loaded";
      summary: SalesSummary;
      payments: PaymentBreakdown;
      products: TopProducts;
      hourly: SalesByHourRow[];
      employees: SalesByEmployeeRow[];
      refundReasons: RefundsByReasonRow[];
      prevPayments: PaymentBreakdown | null;
      prevProducts: TopProducts | null;
    };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function previousRangeOf(startDate: string, endDate: string): { start: string; end: string } {
  // Inclusive day count. Previous range ends the day before startDate.
  const s = new Date(`${startDate}T00:00:00`);
  const e = new Date(`${endDate}T00:00:00`);
  const days = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
  const prevEnd = new Date(s);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (days - 1));
  return {
    start: prevStart.toISOString().slice(0, 10),
    end: prevEnd.toISOString().slice(0, 10),
  };
}

export default function ReportsView() {
  const canViewReports = usePermission(REPORTS_VIEW_ALL_PERMISSION);
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(today());
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async () => {
    if (!canViewReports) {
      setLoadState({ status: "error" });
      return;
    }
    setLoadState({ status: "loading" });
    try {
      const prev = previousRangeOf(startDate, endDate);
      const [
        summary,
        payments,
        products,
        hourly,
        employees,
        refundReasons,
        prevPayments,
        prevProducts,
      ] = await Promise.all([
        getSalesSummary(startDate, endDate),
        getPaymentBreakdown(startDate, endDate),
        getTopProducts(startDate, endDate),
        getSalesByHour(startDate, endDate).catch(() => []),
        getSalesByEmployee(startDate, endDate).catch(() => []),
        getRefundsByReason(startDate, endDate).catch(() => []),
        getPaymentBreakdown(prev.start, prev.end).catch(() => null),
        getTopProducts(prev.start, prev.end, 20).catch(() => null),
      ]);
      setLoadState({
        status: "loaded",
        summary,
        payments,
        products,
        hourly,
        employees,
        refundReasons,
        prevPayments,
        prevProducts,
      });
    } catch {
      setLoadState({ status: "error" });
    }
  }, [canViewReports, endDate, startDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void load();
  };

  if (!canViewReports) {
    return (
      <main className="flex-1 p-6">
        <div className="flex items-center gap-3 mb-6">
          <ShieldOff className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {copy.reportsView.title}
            </h1>
            <p className="text-sm text-muted-foreground">
              {copy.reportsView.permissionHidden}
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            {copy.app.dashboard}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {copy.reportsView.title}
          </h1>
        </div>
        <form
          onSubmit={submit}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="flex-1 min-w-[140px] space-y-1.5">
            <Label htmlFor="report-start-date">
              {copy.reportsView.startDate}
            </Label>
            <Input
              id="report-start-date"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="w-full sm:w-40"
            />
          </div>
          <div className="flex-1 min-w-[140px] space-y-1.5">
            <Label htmlFor="report-end-date">
              {copy.reportsView.endDate}
            </Label>
            <Input
              id="report-end-date"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="w-full sm:w-40"
            />
          </div>
          <Button type="submit" size="sm">
            <Filter className="mr-2 h-4 w-4" />
            {copy.reportsView.apply}
          </Button>
        </form>
      </div>

      {/* Loading skeleton */}
      {loadState.status === "loading" ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-5">
                  <Skeleton className="h-4 w-20 mb-3" />
                  <Skeleton className="h-7 w-28" />
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardContent className="p-6">
              <Skeleton className="h-5 w-40 mb-4" />
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Error state */}
      {loadState.status === "error" ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="h-10 w-10 text-destructive mb-3" />
            <p className="text-sm text-destructive font-medium" role="alert">
              {copy.reportsView.loadError}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => void load()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {copy.reportsView.retry}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Loaded content */}
      {loadState.status === "loaded" ? (
        <>
          <PeriodNarrativeCard
            summary={loadState.summary}
            hourly={loadState.hourly}
            payments={loadState.payments}
            products={loadState.products}
            employees={loadState.employees}
            refundReasons={loadState.refundReasons}
          />

          <KpiRow summary={loadState.summary} />

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-muted-foreground" />
                <CardTitle>{copy.reportsView.hourlySales}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <HourlyChart rows={loadState.hourly} />
            </CardContent>
          </Card>

          <section className="grid gap-6 xl:grid-cols-2">
            <PaymentBreakdownChart payments={loadState.payments} />
            <TopProductsChart products={loadState.products} />
            <EmployeePerformance rows={loadState.employees} />
            <RefundReasonBreakdown rows={loadState.refundReasons} />
          </section>

          {loadState.payments.payments.length > 0 ? (
            <PaymentMixInsight
              current={loadState.payments}
              previous={loadState.prevPayments}
            />
          ) : null}

          <RecommendedActions
            payments={loadState.payments}
            products={loadState.products}
            employees={loadState.employees}
            refundReasons={loadState.refundReasons}
            orderCount={loadState.summary.order_count}
          />
        </>
      ) : null}
    </main>
  );
}

function hourRange(hour: number): string {
  const next = (hour + 1) % 24;
  return `${String(hour).padStart(2, "0")}:00-${String(next).padStart(2, "0")}:00`;
}

function share(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function bestHourlyRow(rows: SalesByHourRow[]): SalesByHourRow | null {
  return [...rows].sort((a, b) => Number(b.net_sales) - Number(a.net_sales))[0] ?? null;
}

function dominantPayment(payments: PaymentBreakdown): { method: string; pct: number } | null {
  const total = payments.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const top = [...payments.payments].sort((a, b) => Number(b.amount) - Number(a.amount))[0];
  return top && total > 0 ? { method: reasonLabel(top.method), pct: share(Number(top.amount), total) } : null;
}

function chartCopy() {
  return {
    detailPlaceholder: copy.reportsView.chartDetailPlaceholder,
    totalShareLabel: copy.reportsView.chartShare,
  };
}

function PeriodNarrativeCard({
  summary,
  hourly,
  payments,
  products,
  employees,
  refundReasons,
}: {
  summary: SalesSummary;
  hourly: SalesByHourRow[];
  payments: PaymentBreakdown;
  products: TopProducts;
  employees: SalesByEmployeeRow[];
  refundReasons: RefundsByReasonRow[];
}) {
  const bestHour = bestHourlyRow(hourly);
  const hourlyTotal = hourly.reduce((sum, row) => sum + Number(row.net_sales), 0);
  const topProduct = products.products[0];
  const topPayment = dominantPayment(payments);
  const topRefund = refundReasons[0];
  const coaching = employees.find((row) => row.refund_count > 0) ?? employees[employees.length - 1];

  const why: string[] = [];
  if (bestHour && Number(bestHour.net_sales) > 0) {
    why.push(copy.reportsView.narrativeBestHour(hourRange(bestHour.hour), share(Number(bestHour.net_sales), hourlyTotal)));
  }
  if (topProduct) {
    why.push(copy.reportsView.narrativeTopProduct(topProduct.product_name, formatMoney(topProduct.gross_sales)));
  }
  if (topPayment) {
    why.push(copy.reportsView.narrativePayment(topPayment.method, topPayment.pct));
  }
  if (topRefund) {
    why.push(copy.reportsView.narrativeRefund(reasonLabel(topRefund.reason)));
  }

  const action =
    topRefund ? copy.reportsView.actionAuditRefunds(reasonLabel(topRefund.reason)) :
    coaching ? copy.reportsView.actionCoachEmployee(coaching.display_name) :
    topProduct ? copy.reportsView.actionRestockTop(topProduct.product_name) :
    topPayment ? copy.reportsView.actionReviewPayments(topPayment.method) :
    copy.reportsView.actionStartSelling;

  return (
    <Card className="border-kova-blue/20 bg-kova-blue/5">
      <CardContent className="grid gap-5 p-5 lg:grid-cols-3">
        <NarrativeColumn
          title={copy.reportsView.narrativeQuestion}
          body={
            summary.order_count > 0
              ? copy.reportsView.narrativeActive(summary.order_count, formatMoney(summary.net_sales))
              : copy.reportsView.narrativeEmpty
          }
        />
        <NarrativeColumn
          title={copy.reportsView.narrativeWhy}
          body={why.length > 0 ? why.join(" ") : copy.reportsView.narrativeNoSecondary}
        />
        <NarrativeColumn title={copy.reportsView.narrativeAction} body={action} />
      </CardContent>
    </Card>
  );
}

function NarrativeColumn({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-kova-blue">{title}</p>
      <p className="text-sm leading-6 text-kova-ink">{body}</p>
    </div>
  );
}

function KpiRow({ summary }: { summary: SalesSummary }) {
  return (
    <section
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6"
      aria-label={copy.reportsView.title}
    >
      <KpiCard
        icon={DollarSign}
        label={copy.reportsView.grossSales}
        value={formatMoney(summary.gross_sales)}
        accent="text-kova-growth"
      />
      <KpiCard
        icon={TrendingUp}
        label={copy.reportsView.netSales}
        value={formatMoney(summary.net_sales)}
        accent="text-kova-blue"
      />
      <KpiCard
        icon={ShoppingCart}
        label={copy.reportsView.orders}
        value={String(summary.order_count)}
        accent="text-kova-ink"
      />
      <KpiCard
        icon={TrendingUp}
        label={copy.reportsView.avgTicket}
        value={
          summary.order_count > 0
            ? formatMoney((Number(summary.net_sales) / summary.order_count).toFixed(2))
            : formatMoney("0.00")
        }
        accent="text-kova-blue-light"
      />
      <KpiCard
        icon={RotateCcw}
        label={copy.reportsView.refunds}
        value={formatMoney(summary.refund_total)}
        accent="text-destructive"
      />
      <KpiCard
        icon={XCircle}
        label={copy.reportsView.voids}
        value={String(summary.void_count)}
        accent="text-warning"
      />
    </section>
  );
}

function HourlyChart({ rows }: { rows: SalesByHourRow[] }) {
  const total = rows.reduce((sum, row) => sum + Number(row.net_sales), 0);
  const best = bestHourlyRow(rows);
  const chartRows: ChartRow[] = rows.map((row) => ({
    id: String(row.hour),
    label: hourRange(row.hour),
    value: Number(row.net_sales),
    valueLabel: formatMoney(row.net_sales),
    meta: [{ label: copy.reportsView.chartOrders, value: String(row.order_count) }],
    accentClassName: "bg-kova-blue",
  }));
  return (
    <InteractiveBarChart
      title={copy.reportsView.hourlyQuestion}
      insight={
        best && Number(best.net_sales) > 0
          ? copy.reportsView.bestHourShare(hourRange(best.hour), share(Number(best.net_sales), total))
          : undefined
      }
      rows={chartRows}
      emptyLabel={copy.reportsView.noHourlySales}
      ariaLabel={copy.reportsView.hourlySales}
      {...chartCopy()}
    />
  );
}

function PaymentBreakdownChart({ payments }: { payments: PaymentBreakdown }) {
  const total = payments.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const top = dominantPayment(payments);
  const rows: ChartRow[] = payments.payments.map((payment) => ({
    id: payment.method,
    label: reasonLabel(payment.method),
    value: Number(payment.amount),
    valueLabel: formatMoney(payment.amount),
    meta: [{ label: copy.reportsView.chartPayments, value: String(payment.payment_count) }],
    accentClassName: "bg-kova-blue",
  }));

  return (
    <DriverCard icon={BarChart3} title={copy.reportsView.paymentBreakdown}>
      <InteractiveBarChart
        title={copy.reportsView.paymentQuestion}
        insight={top ? copy.reportsView.paymentShare(top.method, top.pct) : undefined}
        rows={rows}
        emptyLabel={copy.reportsView.noPayments}
        ariaLabel={copy.reportsView.paymentBreakdown}
        {...chartCopy()}
      />
      {total <= 0 ? null : <span className="sr-only">{formatMoney(total.toFixed(2))}</span>}
    </DriverCard>
  );
}

function TopProductsChart({ products }: { products: TopProducts }) {
  const top = products.products[0];
  const rows: ChartRow[] = products.products.map((product) => ({
    id: product.product_id,
    label: product.product_name,
    value: Number(product.gross_sales),
    valueLabel: formatMoney(product.gross_sales),
    meta: [{ label: copy.reportsView.chartUnits, value: String(product.quantity_sold) }],
    accentClassName: "bg-kova-growth",
  }));

  return (
    <DriverCard icon={ShoppingCart} title={copy.reportsView.topProducts}>
      <InteractiveRankChart
        title={copy.reportsView.productsQuestion}
        insight={
          top
            ? copy.reportsView.topProductInsight(
                top.product_name,
                formatMoney(top.gross_sales),
                top.quantity_sold,
              )
            : undefined
        }
        rows={rows}
        emptyLabel={copy.reportsView.noProducts}
        ariaLabel={copy.reportsView.topProducts}
        {...chartCopy()}
      />
    </DriverCard>
  );
}

function EmployeePerformance({ rows }: { rows: SalesByEmployeeRow[] }) {
  const coaching = rows.find((row) => row.refund_count > 0) ?? rows[rows.length - 1];
  const chartRows: ChartRow[] = rows.map((row) => ({
    id: row.user_id ?? row.display_name,
    label: row.display_name,
    value: Number(row.net_sales),
    valueLabel: formatMoney(row.net_sales),
    meta: [
      { label: copy.reportsView.chartOrders, value: String(row.order_count) },
      { label: copy.reportsView.chartRefunds, value: String(row.refund_count) },
    ],
    accentClassName: "bg-kova-blue",
  }));

  return (
    <DriverCard icon={ShoppingCart} title={copy.reportsView.employeePerformance}>
      <InteractiveBarChart
        title={copy.reportsView.employeeQuestion}
        insight={coaching ? copy.reportsView.coachingOpportunity(coaching.display_name) : undefined}
        rows={chartRows}
        emptyLabel={copy.reportsView.noEmployeeSales}
        ariaLabel={copy.reportsView.employeePerformance}
        {...chartCopy()}
      />
      {coaching ? (
        <p className="rounded-lg bg-kova-mist p-3 text-sm text-kova-muted">
          {copy.reportsView.coachingOpportunity(coaching.display_name)}
        </p>
      ) : null}
    </DriverCard>
  );
}

function RefundReasonBreakdown({ rows }: { rows: RefundsByReasonRow[] }) {
  const top = rows[0];
  const chartRows: ChartRow[] = rows.map((row) => ({
    id: row.reason,
    label: reasonLabel(row.reason),
    value: Number(row.refunded_amount),
    valueLabel: formatMoney(row.refunded_amount),
    meta: [{ label: copy.reportsView.chartRefunds, value: String(row.refund_count) }],
    accentClassName: "bg-destructive",
  }));

  return (
    <DriverCard icon={RotateCcw} title={copy.reportsView.refundsByReason}>
      <InteractiveBarChart
        title={copy.reportsView.refundQuestion}
        insight={top ? copy.reportsView.auditRefunds(reasonLabel(top.reason)) : undefined}
        rows={chartRows}
        emptyLabel={copy.reportsView.noRefundReasons}
        ariaLabel={copy.reportsView.refundsByReason}
        {...chartCopy()}
      />
      {rows.map((row) => (
        <div key={row.reason} className="hidden">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{reasonLabel(row.reason)}</span>
            <span className="font-semibold tabular-nums">
              {formatMoney(row.refunded_amount)} · {row.refund_count}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-destructive"
              style={{ width: `${row.refunded_amount === "0.00" ? 0 : 100}%` }}
            />
          </div>
        </div>
      ))}
      {top ? (
        <p className="rounded-lg bg-destructive/5 p-3 text-sm text-muted-foreground">
          {copy.reportsView.auditRefunds(reasonLabel(top.reason))}
        </p>
      ) : null}
    </DriverCard>
  );
}

function DriverCard({
  icon: Icon,
  title,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-muted-foreground" />
          <CardTitle>{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function PaymentMixInsight({
  current,
  previous,
}: {
  current: PaymentBreakdown;
  previous: PaymentBreakdown | null;
}) {
  const total = current.payments.reduce((s, p) => s + Number(p.amount), 0);
  if (total <= 0) return null;

  const currentMethods = new Set(current.payments.map((p) => p.method));
  const prevMethods = previous ? new Set(previous.payments.map((p) => p.method)) : null;

  // Cash dominance
  const cash = current.payments.find((p) => p.method === "cash");
  const cashPct = cash ? Math.round((Number(cash.amount) / total) * 100) : 0;

  const lines: string[] = [];
  if (cashPct >= 70) {
    lines.push(copy.reportsView.paymentInsightCashHeavy(cashPct));
  }
  if (prevMethods) {
    const newMethods = [...currentMethods].filter((m) => !prevMethods.has(m));
    const lostMethods = [...prevMethods].filter((m) => !currentMethods.has(m));
    for (const m of newMethods) {
      lines.push(copy.reportsView.paymentInsightNewMethod(reasonLabel(m)));
    }
    for (const m of lostMethods) {
      lines.push(copy.reportsView.paymentInsightLostMethod(reasonLabel(m)));
    }
  }

  if (lines.length === 0) return null;

  return (
    <Card className="border-kova-blue/20 bg-kova-blue/5">
      <CardContent className="flex items-start gap-3 p-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-kova-blue/15">
          <Sparkles className="h-4 w-4 text-kova-blue" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">
            {copy.reportsView.paymentInsightTitle}
          </p>
          <ul className="mt-1.5 space-y-1">
            {lines.map((line, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-kova-muted">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-kova-blue/60" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function RecommendedActions({
  payments,
  products,
  employees,
  refundReasons,
  orderCount,
}: {
  payments: PaymentBreakdown;
  products: TopProducts;
  employees: SalesByEmployeeRow[];
  refundReasons: RefundsByReasonRow[];
  orderCount: number;
}) {
  const topPayment = dominantPayment(payments);
  const topProduct = products.products[0];
  const coaching = employees.find((row) => row.refund_count > 0) ?? employees[employees.length - 1];
  const topRefund = refundReasons[0];
  const actions = [
    topProduct ? copy.reportsView.actionRestockTop(topProduct.product_name) : null,
    topRefund ? copy.reportsView.actionAuditRefunds(reasonLabel(topRefund.reason)) : null,
    coaching ? copy.reportsView.actionCoachEmployee(coaching.display_name) : null,
    topPayment ? copy.reportsView.actionReviewPayments(topPayment.method) : null,
  ].filter((action): action is string => Boolean(action));

  if (actions.length === 0 && orderCount === 0) {
    actions.push(copy.reportsView.actionStartSelling);
  }

  if (actions.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-muted-foreground" />
          <CardTitle>{copy.reportsView.actionTitle}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {actions.slice(0, 4).map((action) => (
            <Badge key={action} variant="secondary" className="justify-start whitespace-normal px-3 py-2 text-left">
              {action}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <Card className="data-card">
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-2">
          <Icon className={cn("h-4 w-4", accent ?? "text-muted-foreground")} />
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {label}
          </p>
        </div>
        <p className="text-2xl font-bold tracking-tight tabular-nums">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
