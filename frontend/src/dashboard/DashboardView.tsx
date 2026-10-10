import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  DEFAULT_TIMEZONE,
  daysAgoInTimezone,
  formatDayLong,
  formatDayWithWeekday,
  todayInTimezone,
  yesterdayInTimezone,
} from "@/i18n/date";
import { formatMoney, reasonLabel } from "@/orders/format";
import { getBusinessStory, getSalesByHour, getSalesSummary } from "@/reports/api";
import { listProducts } from "@/catalog/api";
import { listLowStock, listStock } from "@/inventory/api";
import { getBillingSubscription } from "@/billing/api";
import { getOnboardingState, type OnboardingState } from "@/onboarding/api";
import { getBusinessProfile, listEmployees } from "@/settings/api";
import { listClosedShifts } from "@/shifts/api";
import type { BillingSubscription } from "@/billing/types";
import type { BusinessStoryReport, SalesByHourRow, SalesSummary, PaymentBreakdown, TopProducts } from "@/reports/types";
import { formatHourRange, topHoursByNetSales, totalNetSales } from "@/reports/hours";
import type { StockItem } from "@/inventory/types";
import { InsightStrip } from "./InsightStrip";
import { BusinessHealthCard } from "./BusinessHealthCard";
import { paymentsFromStory, summaryFromStory, topProductsFromStory } from "./storyAdapters";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DeltaChip } from "@/components/ui/stat-tile";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ArcKicker } from "@/components/ui/arc-kicker";
import { calculateSafeGrowth, MIN_MONEY_BASE } from "@/lib/growth";
import { copy } from "@/i18n/messages";
import { cn } from "@/lib/utils";
import { formatTenantName } from "@/lib/formatTenantName";
import { CountUp } from "@/components/brand/RealTime";
import {
  ArrowRight,
  Package,
  BarChart3,
  Clock,
  CreditCard,
  Receipt,
  AlertCircle,
  CheckCircle2,
  Circle,
  Sparkles,
  X,
} from "lucide-react";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      identity: string | null;
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

function periodSubtitle(period: Period, timezone: string = DEFAULT_TIMEZONE): string {
  if (period === "week") return copy.dashboard.subtitleWeek;
  if (period === "month") return copy.dashboard.subtitleMonth;
  const formatted = formatDayLong(todayInTimezone(timezone));
  return copy.dashboard.subtitleToday(formatted);
}

