import { FormEvent, useCallback, useEffect, useState } from "react";
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
  TrendingDown,
  Minus,
  ShoppingCart,
  XCircle,
  BarChart3,
  Trophy,
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

function pctRound(pct: number): number {
  const abs = Math.abs(pct);
  return abs < 1 ? 1 : Math.round(abs);
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
        getSalesByHour(startDate, endDate),
        getSalesByEmployee(startDate, endDate),
        getRefundsByReason(startDate, endDate),
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
          {/* KPI cards */}
          <section
            className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6"
            aria-label={copy.reportsView.title}
          >
            <KpiCard
              icon={DollarSign}
              label={copy.reportsView.grossSales}
              value={formatMoney(loadState.summary.gross_sales)}
              accent="text-kova-growth"
            />
            <KpiCard
              icon={RotateCcw}
              label={copy.reportsView.refunds}
              value={formatMoney(loadState.summary.refund_total)}
              accent="text-destructive"
            />
            <KpiCard
              icon={TrendingUp}
              label={copy.reportsView.netSales}
              value={formatMoney(loadState.summary.net_sales)}
              accent="text-kova-blue"
            />
            <KpiCard
              icon={ShoppingCart}
              label={copy.reportsView.orders}
              value={String(loadState.summary.order_count)}
              accent="text-kova-ink"
            />
            <KpiCard
              icon={TrendingUp}
              label={copy.reportsView.avgTicket}
              value={
                loadState.summary.order_count > 0
                  ? formatMoney((Number(loadState.summary.net_sales) / loadState.summary.order_count).toFixed(2))
                  : formatMoney("0.00")
              }
              accent="text-kova-blue-light"
            />
            <KpiCard
              icon={XCircle}
              label={copy.reportsView.voids}
              value={String(loadState.summary.void_count)}
              accent="text-warning"
            />
          </section>

          <Card>
            <CardContent className="flex items-start gap-3 p-5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <BarChart3 className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold">{copy.reportsView.periodInsight}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {loadState.summary.order_count > 0
                    ? copy.reportsView.salesInsightActive(
                        loadState.summary.order_count,
                        formatMoney(loadState.summary.net_sales),
                      )
                    : copy.reportsView.salesInsightEmpty}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Payment breakdown */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-muted-foreground" />
                <CardTitle>{copy.reportsView.hourlySales}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {loadState.hourly.every((row) => row.order_count === 0) ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {copy.reportsView.noHourlySales}
                </p>
              ) : (
                <HourlyChart rows={loadState.hourly} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-muted-foreground" />
                <CardTitle>{copy.reportsView.paymentBreakdown}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {loadState.payments.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {copy.reportsView.noPayments}
                </p>
              ) : (
                <div className="space-y-4">
                  {(() => {
                    const maxAmount = Math.max(
                      ...loadState.payments.payments.map((p) =>
                        parseFloat(p.amount),
                      ),
                      1,
                    );
                    return loadState.payments.payments.map((payment) => {
                      const pct =
                        (parseFloat(payment.amount) / maxAmount) * 100;
                      return (
                        <div key={payment.method} className="space-y-1.5">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium">
                              {reasonLabel(payment.method)}
                            </span>
                            <div className="flex items-center gap-3">
                              <Badge variant="secondary">
                                {payment.payment_count}
                              </Badge>
                              <span className="font-semibold tabular-nums">
                                {formatMoney(payment.amount)}
                              </span>
                            </div>
                          </div>
                          <div className="h-2 w-full rounded-full bg-muted">
                            <div
                              className="h-2 rounded-full bg-primary transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Payment mix insight */}
          {loadState.payments.payments.length > 0 ? (
            <PaymentMixInsight
              current={loadState.payments}
              previous={loadState.prevPayments}
            />
          ) : null}

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-muted-foreground" />
                <CardTitle>{copy.reportsView.employeePerformance}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {loadState.employees.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {copy.reportsView.noEmployeeSales}
                </p>
              ) : (
                <EmployeePerformance rows={loadState.employees} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-muted-foreground" />
                <CardTitle>{copy.reportsView.refundsByReason}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {loadState.refundReasons.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {copy.reportsView.noRefundReasons}
                </p>
              ) : (
                <RefundReasonBreakdown rows={loadState.refundReasons} />
              )}
            </CardContent>
          </Card>

          {/* Top products */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-muted-foreground" />
                <CardTitle>{copy.reportsView.topProducts}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {loadState.products.products.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {copy.reportsView.noProducts}
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {loadState.products.products.map((product, index) => {
                    const prev = loadState.prevProducts?.products.find(
                      (p) => p.product_id === product.product_id,
                    );
                    let deltaNode: React.ReactNode = null;
                    if (loadState.prevProducts) {
                      if (!prev) {
                        deltaNode = (
                          <Badge variant="secondary" className="gap-1">
                            <Sparkles className="h-3 w-3" />
                            {copy.reportsView.topProductNew}
                          </Badge>
                        );
                      } else if (prev.quantity_sold > 0) {
                        const pct =
                          ((product.quantity_sold - prev.quantity_sold) /
                            prev.quantity_sold) *
                          100;
                        if (pct > 5) {
                          deltaNode = (
                            <span className="flex items-center gap-0.5 text-xs font-medium text-kova-growth tabular-nums">
                              <TrendingUp className="h-3 w-3" />
                              {copy.reportsView.topProductDeltaUp(pctRound(pct))}
                            </span>
                          );
                        } else if (pct < -5) {
                          deltaNode = (
                            <span className="flex items-center gap-0.5 text-xs font-medium text-destructive tabular-nums">
                              <TrendingDown className="h-3 w-3" />
                              {copy.reportsView.topProductDeltaDown(pctRound(pct))}
                            </span>
                          );
                        } else {
                          deltaNode = (
                            <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                              <Minus className="h-3 w-3" />
                              {copy.reportsView.topProductDeltaFlat}
                            </span>
                          );
                        }
                      }
                    }
                    return (
                      <div
                        key={product.product_id}
                        className="flex items-center gap-4 py-3"
                      >
                        <span
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                            index === 0
                              ? "bg-kova-blue/10 text-kova-blue"
                              : index === 1
                                ? "bg-kova-mist text-kova-muted"
                                : index === 2
                                  ? "bg-warning/10 text-warning"
                                  : "bg-muted text-muted-foreground",
                          )}
                        >
                          {index + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {product.product_name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {copy.reportsView.soldCount(product.quantity_sold)}
                          </p>
                          {deltaNode && <div className="mt-1">{deltaNode}</div>}
                        </div>
                        <span className="text-sm font-semibold tabular-nums">
                          {formatMoney(product.gross_sales)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </main>
  );
}

function hourRange(hour: number): string {
  const next = (hour + 1) % 24;
  return `${String(hour).padStart(2, "0")}:00-${String(next).padStart(2, "0")}:00`;
}

function HourlyChart({ rows }: { rows: SalesByHourRow[] }) {
  const max = Math.max(...rows.map((row) => Number(row.net_sales)), 1);
  const best = [...rows].sort((a, b) => Number(b.net_sales) - Number(a.net_sales))[0];
  return (
    <div className="space-y-3">
      {best && Number(best.net_sales) > 0 ? (
        <p className="text-sm font-medium text-kova-ink">
          {copy.reportsView.bestHour(hourRange(best.hour))}
        </p>
      ) : null}
      <div className="flex h-36 items-end gap-1 overflow-x-auto rounded-lg border bg-kova-mist/40 p-3">
        {rows.map((row) => {
          const height = Math.max(4, (Number(row.net_sales) / max) * 100);
          return (
            <div key={row.hour} className="flex min-w-7 flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t bg-kova-blue transition-all"
                style={{ height: `${height}%` }}
                title={`${hourRange(row.hour)}: ${formatMoney(row.net_sales)}`}
              />
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {row.hour % 3 === 0 ? row.hour : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmployeePerformance({ rows }: { rows: SalesByEmployeeRow[] }) {
  const max = Math.max(...rows.map((row) => Number(row.net_sales)), 1);
  const coaching = rows.find((row) => row.refund_count > 0) ?? rows[rows.length - 1];
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.user_id ?? row.display_name} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{row.display_name}</p>
                <p className="text-xs text-muted-foreground">
                  {copy.reportsView.employeeStats(row.order_count, row.refund_count)}
                </p>
              </div>
              <span className="font-semibold tabular-nums">{formatMoney(row.net_sales)}</span>
            </div>
            <div className="h-2 rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-kova-blue"
                style={{ width: `${(Number(row.net_sales) / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      {coaching ? (
        <p className="rounded-lg bg-kova-mist p-3 text-sm text-kova-muted">
          {copy.reportsView.coachingOpportunity(coaching.display_name)}
        </p>
      ) : null}
    </div>
  );
}

function RefundReasonBreakdown({ rows }: { rows: RefundsByReasonRow[] }) {
  const max = Math.max(...rows.map((row) => Number(row.refunded_amount)), 1);
  const top = rows[0];
  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <div key={row.reason} className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{reasonLabel(row.reason)}</span>
            <span className="font-semibold tabular-nums">
              {formatMoney(row.refunded_amount)} · {row.refund_count}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-destructive"
              style={{ width: `${(Number(row.refunded_amount) / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
      {top ? (
        <p className="rounded-lg bg-destructive/5 p-3 text-sm text-muted-foreground">
          {copy.reportsView.auditRefunds(reasonLabel(top.reason))}
        </p>
      ) : null}
    </div>
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

function KpiCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
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
