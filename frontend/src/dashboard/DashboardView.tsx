import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  DEFAULT_TIMEZONE,
  daysAgoInTimezone,
  todayInTimezone,
  yesterdayInTimezone,
} from "@/i18n/date";
import { formatMoney } from "@/orders/format";
import { getBusinessStory, getSalesByHour, getSalesSummary, getPaymentBreakdown, getTopProducts } from "@/reports/api";
import { listProducts } from "@/catalog/api";
import { listLowStock, listStock } from "@/inventory/api";
import { getBillingSubscription } from "@/billing/api";
import { getOnboardingState, type OnboardingState } from "@/onboarding/api";
import { getBusinessProfile, listEmployees } from "@/settings/api";
import { listClosedShifts } from "@/shifts/api";
import type { BillingSubscription } from "@/billing/types";
import type { BusinessStoryReport, SalesByHourRow, SalesSummary, PaymentBreakdown, TopProducts } from "@/reports/types";
import type { StockItem } from "@/inventory/types";
import { InsightStrip } from "./InsightStrip";
import { BusinessHealthCard } from "./BusinessHealthCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { copy } from "@/i18n/messages";
import { cn } from "@/lib/utils";
import { formatTenantName } from "@/lib/formatTenantName";
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
      activeCatalogCount: number;
      activeEmployeeCount: number;
      closedShiftCount: number;
      hasActiveSubscription: boolean;
      billing: BillingSubscription | null;
      onboarding: OnboardingState | null;
      story: BusinessStoryReport | null;
      timezone: string;
      compareLabel: string;
    };

type Period = "day" | "week" | "month";

type PeriodRange = {
  current: { start: string; end: string };
  previous: { start: string; end: string };
  compareLabel: string;
};

function periodRanges(period: Period, timezone: string = DEFAULT_TIMEZONE): PeriodRange {
  const today = todayInTimezone(timezone);
  if (period === "day") {
    return {
      current: { start: today, end: today },
      previous: { start: yesterdayInTimezone(timezone), end: yesterdayInTimezone(timezone) },
      compareLabel: copy.dashboard.vsYesterday,
    };
  }
  if (period === "week") {
    return {
      current: { start: daysAgoInTimezone(timezone, 6), end: today },
      previous: { start: daysAgoInTimezone(timezone, 13), end: daysAgoInTimezone(timezone, 7) },
      compareLabel: copy.dashboard.vsLastWeek,
    };
  }
  return {
    current: { start: daysAgoInTimezone(timezone, 29), end: today },
    previous: { start: daysAgoInTimezone(timezone, 59), end: daysAgoInTimezone(timezone, 30) },
    compareLabel: copy.dashboard.vsLastMonth,
  };
}

function hourInTimezone(timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    }).formatToParts(new Date());
    const hourPart = parts.find((part) => part.type === "hour")?.value;
    if (!hourPart) return new Date().getHours();
    const parsed = Number.parseInt(hourPart, 10);
    return Number.isFinite(parsed) ? parsed : new Date().getHours();
  } catch {
    return new Date().getHours();
  }
}

function getGreeting(timezone: string = DEFAULT_TIMEZONE): string {
  const hour = hourInTimezone(timezone);
  if (hour < 12) return copy.dashboard.greetingMorning;
  if (hour < 17) return copy.dashboard.greetingAfternoon;
  return copy.dashboard.greetingEvening;
}

type DeltaBadgeProps = {
  current: number;
  previous: number | null;
  format?: "money" | "count";
  compareLabel?: string;
};