function OnboardingChecklist({
  hasProducts,
  orderCount,
  trackedInventoryCount,
  hasActiveSubscription,
  onboarding,
  tenantName,
}: {
  hasProducts: boolean;
  orderCount: number;
  trackedInventoryCount: number;
  hasActiveSubscription: boolean;
  onboarding: OnboardingState | null;
  tenantName: string;
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
  const doneCount = steps.filter((s) => s.done).length;

  // One-time celebration when the checklist is first completed. The flag is
  // namespaced per business so a shared browser doesn't suppress it for a
  // second account. A returning, already-celebrated owner sees nothing.
  const celebratedKey = `kova-onboarding-celebrated:${tenantName || "default"}`;
  const [celebrationDismissed, setCelebrationDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(celebratedKey) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (allDone && !celebrationDismissed) {
      try {
        localStorage.setItem(celebratedKey, "1");
      } catch {
        // ignore — celebration just shows until reload
      }
    }
  }, [allDone, celebrationDismissed, celebratedKey]);

  if (allDone) {
    if (celebrationDismissed) return null;
    return (
      <Card className="border-kova-growth/30 bg-kova-growth/5 animate-fade-in">
        <CardContent className="flex items-start gap-4 p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-kova-growth/15 text-kova-growth">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-kova-ink">
              {copy.dashboard.onboardingDoneTitle}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {copy.dashboard.onboardingDoneBody}
            </p>
            <Link
              to="/reports"
              className={cn("mt-3", buttonVariants({ size: "sm" }))}
            >
              {copy.dashboard.onboardingDoneCta}
            </Link>
          </div>
          <button
            type="button"
            onClick={() => setCelebrationDismissed(true)}
            aria-label={copy.dashboard.onboardingDoneDismiss}
            className="shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-kova-growth/10 hover:text-kova-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-kova-blue/20 bg-kova-blue/[0.04] animate-fade-in">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold leading-none tracking-tight">{copy.dashboard.onboardingTitle}</h2>
          <span className="text-xs text-muted-foreground">
            {doneCount}/{steps.length}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{copy.dashboard.onboardingSubtitle}</p>
        {/* Progress bar */}
        <div className="h-1.5 rounded-full bg-muted mt-2 overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-standard"
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
                <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">{step.desc}</p>
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

function DashboardExecutiveSummary({
  summary,
  previous,
  compareLabel,
}: {
  summary: SalesSummary;
  previous: SalesSummary | null;
  compareLabel: string;
}) {
  const currentNet = Number(summary.net_sales);
  const previousNet = previous ? Number(previous.net_sales) : null;
  const avgTicket = summary.order_count > 0 ? currentNet / summary.order_count : 0;
  const growth = calculateSafeGrowth(currentNet, previousNet, { minBase: MIN_MONEY_BASE });
  const scaleMax = Math.max(currentNet, previousNet ?? 0, 1) * 1.12;
  const currentWidth = Math.min(100, Math.max(currentNet > 0 ? 4 : 0, (currentNet / scaleMax) * 100));
  const previousMarker = previousNet === null ? null : Math.min(100, Math.max(0, (previousNet / scaleMax) * 100));
  const secondaryMetrics = [
    {
      label: copy.dashboard.orders,
      value: String(summary.order_count),
      detail: summary.void_count > 0
        ? copy.dashboard.voidedCount(summary.void_count)
        : copy.dashboard.noVoidsToday,
    },
    {
      label: copy.dashboard.avgTicket,
      value: formatMoney(avgTicket),
      detail: copy.dashboard.perCompletedOrder,
    },
    {
      label: copy.dashboard.refunds,
      value: String(summary.refund_count),
      detail: formatMoney(summary.refund_total),
    },
  ];

  return (
    <Card className="overflow-hidden">
      <div className="grid lg:grid-cols-[minmax(0,1.55fr)_minmax(260px,0.75fr)]">
        <div className="border-b border-kova-border p-5 sm:p-6 lg:border-b-0 lg:border-r">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-kova-tertiary">
            {copy.dashboard.netSales}
          </p>
          <div className="mt-3 flex flex-wrap items-baseline gap-3">
            <p className="text-4xl font-bold tracking-[-0.04em] text-kova-ink sm:text-5xl">
              <CountUp value={currentNet} format={(value) => formatMoney(value)} />
            </p>
            <DeltaChip growth={growth} current={currentNet} previous={previousNet ?? 0} format="money" compareLabel={compareLabel} />
          </div>
          <p className="mt-2 text-sm text-kova-muted tabular-nums">
            {copy.dashboard.grossSuffix(formatMoney(summary.gross_sales))}
          </p>
          <div className="mt-7">
            <div className="relative h-2 rounded-full bg-kova-mist">
              <div className="h-full rounded-full bg-kova-growth transition-[width] duration-500" style={{ width: `${currentWidth}%` }} />
              {previousMarker !== null ? (
                <span className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-kova-ink" style={{ left: `${previousMarker}%` }} aria-hidden="true" />
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-kova-tertiary">
              <span>Avance del periodo</span>
              {previousNet !== null ? (
                <span className="tabular-nums">Periodo anterior · {formatMoney(previousNet)}</span>
              ) : (
                <span>Sin comparación todavía</span>
              )}
            </div>
          </div>
        </div>
        <dl className="divide-y divide-kova-border">
          {secondaryMetrics.map((metric) => (
            <div key={metric.label} className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
              <dt>
                <span className="block text-sm text-kova-muted">{metric.label}</span>
                <span className="mt-0.5 block text-xs text-kova-tertiary">{metric.detail}</span>
              </dt>
              <dd className="shrink-0 text-xl font-semibold tracking-tight text-kova-ink tabular-nums">{metric.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Card>
  );
}

export default function DashboardView() {
  useDocumentTitle(copy.documentTitles.dashboard);
  const { state } = useAuth();
  const tenantName = formatTenantName(state.status === "authenticated" ? state.tenantName : "");
  const identity = state.status === "authenticated" ? `${state.tenantId}:${state.user.id}:${state.user.role}:${state.sessionMode}` : null;
  const [storedLoadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const loadState: LoadState = storedLoadState.status === "ready" && storedLoadState.identity !== identity
    ? { status: "loading" }
    : storedLoadState;
  const [period, setPeriod] = useState<Period>("day");
  const requestIdRef = useRef(0);

  const load = useCallback(async (selected: Period) => {
    const requestId = ++requestIdRef.current;
    setLoadState({ status: "loading" });
    try {
      // Fetch the tenant timezone first so date ranges are computed against the
      // operator's local day, not UTC. Falls back to America/Mexico_City.
      const profileEarly = await getBusinessProfile().catch(() => null);
      const tz = profileEarly?.timezone || DEFAULT_TIMEZONE;
      const { current, previous, compareLabel } = periodRanges(selected, tz);

      // The current-period story already contains the sales summary, payment
      // mix and product drivers, so those three endpoints are no longer
      // fetched; adapters below reshape the story into their exact shapes.
      // The story becomes the one hard-required fetch (it shares the same
      // billing/permission gate as the endpoints it replaces).
      const [
        hourly,
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
        getSalesByHour(current.start, current.end).catch(() => [] as SalesByHourRow[]),
        listProducts().catch(() => [] as Awaited<ReturnType<typeof listProducts>>),
        listStock().catch(() => [] as Awaited<ReturnType<typeof listStock>>),
        listLowStock().catch(() => [] as Awaited<ReturnType<typeof listLowStock>>),
        getBillingSubscription().catch(() => null),
        getOnboardingState().catch(() => null),
        getSalesSummary(previous.start, previous.end).catch(() => null),
        listEmployees().catch(() => [] as Awaited<ReturnType<typeof listEmployees>>),
        listClosedShifts().catch(() => [] as Awaited<ReturnType<typeof listClosedShifts>>),
        getBusinessStory(current.start, current.end),
      ]);
      const profile = profileEarly;
      const summary = summaryFromStory(story);
      const payments = paymentsFromStory(story);
      const topProducts = topProductsFromStory(story);

      const subscriptionStatus = billing?.subscription?.status;

      if (requestId !== requestIdRef.current) return;
      setLoadState({
        status: "ready",
        identity,
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
      if (requestId !== requestIdRef.current) return;
      setLoadState({ status: "error" });
    }
  }, [identity]);

  useEffect(() => {
    void load(period);
    return () => { requestIdRef.current += 1; };
  }, [load, period, identity]);

  const tenantTimezone = loadState.status === "ready" ? loadState.timezone : DEFAULT_TIMEZONE;
  const greeting = getGreeting(tenantTimezone);

  return (
    <ViewLayout width="wide" className="animate-fade-in">
      {/* Header — shared ViewHeader anatomy: greeting eyebrow, tenant title,
          period subtitle, and the period toggle as the actions slot. */}
      <div className="mb-8">
        <ViewHeader
          eyebrow={greeting}
          title={tenantName || copy.app.dashboard}
          meta={periodSubtitle(period, tenantTimezone)}
          actions={
            <SegmentedControl
              ariaLabel={copy.dashboard.periodLabel}
              options={[
                { value: "day", label: copy.dashboard.periodDay },
                { value: "week", label: copy.dashboard.periodWeek },
                { value: "month", label: copy.dashboard.periodMonth },
              ] as const}
              value={period}
              onValueChange={setPeriod}
            />
          }
        />
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
            {Array.from({ length: 2 }).map((_, i) => (
              <Card key={i}>
                <CardHeader><Skeleton className="h-4 w-32" /></CardHeader>
                <CardContent className="space-y-4">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className="flex items-center gap-3">
                      <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                      <Skeleton className="h-2 flex-1 rounded-full" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader><Skeleton className="h-4 w-32" /></CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-16 shrink-0" />
                </div>
              ))}
            </CardContent>
          </Card>
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
          <InsightStrip
            show="banner"
            summary={loadState.summary}
            yesterday={loadState.yesterday}
            hourly={loadState.hourly}
            topProducts={loadState.topProducts}
            lowStock={loadState.lowStockItems}
            compareLabel={loadState.compareLabel}
          />

          {/* Onboarding checklist — hidden once complete */}
          <OnboardingChecklist
            hasProducts={loadState.hasProducts}
            orderCount={loadState.summary.order_count}
            trackedInventoryCount={loadState.trackedInventoryCount}
            hasActiveSubscription={loadState.hasActiveSubscription}
            onboarding={loadState.onboarding}
            tenantName={tenantName}
          />

          <ArcKicker label={copy.dashboard.arcNow} />
          <DashboardExecutiveSummary
            summary={loadState.summary}
            previous={loadState.yesterday}
            compareLabel={loadState.compareLabel}
          />

          {/* Salud del negocio */}
          <ArcKicker label={copy.dashboard.arcHealth} />
          <BusinessHealthCard
            summary={loadState.summary}
            yesterday={loadState.yesterday}
            payments={loadState.payments}
            lowStockCount={loadState.lowStockCount}
            compareLabel={loadState.compareLabel}
          />

          {/* Qué hacer ahora */}
          <ArcKicker label={copy.dashboard.arcActions} />
          <InsightStrip
            show="actions"
            summary={loadState.summary}
            yesterday={loadState.yesterday}
            hourly={loadState.hourly}
            topProducts={loadState.topProducts}
            lowStock={loadState.lowStockItems}
            compareLabel={loadState.compareLabel}
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

          {/* Charts — collapse to a single explainer when there's no activity at all */}
          {loadState.payments.payments.length === 0 &&
          loadState.topProducts.products.length === 0 &&
          topHoursByNetSales(loadState.hourly, 3).length === 0 ? (
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
            <>
              <div className="grid gap-4 md:grid-cols-2">
                {/* Top hours: proportional bar plus period share; deep hourly analysis lives in Reportes */}
                <Card>
                  <CardHeader>
                    <h2 className="flex items-center justify-between gap-2 text-lg font-semibold leading-none tracking-tight">
                      <span className="flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        {copy.dashboard.topHoursTitle}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {copy.dashboard.topHoursBadge}
                      </span>
                    </h2>
                    <p className="text-sm text-muted-foreground">{copy.dashboard.topHoursSubtitle}</p>
                  </CardHeader>
                  <CardContent>
                    {(() => {
                      const topHours = topHoursByNetSales(loadState.hourly, 3);
                      if (topHours.length === 0) {
                        return (
                          <p className="text-sm text-muted-foreground py-6 text-center">
                            {copy.dashboard.topHoursEmpty}
                          </p>
                        );
                      }
                      const dayTotal = totalNetSales(loadState.hourly);
                      const peak = Number(topHours[0].net_sales);
                      return (
                        <>
                          <div className="space-y-4">
                            {topHours.map((h, i) => {
                              const net = Number(h.net_sales);
                              const width = peak > 0 ? Math.max(6, (net / peak) * 100) : 0;
                              const share = dayTotal > 0 ? Math.round((net / dayTotal) * 100) : 0;
                              return (
                                <div key={h.hour} className="flex items-center gap-3">
                                  <span
                                    className={cn(
                                      "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold shrink-0",
                                      i === 0 ? "bg-kova-blue text-white" : "bg-kova-mist text-kova-ink",
                                    )}
                                  >
                                    {i + 1}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-3">
                                      <p className="text-sm font-medium tabular-nums">{formatHourRange(h.hour)}</p>
                                      <span className="text-sm font-semibold shrink-0 tabular-nums">
                                        {formatMoney(h.net_sales)}
                                      </span>
                                    </div>
                                    <div className="mt-1.5 h-2 rounded-full bg-kova-mist overflow-hidden">
                                      <div
                                        className="h-full rounded-full bg-kova-blue transition-[width] duration-500 ease-standard"
                                        style={{ width: `${width}%` }}
                                      />
                                    </div>
                                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                                      <span>{copy.dashboard.topHoursOrders(h.order_count)}</span>
                                      <span className="tabular-nums">{copy.dashboard.topHoursShareOfDay(share)}</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <Link
                            to="/reports"
                            className="mt-2 inline-flex min-h-11 items-center gap-1 rounded-kova-md text-sm font-semibold text-[color:var(--kova-blue)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue focus-visible:ring-offset-2"
                          >
                            {copy.dashboard.topHoursViewMore}
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </>
                      );
                    })()}
                  </CardContent>
                </Card>

                {/* Payment Breakdown */}
                <Card>
                  <CardHeader>
                    <h2 className="flex items-center gap-2 text-lg font-semibold leading-none tracking-tight">
                      <CreditCard className="h-4 w-4" />
                      {copy.dashboard.paymentBreakdown}
                    </h2>
                  </CardHeader>
                  <CardContent>
                    <p className="mb-3 text-xs text-muted-foreground">{copy.dashboard.paymentBreakdownBasis}</p>
                    {loadState.payments.payments.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-6 text-center">
                        {copy.dashboard.noPaymentsToday}
                      </p>
                    ) : (
                      (() => {
                        const segColors = [
                          "bg-kova-ink",
                          "bg-kova-blue",
                          "bg-kova-growth",
                          "bg-warning",
                          "bg-kova-tertiary",
                        ];
                        const total = loadState.payments.payments.reduce(
                          (sum, x) => sum + Number(x.amount), 0,
                        );
                        return (
                          <div className="space-y-4">
                            {/* Single stacked bar */}
                            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-kova-mist">
                              {loadState.payments.payments.map((p, i) => {
                                const pct = total > 0 ? (Number(p.amount) / total) * 100 : 0;
                                return (
                                  <div
                                    key={p.method}
                                    className={`h-full ${segColors[i % segColors.length]} transition-[width] duration-500 ease-standard`}
                                    style={{ width: `${pct}%` }}
                                  />
                                );
                              })}
                            </div>
                            {/* Legend */}
                            <div className="space-y-2">
                              {loadState.payments.payments.map((p, i) => {
                                const pct = total > 0 ? Math.round((Number(p.amount) / total) * 100) : 0;
                                return (
                                  <div key={p.method} className="flex items-center justify-between gap-3 text-sm">
                                    <span className="flex items-center gap-2">
                                      <span className={`h-2.5 w-2.5 rounded-sm ${segColors[i % segColors.length]}`} />
                                      {reasonLabel(p.method)}
                                    </span>
                                    <span className="flex items-baseline gap-2 tabular-nums">
                                      <span className="font-semibold text-kova-ink">{pct}%</span>
                                      <span className="text-xs text-muted-foreground">{formatMoney(p.amount)}</span>
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Top Products — full width below the two-column row */}
              <Card>
                <CardHeader>
                  <h2 className="flex items-center gap-2 text-lg font-semibold leading-none tracking-tight">
                    <Package className="h-4 w-4" />
                    {copy.dashboard.topProducts}
                  </h2>
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
                          <span
                            className={cn(
                              "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold shrink-0",
                              i === 0 ? "bg-kova-blue text-white" : "bg-kova-mist text-kova-ink",
                            )}
                          >
                            {i + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{p.product_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {copy.reportsView.soldCount(p.quantity_sold)}
                            </p>
                          </div>
                          <span className="text-sm font-semibold shrink-0 tabular-nums">
                            {formatMoney(p.gross_sales)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {loadState.summary.order_count > 0 && (
            <Card>
              <CardHeader>
                <h2 className="text-lg font-semibold leading-none tracking-tight">{copy.dashboard.quickActions}</h2>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { to: "/shifts", icon: Clock, iconClass: "bg-kova-mist text-kova-ink", label: copy.dashboard.closeShiftAction, desc: copy.dashboard.closeShiftDesc },
                    { to: "/reports", icon: BarChart3, iconClass: "bg-kova-blue/10 text-kova-blue", label: copy.dashboard.viewReports, desc: copy.dashboard.viewReportsDesc },
                  ].map(({ to, icon: Icon, iconClass, label, desc }) => (
                    <Link key={to} to={to} className="group">
                      <div className="flex items-center gap-3 rounded-lg border p-3 transition-[border-color,box-shadow] duration-hover ease-standard hover:border-kova-blue/50 hover:shadow-sm">
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
                    <div className="flex h-full items-center gap-3 rounded-lg border p-3 transition-[border-color,box-shadow] duration-hover ease-standard hover:border-kova-blue/50 hover:shadow-sm">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-kova-growth/10 text-kova-growth">
                        <Receipt className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{copy.dashboard.closedShiftsAction}</p>
                        <p className="text-xs text-muted-foreground">{copy.dashboard.closedShiftsDesc}</p>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </ViewLayout>
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
            <p className="mt-1 text-sm leading-6 text-muted-foreground tabular-nums">
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
              <p className="mt-1 truncate text-sm font-semibold tabular-nums">{metric.value}</p>
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
    formatDayWithWeekday(best.date),
    formatMoney(best.net_sales),
  );
}
