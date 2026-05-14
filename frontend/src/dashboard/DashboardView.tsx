import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { formatMoney } from "@/orders/format";
import { getSalesSummary, getPaymentBreakdown, getTopProducts } from "@/reports/api";
import type { SalesSummary, PaymentBreakdown, TopProducts } from "@/reports/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <main className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <p className="text-sm text-muted-foreground mb-1">{greeting}</p>
        <h1 className="text-3xl font-bold tracking-tight">{tenantName || "Dashboard"}</h1>
        <p className="text-muted-foreground mt-1">
          Here&apos;s what&apos;s happening today, {new Date().toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" })}
        </p>
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
            <AlertCircle className="h-8 w-8 text-destructive" />
            <div>
              <p className="font-medium">Could not load dashboard data</p>
              <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
            </div>
            <Button variant="outline" onClick={() => void load()} className="ml-auto">
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {loadState.status === "ready" && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Net Sales</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatMoney(loadState.summary.net_sales)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatMoney(loadState.summary.gross_sales)} gross
                </p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Orders</CardTitle>
                <ShoppingCart className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{loadState.summary.order_count}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {loadState.summary.void_count > 0
                    ? `${loadState.summary.void_count} voided`
                    : "No voids today"}
                </p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Avg Ticket</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {loadState.summary.order_count > 0
                    ? formatMoney(
                        (Number(loadState.summary.net_sales) / loadState.summary.order_count).toFixed(2),
                      )
                    : formatMoney("0.00")}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Per completed order</p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Refunds</CardTitle>
                <Receipt className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{loadState.summary.refund_count}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatMoney(loadState.summary.refund_total)} total
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Middle row */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Payment Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  Payment Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadState.payments.payments.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">No payments today</p>
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
                  Top Products
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadState.topProducts.products.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">No sales today</p>
                ) : (
                  <div className="space-y-3">
                    {loadState.topProducts.products.slice(0, 5).map((p, i) => (
                      <div key={p.product_id} className="flex items-center gap-3">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-bold">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{p.product_name}</p>
                          <p className="text-xs text-muted-foreground">{p.quantity_sold} sold</p>
                        </div>
                        <span className="text-sm font-semibold">{formatMoney(p.gross_sales)}</span>
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
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Link to="/register" className="group">
                  <div className="flex items-center gap-3 rounded-lg border p-3 transition-all hover:border-primary/50 hover:shadow-sm">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <ShoppingCart className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">New Sale</p>
                      <p className="text-xs text-muted-foreground">Open register</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
                <Link to="/catalog" className="group">
                  <div className="flex items-center gap-3 rounded-lg border p-3 transition-all hover:border-primary/50 hover:shadow-sm">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
                      <LayoutGrid className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">Manage Catalog</p>
                      <p className="text-xs text-muted-foreground">Products &amp; categories</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
                <Link to="/reports" className="group">
                  <div className="flex items-center gap-3 rounded-lg border p-3 transition-all hover:border-primary/50 hover:shadow-sm">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600">
                      <BarChart3 className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">View Reports</p>
                      <p className="text-xs text-muted-foreground">Sales &amp; analytics</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
                <Link to="/shifts" className="group">
                  <div className="flex items-center gap-3 rounded-lg border p-3 transition-all hover:border-primary/50 hover:shadow-sm">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600">
                      <Clock className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">Shifts</p>
                      <p className="text-xs text-muted-foreground">Open &amp; close</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
}
