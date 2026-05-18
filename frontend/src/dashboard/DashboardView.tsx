import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { formatMoney } from "@/orders/format";
import { getSalesByHour, getSalesSummary, getPaymentBreakdown, getTopProducts } from "@/reports/api";
import { listProducts } from "@/catalog/api";
import { listLowStock, listStock } from "@/inventory/api";
import { getBillingSubscription } from "@/billing/api";
import { getOnboardingState, type OnboardingState } from "@/onboarding/api";
import type { SalesByHourRow, SalesSummary, PaymentBreakdown, TopProducts } from "@/reports/types";
import type { StockItem } from "@/inventory/types";
import { InsightStrip } from "./InsightStrip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { copy } from "@/i18n/messages";
import { cn } from "@/lib/utils";
import { CountUp, LivePulse } from "@/components/brand/RealTime";
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
  TrendingDown,
  Minus,
  CheckCircle2,
  Circle,
} from "lucide-react";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      summary: SalesSummary;
      yesterday: SalesSummary | null;
      payments: PaymentBreakdown;
      hourly: SalesByHourRow[];
      topProducts: TopProducts;
      hasProducts: boolean;
      trackedInventoryCount: number;
      lowStockCount: number;
      lowStockItems: StockItem[];
      hasActiveSubscription: boolean;
      onboarding: OnboardingState | null;
    };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return copy.dashboard.greetingMorning;
  if (hour < 17) return copy.dashboard.greetingAfternoon;
  return copy.dashboard.greetingEvening;
}

type DeltaBadgeProps = { current: number; previous: number | null; format?: "money" | "count" };

