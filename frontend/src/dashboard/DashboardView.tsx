import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { formatMoney } from "@/orders/format";
import { getSalesSummary, getPaymentBreakdown, getTopProducts } from "@/reports/api";
import type { SalesSummary, PaymentBreakdown, TopProducts } from "@/reports/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { copy } from "@/i18n/messages";
import {
  DollarSign,
  ShoppingCart,
  TrendingUp,
  ArrowRight,
  Package,
  BarChart3,
  Clock,
  CreditCard,
  LayoutGrid,
  Receipt,
  AlertCircle,
} from "lucide-react";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      summary: SalesSummary;
      payments: PaymentBreakdown;
      topProducts: TopProducts;
    };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return copy.dashboard.greetingMorning;
  if (hour < 17) return copy.dashboard.greetingAfternoon;
  return copy.dashboard.greetingEvening;
}

const kpiCards = [
  {
    key: "netSales",
    label: () => copy.dashboard.netSales,
    icon: DollarSign,
    iconClass: "text-emerald-600 bg-emerald-50",
  },
  {
    key: "orders",
    label: () => copy.dashboard.orders,
    icon: ShoppingCart,
    iconClass: "text-blue-600 bg-blue-50",
  },
  {
    key: "avgTicket",
    label: () => copy.dashboard.avgTicket,
    icon: TrendingUp,
    iconClass: "text-violet-600 bg-violet-50",
  },
  {
    key: "refunds",
    label: () => copy.dashboard.refunds,
    icon: Receipt,
    iconClass: "text-rose-600 bg-rose-50",
  },
] as const;

export default function DashboardView() {
  const { state } = useAuth();
  const tenantName = state.status === "authenticated" ? state.tenantName : "";
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
      const today = todayISO();
      const [summary, payments, topProducts] = await Promise.all([
        getSalesSummary(today, today),
        getPaymentBreakdown(today, today),
        getTopProducts(today, today),
      ]);
      setLoadState({ status: "ready", summary, payments, topProducts });
    } catch {
      setLoadState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const todayLabel = new Date().toLocaleDateString(navigator.language, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <main className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <p className="text-sm text-muted-foreground mb-1">{getGreeting()}</p>
        <h1 className="text-3xl font-bold tracking-tight">{tenantName || copy.app.dashboard}</h1>
        <p className="text-muted-foreground mt-1">{copy.dashboard.todayActivity(todayLabel)}</p>
      </div>

      {loadState.status === "loading" && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-24" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-32" />
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="p-6">
                <Skeleton className="h-48 w-full" />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <Skeleton className="h-48 w-full" />
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {loadState.status === "error" && (
        <Card className="border-destructive/50">
          <CardContent className="flex items-center gap-4 p-6">
            <AlertCircle className="h-8 w-8 text-destructive shrink-0" />
            <div>
              <p className="font-medium">{copy.dashboard.loadError}</p>
              <p className="text-sm text-muted-foreground">{copy.dashboard.connectionHint}</p>
            </div>
            <Button variant="outline" onClick={() => void load()} className="ml-auto">
              {copy.dashboard.retry}
            </Button>
          </CardContent>
        </Card>
      )}

      {loadState.status === "ready" && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {kpiCards.map(({ key, label, icon: Icon, iconClass }) => {
              const { summary } = loadState;

              let value = "";
              let sub = "";

              if (key === "netSales") {
                value = formatMoney(summary.net_sales);
                sub = copy.dashboard.grossSuffix(formatMoney(summary.gross_sales));
              } else if (key === "orders") {
                value = String(summary.order_count);
                sub =
                  summary.void_count > 0
                    ? copy.dashboard.voidedCount(summary.void_count)
                    : copy.dashboard.noVoidsToday;
              } else if (key === "avgTicket") {
                value =
                  summary.order_count > 0
                    ? formatMoney(
                        (Number(summary.net_sales) / summary.order_count).toFixed(2),
                      )
                    : formatMoney("0.00");
                sub = copy.dashboard.perCompletedOrder;
              } else {
                value = String(summary.refund_count);
                sub = formatMoney(summary.refund_total);
              }

              return (
                <Card key={key} className="hover:shadow-md transition-shadow">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {label()}
                    </CardTitle>
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconClass}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">{value}</p>
                    <p className="text-xs text-muted-foreground mt-1">{sub}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Middle row */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Payment Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  {copy.dashboard.paymentBreakdown}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadState.payments.payments.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    {copy.dashboard.noPaymentsToday}
                  </p>
                ) : (
                  <div className="space-y-4">
                    {loadState.payments.payments.map((p) => {
                      const total = loadState.payments.payments.reduce(
                        (sum, x) => sum + Number(x.amount),
                        0,
                      );
                      const pct = total > 0 ? (Number(p.amount) / total) * 100 : 0;
                      return (
                        <div key={p.method}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-sm font-medium capitalize">
                              {p.method.replace("_", " ")}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {formatMoney(p.amount)} ({p.payment_count})
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top Products */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  {copy.dashboard.topProducts}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadState.topProducts.products.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    {copy.dashboard.noSalesToday}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {loadState.topProducts.products.slice(0, 5).map((p, i) => (
                      <div key={p.product_id} className="flex items-center gap-3">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-bold shrink-0">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{p.product_name}</p>
                          <p className="text-xs text-muted-foreground">{p.quantity_sold} sold</p>
                        </div>
                        <span className="text-sm font-semibold shrink-0">
                          {formatMoney(p.gross_sales)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>{copy.dashboard.quickActions}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  {
                    to: "/register",
                    icon: ShoppingCart,
                    iconClass: "bg-primary/10 text-primary",
                    label: copy.dashboard.newSale,
                    desc: copy.dashboard.newSaleDesc,
                  },
                  {
                    to: "/catalog",
                    icon: LayoutGrid,
                    iconClass: "bg-amber-500/10 text-amber-600",
                    label: copy.dashboard.manageCatalog,
                    desc: copy.dashboard.manageCatalogDesc,
                  },
                  {
                    to: "/reports",
                    icon: BarChart3,
                    iconClass: "bg-blue-500/10 text-blue-600",
                    label: copy.dashboard.viewReports,
                    desc: copy.dashboard.viewReportsDesc,
                  },
                  {
                    to: "/shifts",
                    icon: Clock,
                    iconClass: "bg-violet-500/10 text-violet-600",
                    label: copy.dashboard.shifts,
                    desc: copy.dashboard.shiftsDesc,
                  },
                ].map(({ to, icon: Icon, iconClass, label, desc }) => (
                  <Link key={to} to={to} className="group">
                    <div className="flex items-center gap-3 rounded-lg border p-3 transition-all hover:border-primary/50 hover:shadow-sm">
                      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconClass} shrink-0`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground">{desc}</p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
}
