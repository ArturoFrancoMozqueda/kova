import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  REPORTS_VIEW_ALL_PERMISSION,
  usePermission,
} from "../auth/permissions";
import { copy } from "../i18n/messages";
import { formatMoney, reasonLabel } from "../orders/format";
import { getPaymentBreakdown, getSalesSummary, getTopProducts } from "./api";
import type { PaymentBreakdown, SalesSummary, TopProducts } from "./types";

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
  Trophy,
  RefreshCw,
  AlertCircle,
  ShieldOff,
  Filter,
} from "lucide-react";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "loaded";
      summary: SalesSummary;
      payments: PaymentBreakdown;
      products: TopProducts;
    };

function today(): string {
  return new Date().toISOString().slice(0, 10);
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
      const [summary, payments, products] = await Promise.all([
        getSalesSummary(startDate, endDate),
        getPaymentBreakdown(startDate, endDate),
        getTopProducts(startDate, endDate),
      ]);
      setLoadState({ status: "loaded", summary, payments, products });
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
        <form onSubmit={submit} className="flex items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="report-start-date">
              {copy.reportsView.startDate}
            </Label>
            <Input
              id="report-start-date"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-end-date">
              {copy.reportsView.endDate}
            </Label>
            <Input
              id="report-end-date"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="w-40"
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
              accent="text-emerald-600"
            />
            <KpiCard
              icon={RotateCcw}
              label={copy.reportsView.refunds}
              value={formatMoney(loadState.summary.refund_total)}
              accent="text-red-500"
            />
            <KpiCard
              icon={TrendingUp}
              label={copy.reportsView.netSales}
              value={formatMoney(loadState.summary.net_sales)}
              accent="text-blue-600"
            />
            <KpiCard
              icon={ShoppingCart}
              label={copy.reportsView.orders}
              value={String(loadState.summary.order_count)}
              accent="text-violet-600"
            />
            <KpiCard
              icon={TrendingUp}
              label={copy.reportsView.avgTicket}
              value={
                loadState.summary.order_count > 0
                  ? formatMoney((Number(loadState.summary.net_sales) / loadState.summary.order_count).toFixed(2))
                  : formatMoney("0.00")
              }
              accent="text-sky-600"
            />
            <KpiCard
              icon={XCircle}
              label={copy.reportsView.voids}
              value={String(loadState.summary.void_count)}
              accent="text-orange-500"
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
                  {loadState.products.products.map((product, index) => (
                    <div
                      key={product.product_id}
                      className="flex items-center gap-4 py-3"
                    >
                      <span
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                          index === 0
                            ? "bg-amber-100 text-amber-700"
                            : index === 1
                              ? "bg-slate-100 text-slate-600"
                              : index === 2
                                ? "bg-orange-100 text-orange-700"
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
                      </div>
                      <span className="text-sm font-semibold tabular-nums">
                        {formatMoney(product.gross_sales)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </main>
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