function DeltaBadge({ current, previous }: DeltaBadgeProps) {
  if (previous === null || previous === 0) {
    return <span className="text-xs text-muted-foreground">{copy.dashboard.deltaNoData}</span>;
  }
  const pct = ((current - previous) / previous) * 100;
  const abs = Math.abs(pct);
  const label = `${abs < 1 ? "<1" : Math.round(abs)}%`;

  if (pct > 0.5) {
    return (
      <span className="flex items-center gap-0.5 text-xs font-medium text-kova-growth">
        <TrendingUp className="h-3 w-3" />
        {label} {copy.dashboard.vsYesterday}
      </span>
    );
  }
  if (pct < -0.5) {
    return (
      <span className="flex items-center gap-0.5 text-xs font-medium text-destructive">
        <TrendingDown className="h-3 w-3" />
        {label} {copy.dashboard.vsYesterday}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
      <Minus className="h-3 w-3" />
      {copy.dashboard.vsYesterday}
    </span>
  );
}

function OnboardingChecklist({
  hasProducts,
  orderCount,
  trackedInventoryCount,
  hasActiveSubscription,
  onboarding,
}: {
  hasProducts: boolean;
  orderCount: number;
  trackedInventoryCount: number;
  hasActiveSubscription: boolean;
  onboarding: OnboardingState | null;
}) {
  const fallbackSteps = [
    {
      label: copy.dashboard.onboardingStep1Label,
      desc: copy.dashboard.onboardingStep1Desc,
      done: hasActiveSubscription,
      action: copy.dashboard.onboardingStep1Action,
      actionTo: "/settings/billing",
    },
    {
      label: copy.dashboard.onboardingStep2Label,
      desc: copy.dashboard.onboardingStep2Desc,
      done: hasProducts,
      action: copy.dashboard.onboardingStep2Action,
      actionTo: "/catalog",
    },
    {
      label: copy.dashboard.onboardingStep3Label,
      desc: copy.dashboard.onboardingStep3Desc,
      done: trackedInventoryCount > 0,
      action: copy.dashboard.onboardingStep3Action,
      actionTo: "/inventory",
    },
    {
      label: copy.dashboard.onboardingStep4Label,
      desc: copy.dashboard.onboardingStep4Desc,
      done: orderCount > 0,
      action: copy.dashboard.onboardingStep4Action,
      actionTo: "/register",
    },
  ];
  const steps = onboarding
    ? onboarding.steps.map((step) => ({
        label: step.label,
        desc: copy.dashboard.onboardingStepDesc(step.key),
        done: step.completed,
        action: copy.dashboard.onboardingStepAction(step.key),
        actionTo: step.action_path,
      }))
    : fallbackSteps;

  const allDone = steps.every((s) => s.done);
  if (allDone) return null;

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Card className="border-primary/20 bg-primary/3 animate-fade-in">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{copy.dashboard.onboardingTitle}</CardTitle>
          <span className="text-xs text-muted-foreground">
            {doneCount}/{steps.length}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{copy.dashboard.onboardingSubtitle}</p>
        {/* Progress bar */}
        <div className="h-1.5 rounded-full bg-muted mt-2 overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-3">
          {steps.map((step, i) => (
            <div
              key={i}
              className={cn(
                "flex items-start gap-3 rounded-lg p-3 transition-colors",
                step.done ? "opacity-60" : "bg-background border",
              )}
            >
              {step.done ? (
                <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground/40 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <p className={cn("text-sm font-medium", step.done && "line-through text-muted-foreground")}>
                  {step.label}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{step.desc}</p>
              </div>
              {!step.done && step.actionTo && (
                <Link
                  to={step.actionTo}
                  className="shrink-0 text-xs font-medium text-primary hover:underline"
                >
                  {step.action} →
                </Link>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

const kpiCards = [
  { key: "netSales", label: () => copy.dashboard.netSales, icon: DollarSign, iconClass: "text-kova-growth bg-kova-growth/10" },
  { key: "orders", label: () => copy.dashboard.orders, icon: ShoppingCart, iconClass: "text-kova-blue bg-kova-blue/10" },
  { key: "avgTicket", label: () => copy.dashboard.avgTicket, icon: TrendingUp, iconClass: "text-kova-ink bg-kova-mist" },
  { key: "refunds", label: () => copy.dashboard.refunds, icon: Receipt, iconClass: "text-destructive bg-destructive/10" },
] as const;

export default function DashboardView() {
  const { state } = useAuth();
  const tenantName = state.status === "authenticated" ? state.tenantName : "";
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
      const today = todayISO();
      const yesterday = yesterdayISO();

      const [summary, payments, hourly, topProducts, productsResult, stock, lowStock, billing, onboarding, yesterdaySummary] = await Promise.all([
        getSalesSummary(today, today),
        getPaymentBreakdown(today, today),
        getSalesByHour(today, today).catch(() => [] as SalesByHourRow[]),
        getTopProducts(today, today),
        listProducts().catch(() => [] as Awaited<ReturnType<typeof listProducts>>),
        listStock().catch(() => [] as Awaited<ReturnType<typeof listStock>>),
        listLowStock().catch(() => [] as Awaited<ReturnType<typeof listLowStock>>),
        getBillingSubscription().catch(() => null),
        getOnboardingState().catch(() => null),
        getSalesSummary(yesterday, yesterday).catch(() => null),
      ]);

      const subscriptionStatus = billing?.subscription?.status;

      setLoadState({
        status: "ready",
        summary,
        yesterday: yesterdaySummary,
        payments,
        hourly,
        topProducts,
        hasProducts: productsResult.some((p) => p.is_active),
        trackedInventoryCount: stock.length,
        lowStockCount: lowStock.length,
        lowStockItems: lowStock,
        hasActiveSubscription: subscriptionStatus === "active" || subscriptionStatus === "trialing",
        onboarding,
      });
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
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-3xl font-bold tracking-tight">{tenantName || copy.app.dashboard}</h1>
          {loadState.status === "ready" && <LivePulse label="En vivo" />}
        </div>
        <p className="text-muted-foreground mt-1">{copy.dashboard.todayActivity(todayLabel)}</p>
      </div>

      {loadState.status === "loading" && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardHeader className="pb-2"><Skeleton className="h-4 w-24" /></CardHeader>
                <CardContent><Skeleton className="h-8 w-32" /></CardContent>
              </Card>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card><CardContent className="p-6"><Skeleton className="h-48 w-full" /></CardContent></Card>
            <Card><CardContent className="p-6"><Skeleton className="h-48 w-full" /></CardContent></Card>
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
          {/* Onboarding checklist — hidden once complete */}
          <OnboardingChecklist
            hasProducts={loadState.hasProducts}
            orderCount={loadState.summary.order_count}
            trackedInventoryCount={loadState.trackedInventoryCount}
            hasActiveSubscription={loadState.hasActiveSubscription}
            onboarding={loadState.onboarding}
          />

          {loadState.lowStockCount > 0 && (
            <Link
              to="/inventory"
              className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground transition-colors hover:bg-warning/15"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="font-medium">
                {copy.dashboard.lowStockAction(loadState.lowStockCount)}
              </span>
              <ArrowRight className="ml-auto h-4 w-4" />
            </Link>
          )}

          {/* Today's business story — narrative + recommended actions */}
          <InsightStrip
            summary={loadState.summary}
            yesterday={loadState.yesterday}
            payments={loadState.payments}
            hourly={loadState.hourly}
            topProducts={loadState.topProducts}
            lowStock={loadState.lowStockItems}
          />

          {/* KPI Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {kpiCards.map(({ key, label, icon: Icon, iconClass }) => {
              const { summary, yesterday } = loadState;
              let sub = "";
              let currentNum = 0;
              let prevNum: number | null = null;
              let isMoney = false;

              if (key === "netSales") {
                currentNum = Number(summary.net_sales);
                prevNum = yesterday ? Number(yesterday.net_sales) : null;
                sub = copy.dashboard.grossSuffix(formatMoney(summary.gross_sales));
                isMoney = true;
              } else if (key === "orders") {
                currentNum = summary.order_count;
                prevNum = yesterday?.order_count ?? null;
                sub = summary.void_count > 0
                  ? copy.dashboard.voidedCount(summary.void_count)
                  : copy.dashboard.noVoidsToday;
              } else if (key === "avgTicket") {
                currentNum = summary.order_count > 0
                  ? Number(summary.net_sales) / summary.order_count : 0;
                prevNum = yesterday && yesterday.order_count > 0
                  ? Number(yesterday.net_sales) / yesterday.order_count : null;
                sub = copy.dashboard.perCompletedOrder;
                isMoney = true;
              } else {
                currentNum = summary.refund_count;
                prevNum = yesterday?.refund_count ?? null;
                sub = formatMoney(summary.refund_total);
              }

              return (
                <Card key={key} className="bg-gradient-to-br from-white to-kova-mist/40 shadow-kova-card hover:shadow-kova-card-hover transition-shadow">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xs font-medium uppercase tracking-[0.08em] text-kova-tertiary">
                      {label()}
                    </CardTitle>
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconClass}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold tabular-nums tracking-tight text-kova-ink">
                      <CountUp
                        value={currentNum}
                        format={isMoney
                          ? (n) => formatMoney(n.toFixed(2))
                          : (n) => String(Math.round(n))}
                      />
                    </p>
                    <p className="text-xs text-kova-muted mt-0.5">{sub}</p>
                    <div className="mt-1.5">
                      <DeltaBadge current={currentNum} previous={prevNum} />
                    </div>
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
                        (sum, x) => sum + Number(x.amount), 0,
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
                          <p className="text-xs text-muted-foreground">
                            {copy.reportsView.soldCount(p.quantity_sold)}
                          </p>
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
                  { to: "/register", icon: ShoppingCart, iconClass: "bg-kova-blue/10 text-kova-blue", label: copy.dashboard.newSale, desc: copy.dashboard.newSaleDesc },
                  { to: "/catalog", icon: LayoutGrid, iconClass: "bg-kova-growth/10 text-kova-growth", label: copy.dashboard.manageCatalog, desc: copy.dashboard.manageCatalogDesc },
                  { to: "/reports", icon: BarChart3, iconClass: "bg-kova-blue-light/15 text-kova-blue", label: copy.dashboard.viewReports, desc: copy.dashboard.viewReportsDesc },
                  { to: "/shifts", icon: Clock, iconClass: "bg-kova-mist text-kova-ink", label: copy.dashboard.shifts, desc: copy.dashboard.shiftsDesc },
                ].map(({ to, icon: Icon, iconClass, label, desc }) => (
                  <Link key={to} to={to} className="group">
                    <div className="flex items-center gap-3 rounded-lg border p-3 transition-all hover:border-kova-blue/50 hover:shadow-sm">
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