function DeltaBadge({ current, previous, compareLabel = copy.dashboard.vsYesterday }: DeltaBadgeProps) {
  if (previous === null || previous === 0) {
    return <span className="text-xs text-muted-foreground">{copy.dashboard.deltaNoData}</span>;
  }
  // Suppress misleading red -100% on fresh/zero-activity periods: when current is 0,
  // we render a neutral "Aún sin comparación" instead of a destructive red badge.
  if (current === 0) {
    return <span className="text-xs text-muted-foreground">{copy.dashboard.deltaWarmingUp}</span>;
  }
  const pct = ((current - previous) / previous) * 100;
  const abs = Math.abs(pct);
  const label = `${abs < 1 ? "<1" : Math.round(abs)}%`;

  if (pct > 0.5) {
    return (
      <span className="flex items-center gap-0.5 text-xs font-medium text-kova-growth">
        <TrendingUp className="h-3 w-3" />
        {label} {compareLabel}
      </span>
    );
  }
  if (pct < -0.5) {
    return (
      <span className="flex items-center gap-0.5 text-xs font-medium text-destructive">
        <TrendingDown className="h-3 w-3" />
        {label} {compareLabel}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
      <Minus className="h-3 w-3" />
      {compareLabel}
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
    ? onboarding.steps.map((step) => {
        // Frontend overrides: the backend snapshot can lag behind the
        // billing event, so trust the live subscription state for the
        // plan/billing step and the local signals for the rest.
        let done = step.completed;
        const key = step.key.toLowerCase();
        if (key.includes("plan") || key.includes("subscription") || key.includes("billing")) {
          done = done || hasActiveSubscription;
        } else if (key.includes("product")) {
          done = done || hasProducts;
        } else if (key.includes("sale") || key.includes("order")) {
          done = done || orderCount > 0;
        } else if (key.includes("inventory") || key.includes("stock")) {
          done = done || trackedInventoryCount > 0;
        }
        return {
          label: copy.dashboard.onboardingStepLabel(step.key) ?? step.label,
          desc: copy.dashboard.onboardingStepDesc(step.key),
          done,
          action: copy.dashboard.onboardingStepAction(step.key),
          actionTo: step.action_path,
        };
      })
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

function FirstValueMilestone({ onboarding }: { onboarding: OnboardingState | null }) {
  if (!onboarding) return null;
  const completed = new Set(
    onboarding.steps.filter((step) => step.completed).map((step) => step.key),
  );
  const milestones = [
    {
      key: "first_sale",
      title: copy.dashboard.milestoneFirstSaleTitle,
      body: copy.dashboard.milestoneFirstSaleBody,
      cta: copy.dashboard.milestoneFirstSaleCta,
      to: "/reports",
    },
    {
      key: "open_shift",
      title: copy.dashboard.milestoneShiftTitle,
      body: copy.dashboard.milestoneShiftBody,
      cta: copy.dashboard.milestoneShiftCta,
      to: "/register",
    },
    {
      key: "inventory",
      title: copy.dashboard.milestoneInventoryTitle,
      body: copy.dashboard.milestoneInventoryBody,
      cta: copy.dashboard.milestoneInventoryCta,
      to: "/shifts",
    },
    {
      key: "first_product",
      title: copy.dashboard.milestoneProductTitle,
      body: copy.dashboard.milestoneProductBody,
      cta: copy.dashboard.milestoneProductCta,
      to: "/catalog?inventory=activate",
    },
  ];
  const milestone = milestones.find((item) => completed.has(item.key));
  if (!milestone) return null;

  return (
    <Card className="border-kova-growth/20 bg-kova-growth/[0.04]">
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-kova-growth/10 text-kova-growth">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{milestone.title}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{milestone.body}</p>
        </div>
        <Link to={milestone.to} className="shrink-0">
          <Button size="sm" variant="outline">
            {milestone.cta}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
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
  useDocumentTitle(copy.documentTitles.dashboard);
  const { state } = useAuth();
  const tenantName = formatTenantName(state.status === "authenticated" ? state.tenantName : "");
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [period, setPeriod] = useState<Period>("day");

  const load = useCallback(async (selected: Period) => {
    setLoadState({ status: "loading" });
    try {
      // Fetch the tenant timezone first so date ranges are computed against the
      // operator's local day, not UTC. Falls back to America/Mexico_City.
      const profileEarly = await getBusinessProfile().catch(() => null);
      const tz = profileEarly?.timezone || DEFAULT_TIMEZONE;
      const { current, previous, compareLabel } = periodRanges(selected, tz);

      const [
        summary,
        payments,
        hourly,
        topProducts,
        productsResult,
        stock,
        lowStock,
        billing,
        onboarding,
        previousSummary,
        employees,
        closedShifts,
        story,
      ] = await Promise.all([
        getSalesSummary(current.start, current.end),
        getPaymentBreakdown(current.start, current.end),
        getSalesByHour(current.start, current.end).catch(() => [] as SalesByHourRow[]),
        getTopProducts(current.start, current.end),
        listProducts().catch(() => [] as Awaited<ReturnType<typeof listProducts>>),
        listStock().catch(() => [] as Awaited<ReturnType<typeof listStock>>),
        listLowStock().catch(() => [] as Awaited<ReturnType<typeof listLowStock>>),
        getBillingSubscription().catch(() => null),
        getOnboardingState().catch(() => null),
        getSalesSummary(previous.start, previous.end).catch(() => null),
        listEmployees().catch(() => [] as Awaited<ReturnType<typeof listEmployees>>),
        listClosedShifts().catch(() => [] as Awaited<ReturnType<typeof listClosedShifts>>),
        getBusinessStory(current.start, current.end).catch(() => null),
      ]);
      const profile = profileEarly;

      const subscriptionStatus = billing?.subscription?.status;

      setLoadState({
        status: "ready",
        summary,
        yesterday: previousSummary,
        payments,
        hourly,
        topProducts,
        hasProducts: productsResult.some((p) => p.is_active),
        trackedInventoryCount: stock.length,
        lowStockCount: lowStock.length,
        lowStockItems: lowStock,
        activeCatalogCount: productsResult.filter((p) => p.is_active).length,
        activeEmployeeCount: employees.filter((employee) => employee.is_active).length,
        closedShiftCount: closedShifts.length,
        hasActiveSubscription: subscriptionStatus === "active" || subscriptionStatus === "trialing",
        billing,
        onboarding,
        story,
        timezone: profile?.timezone || DEFAULT_TIMEZONE,
        compareLabel,
      });
    } catch {
      setLoadState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  const tenantTimezone = loadState.status === "ready" ? loadState.timezone : DEFAULT_TIMEZONE;
  const todayLabel = new Date().toLocaleDateString("es-MX", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: tenantTimezone,
  });

  return (
    <main className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground mb-1">{getGreeting(tenantTimezone)}</p>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold tracking-tight">{tenantName || copy.app.dashboard}</h1>
            {loadState.status === "ready" && <LivePulse label="En vivo" />}
          </div>
          <p className="text-muted-foreground mt-1">{copy.dashboard.todayActivity(todayLabel)}</p>
        </div>
        <div
          role="radiogroup"
          aria-label={copy.dashboard.periodLabel}
          className="inline-flex rounded-[var(--radius-md)] border border-[color:var(--kova-border)] p-0.5 text-xs font-medium"
        >
          {([
            { value: "day", label: copy.dashboard.periodDay },
            { value: "week", label: copy.dashboard.periodWeek },
            { value: "month", label: copy.dashboard.periodMonth },
          ] as const).map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={period === value}
              onClick={() => setPeriod(value)}
              className={cn(
                "rounded-[var(--radius-sm)] px-3 py-1.5 transition-colors",
                period === value
                  ? "bg-[color:var(--kova-ink)] text-white"
                  : "text-[color:var(--kova-muted)] hover:text-[color:var(--kova-ink)]",
              )}
            >
              {label}
            </button>
          ))}
        </div>
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
            <Button variant="outline" onClick={() => void load(period)} className="ml-auto">
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

          <FirstValueMilestone onboarding={loadState.onboarding} />

          {loadState.lowStockCount > 0 && (
            <Link
              to="/inventory?filter=low"
              className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground transition-colors hover:bg-warning/15"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="font-medium">
                {copy.dashboard.lowStockAction(loadState.lowStockCount)}
              </span>
              <ArrowRight className="ml-auto h-4 w-4" />
            </Link>
          )}

          {/* Business health composite score */}
          <BusinessHealthCard
            summary={loadState.summary}
            yesterday={loadState.yesterday}
            payments={loadState.payments}
            lowStockCount={loadState.lowStockCount}
          />

          {/* Today's business story — narrative + recommended actions */}
          <InsightStrip
            summary={loadState.summary}
            yesterday={loadState.yesterday}
            payments={loadState.payments}
            hourly={loadState.hourly}
            topProducts={loadState.topProducts}
            lowStock={loadState.lowStockItems}
          />

          <TrialValueRecap
            billing={loadState.billing}
            orderCount={loadState.summary.order_count}
            netSales={loadState.summary.net_sales}
            activeCatalogCount={loadState.activeCatalogCount}
            activeEmployeeCount={loadState.activeEmployeeCount}
            closedShiftCount={loadState.closedShiftCount}
            story={loadState.story}
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
                          ? (n) => formatMoney(n)
                          : (n) => String(Math.round(n))}
                      />
                    </p>
                    <p className="text-xs text-kova-muted mt-0.5">{sub}</p>
                    <div className="mt-1.5">
                      <DeltaBadge
                        current={currentNum}
                        previous={prevNum}
                        compareLabel={loadState.compareLabel}
                      />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Middle row — collapse to a single explainer when no activity yet */}
          {loadState.payments.payments.length === 0 && loadState.topProducts.products.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 px-6 py-10 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--kova-mist)] text-[color:var(--kova-blue)]">
                  <BarChart3 className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold">{copy.dashboard.noActivityTitle}</p>
                  <p className="max-w-md text-sm text-muted-foreground">{copy.dashboard.noActivityBody}</p>
                </div>
                <Link
                  to="/register"
                  className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-[color:var(--kova-blue)] hover:underline"
                >
                  {copy.dashboard.noActivityCta}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </CardContent>
            </Card>
          ) : (
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
          )}

          {/* Contextual Actions */}
          <Card>
            <CardHeader>
              <CardTitle>{copy.dashboard.contextualActions}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { to: "/shifts", icon: Clock, iconClass: "bg-kova-mist text-kova-ink", label: copy.dashboard.closeShiftAction, desc: copy.dashboard.closeShiftDesc },
                  { to: "/reports", icon: BarChart3, iconClass: "bg-kova-blue/10 text-kova-blue", label: copy.dashboard.exportSalesAction, desc: copy.dashboard.exportSalesDesc },
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
                <Link to="/shifts" className="group">
                  <div className="flex h-full items-center gap-3 rounded-lg border p-3 transition-all hover:border-kova-blue/50 hover:shadow-sm">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-kova-growth/10 text-kova-growth">
                      <Receipt className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{copy.dashboard.printZAction}</p>
                      <p className="text-xs text-muted-foreground">{copy.dashboard.printZDesc}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
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

function TrialValueRecap({
  billing,
  orderCount,
  netSales,
  activeCatalogCount,
  activeEmployeeCount,
  closedShiftCount,
  story,
}: {
  billing: BillingSubscription | null;
  orderCount: number;
  netSales: string;
  activeCatalogCount: number;
  activeEmployeeCount: number;
  closedShiftCount: number;
  story: BusinessStoryReport | null;
}) {
  const access = billing?.access;
  const subscriptionStatus = billing?.subscription?.status;
  const isTrial =
    access?.allowed &&
    (access.reason === "signup_trial" || access.reason === "trialing" || access.trialing) &&
    subscriptionStatus !== "active";
  if (!isTrial) return null;

  const bestDay = bestTrialDay(story);
  const metrics = [
    { label: copy.dashboard.trialRecapSales, value: String(orderCount) },
    { label: copy.dashboard.trialRecapCollected, value: formatMoney(netSales) },
    { label: copy.dashboard.trialRecapCatalog, value: String(activeCatalogCount) },
    { label: copy.dashboard.trialRecapEmployees, value: String(activeEmployeeCount) },
    { label: copy.dashboard.trialRecapClosedShifts, value: String(closedShiftCount) },
    { label: copy.dashboard.trialRecapBestDay, value: bestDay },
  ];

  return (
    <Card className="border-kova-blue/20 bg-kova-blue/[0.04]">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-kova-blue/10 text-kova-blue">
            <CreditCard className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{copy.dashboard.trialRecapTitle}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {copy.dashboard.trialRecapBody(formatMoney(netSales))}
            </p>
          </div>
          <Link to="/settings/billing" className="shrink-0">
            <Button size="sm">
              {copy.dashboard.upgradeNudgeCta}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-lg border bg-white/70 p-3">
              <p className="text-xs text-muted-foreground">{metric.label}</p>
              <p className="mt-1 truncate text-sm font-semibold">{metric.value}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function bestTrialDay(story: BusinessStoryReport | null): string {
  const best = [...(story?.sales_by_day ?? [])].sort((a, b) => Number(b.net_sales) - Number(a.net_sales))[0];
  if (!best || best.order_count === 0) return copy.dashboard.trialRecapNoBestDay;
  return copy.dashboard.trialRecapBestDayValue(
    new Date(`${best.date}T12:00:00`).toLocaleDateString("es-MX", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }),
    formatMoney(best.net_sales),
  );
}
