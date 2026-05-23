import {
  FormEvent,
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  REPORTS_VIEW_ALL_PERMISSION,
  usePermission,
} from "../auth/permissions";
import { copy } from "../i18n/messages";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { timezoneLabel } from "@/i18n/timezones";
import { listLowStock, listVelocity } from "../inventory/api";
import type { InventoryVelocityItem, StockItem } from "../inventory/types";
import { formatMoney, reasonLabel } from "../orders/format";
import { getBusinessStory, getSalesByHour } from "./api";
import { InteractiveBarChart, InteractiveRankChart, type ChartRow } from "./InteractiveCharts";
import type { BusinessStoryReport, SalesByEmployeeRow, SalesByHourRow } from "./types";

import { Link as RouterLink } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  ChevronDown,
  Clock3,
  CreditCard,
  Filter,
  Package,
  RefreshCw,
  RotateCcw,
  ShieldOff,
  ShoppingCart,
  Sparkles,
  Users,
} from "lucide-react";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "loaded";
      story: BusinessStoryReport;
      hourly: SalesByHourRow[];
      previousStory: BusinessStoryReport | null;
      lowStock: StockItem[];
      velocity: InventoryVelocityItem[];
    };

function today(): string {
  return toISODate(new Date());
}

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function localDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function addDays(value: string, days: number): string {
  const date = localDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toISODate(date);
}

function daysBetweenInclusive(startDate: string, endDate: string): number {
  const start = localDate(startDate).getTime();
  const end = localDate(endDate).getTime();
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

function previousComparableRange(startDate: string, endDate: string) {
  const days = daysBetweenInclusive(startDate, endDate);
  const previousEnd = addDays(startDate, -1);
  const previousStart = addDays(previousEnd, -(days - 1));
  return { startDate: previousStart, endDate: previousEnd };
}

function currentMonthStart(): string {
  const date = new Date();
  return toISODate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)));
}

function lastSevenDaysStart(): string {
  return addDays(today(), -6);
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function dateWithWeekdayLabel(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  const weekday = new Intl.DateTimeFormat("es-MX", { weekday: "short", timeZone: "UTC" })
    .format(date)
    .replace(/\.$/, "");
  const capitalized = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  const dm = new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
  return `${capitalized} ${dm}`;
}

function fullDateLabel(value: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function pctLabel(value: number): string {
  return `${value}%`;
}

function chartCopy() {
  return {
    detailPlaceholder: copy.reportsView.chartDetailPlaceholder,
    totalShareLabel: copy.reportsView.chartShare,
  };
}

export default function ReportsView() {
  useDocumentTitle("Reportes");
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
      const [story, hourly] = await Promise.all([
        getBusinessStory(startDate, endDate),
        getSalesByHour(startDate, endDate).catch(() => []),
      ]);
      const previousRange = previousComparableRange(startDate, endDate);
      const [previousStory, lowStock, velocity] = await Promise.all([
        getBusinessStory(previousRange.startDate, previousRange.endDate).catch(() => null),
        listLowStock().catch(() => []),
        listVelocity().catch(() => []),
      ]);
      setLoadState({
        status: "loaded",
        story,
        hourly,
        previousStory,
        lowStock,
        velocity,
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

  const applyPreset = (preset: ReportPreset) => {
    if (preset === "today") {
      setStartDate(today());
      setEndDate(today());
      return;
    }
    if (preset === "seven_days") {
      setStartDate(lastSevenDaysStart());
      setEndDate(today());
      return;
    }
    setStartDate(currentMonthStart());
    setEndDate(today());
  };

  if (!canViewReports) {
    return (
      <main className="flex-1 p-6">
        <div className="mb-6 flex items-center gap-3">
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
    <main className="flex-1 space-y-6 p-4 sm:p-6">
      <ReportsHeader
        startDate={startDate}
        endDate={endDate}
        setStartDate={setStartDate}
        setEndDate={setEndDate}
        submit={submit}
        applyPreset={applyPreset}
        activePreset={activePreset(startDate, endDate)}
      />

      {loadState.status === "loading" ? <LoadingState /> : null}
      {loadState.status === "error" ? <ErrorState onRetry={load} /> : null}

      {loadState.status === "loaded" ? (
        <ReportsStory
          story={loadState.story}
          hourly={loadState.hourly}
          previousStory={loadState.previousStory}
          lowStock={loadState.lowStock}
          velocity={loadState.velocity}
          onResetRange={() => {
            setStartDate(today());
            setEndDate(today());
          }}
        />
      ) : null}
    </main>
  );
}

type ReportPreset = "today" | "seven_days" | "month";

function activePreset(startDate: string, endDate: string): ReportPreset | null {
  const currentToday = today();
  if (startDate === currentToday && endDate === currentToday) return "today";
  if (startDate === lastSevenDaysStart() && endDate === currentToday) return "seven_days";
  if (startDate === currentMonthStart() && endDate === currentToday) return "month";
  return null;
}

function ReportsHeader({
  startDate,
  endDate,
  setStartDate,
  setEndDate,
  submit,
  applyPreset,
  activePreset,
}: {
  startDate: string;
  endDate: string;
  setStartDate: (value: string) => void;
  setEndDate: (value: string) => void;
  submit: (event: FormEvent) => void;
  applyPreset: (preset: ReportPreset) => void;
  activePreset: ReportPreset | null;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm font-medium text-muted-foreground">
          {copy.reportsView.storyEyebrow}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {copy.reportsView.title}
        </h1>
      </div>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-2">
          {(["today", "seven_days", "month"] as const).map((preset) => (
            <Button
              key={preset}
              type="button"
              size="sm"
              variant={activePreset === preset ? "default" : "outline"}
              onClick={() => applyPreset(preset)}
            >
              {copy.reportsView.presetLabel(preset)}
            </Button>
          ))}
        </div>
        <div className="min-w-[140px] flex-1 space-y-1.5">
          <Label htmlFor="report-start-date">{copy.reportsView.startDate}</Label>
          <Input
            id="report-start-date"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="w-full sm:w-40"
          />
        </div>
        <div className="min-w-[140px] flex-1 space-y-1.5">
          <Label htmlFor="report-end-date">{copy.reportsView.endDate}</Label>
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
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          <Skeleton className="mb-4 h-5 w-40" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Card key={index}>
            <CardContent className="p-5">
              <Skeleton className="mb-3 h-4 w-20" />
              <Skeleton className="h-7 w-28" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <AlertCircle className="mb-3 h-10 w-10 text-destructive" />
        <p className="text-sm font-medium text-destructive" role="alert">
          {copy.reportsView.loadError}
        </p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => onRetry()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {copy.reportsView.retry}
        </Button>
      </CardContent>
    </Card>
  );
}

function ReportsStory({
  story,
  hourly,
  previousStory,
  lowStock,
  velocity,
  onResetRange,
}: {
  story: BusinessStoryReport;
  hourly: SalesByHourRow[];
  previousStory: BusinessStoryReport | null;
  lowStock: StockItem[];
  velocity: InventoryVelocityItem[];
  onResetRange?: () => void;
}) {
  const hasSales = story.summary.completed_orders > 0;
  if (!hasSales) {
    return (
      <div className="space-y-6">
        <EmptyBusinessState onPickToday={onResetRange} />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <ExecutiveSummary story={story} />
      <SmartInsights
        story={story}
        previousStory={previousStory}
        lowStock={lowStock}
        velocity={velocity}
      />
      <ReportDetails>
        <TimingAnalysis story={story} hourly={hourly} />
        <ProductInventoryAnalysis story={story} lowStock={lowStock} velocity={velocity} />
        <PaymentOperationsAnalysis story={story} />
        <EmployeeCoaching rows={story.sales_by_employee} />
        <EmployeeContributionPanel story={story} />
      </ReportDetails>
    </div>
  );
}

type SmartAction = {
  type: "opportunity" | "risk" | "good_signal" | "operational_improvement";
  title: string;
  detail: string;
};

function SmartInsights({
  story,
  previousStory,
  lowStock,
  velocity,
}: {
  story: BusinessStoryReport;
  previousStory: BusinessStoryReport | null;
  lowStock: StockItem[];
  velocity: InventoryVelocityItem[];
}) {
  const comparisons = comparativeInsights(story, previousStory);
  const inventoryActions = inventoryAwareActions(story, lowStock, velocity);
  const actions = ownerBriefActions(
    inventoryActions,
    story.recommended_actions,
    advancedRecommendations(story, previousStory),
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-kova-blue" />
          <CardTitle>{copy.reportsView.smartInsightsTitle}</CardTitle>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          {copy.reportsView.smartInsightsDescription}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {story.summary.completed_orders === 0 ? (
          <p className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
            {copy.reportsView.smartInsightsEmpty}
          </p>
        ) : null}

        <div className="grid gap-3 md:grid-cols-3">
          {comparisons.map((item) => (
            <div key={item.label} className="rounded-lg border bg-background p-4">
              <p className="text-xs font-medium uppercase text-muted-foreground">{item.label}</p>
              <p className="mt-2 text-lg font-semibold tabular-nums">{item.value}</p>
              <p
                className={cn(
                  "mt-1 text-sm",
                  item.tone === "up"
                    ? "text-kova-growth"
                    : item.tone === "down"
                      ? "text-destructive"
                      : "text-muted-foreground",
                )}
              >
                {item.detail}
              </p>
            </div>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {actions.map((action) => (
            <InsightCard
              key={`${action.title}-${action.detail}`}
              type={action.type}
              data-testid="owner-brief-action"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{copy.reportsView.actionType(action.type)}</Badge>
                <p className="font-semibold">{action.title}</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{action.detail}</p>
            </InsightCard>
          ))}
          {actions.length === 0 && story.summary.completed_orders > 0 ? (
            <InsightCard type="good_signal">
              <p className="font-semibold">{copy.reportsView.smartInsightsStableTitle}</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {copy.reportsView.smartInsightsStableDetail}
              </p>
            </InsightCard>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ownerBriefActions(
  inventoryActions: SmartAction[],
  storyActions: SmartAction[],
  advancedActions: SmartAction[],
): SmartAction[] {
  // Dedupe by title only: when the backend story and the local inventory
  // signals both surface "Reabastece X" for the same product with different
  // detail strings, we still want a single card. The earlier action wins so
  // the inventory signal (which has the threshold/velocity context) keeps
  // priority over the generic backend recommendation.
  const seen = new Set<string>();
  return [...inventoryActions, ...storyActions, ...advancedActions]
    .filter((action) => {
      const key = action.title.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

function comparativeInsights(
  story: BusinessStoryReport,
  previousStory: BusinessStoryReport | null,
) {
  const previousHasSales = (previousStory?.summary.completed_orders ?? 0) > 0;
  const netSalesChange = previousHasSales
    ? pctChange(Number(story.summary.net_sales), Number(previousStory?.summary.net_sales ?? 0))
    : null;
  const orderChange = previousHasSales
    ? pctChange(story.summary.completed_orders, previousStory?.summary.completed_orders ?? 0)
    : null;
  const currentBestDaypart = bestDaypartRow(story);
  const previousBestDaypart = previousStory ? bestDaypartRow(previousStory) : null;

  return [
    {
      label: copy.reportsView.compareNetSales,
      value: formatMoney(story.summary.net_sales),
      detail:
        netSalesChange === null
          ? copy.reportsView.compareNoPrevious
          : copy.reportsView.compareDelta(netSalesChange, copy.reportsView.previousPeriod),
      tone: toneFromDelta(netSalesChange),
    },
    {
      label: copy.reportsView.compareOrders,
      value: String(story.summary.completed_orders),
      detail:
        orderChange === null
          ? copy.reportsView.compareNoPrevious
          : copy.reportsView.compareDelta(orderChange, copy.reportsView.previousPeriod),
      tone: toneFromDelta(orderChange),
    },
    {
      label: copy.reportsView.compareStrongestWindow,
      value: currentBestDaypart?.label ?? copy.reportsView.noData,
      detail: strongestWindowDetail(currentBestDaypart, previousBestDaypart, story.peak_hour),
      tone: "neutral" as const,
    },
  ];
}

function inventoryAwareActions(
  story: BusinessStoryReport,
  lowStock: StockItem[],
  velocity: InventoryVelocityItem[],
): SmartAction[] {
  const soldProducts = new Map(story.product_drivers.map((product) => [product.product_id, product]));
  const soldLowStock = lowStock
    .map((stock) => ({ stock, sold: soldProducts.get(stock.product_id) }))
    .filter((item): item is { stock: StockItem; sold: BusinessStoryReport["product_drivers"][number] } => Boolean(item.sold))
    .sort((a, b) => b.sold.quantity_sold - a.sold.quantity_sold)
    .slice(0, 2);
  const lowStockIds = new Set(soldLowStock.map((item) => item.stock.product_id));
  const velocityRisks = velocity
    .filter((item) => {
      const daysUntilOut = Number(item.days_until_out);
      return item.days_until_out !== null && Number.isFinite(daysUntilOut) && daysUntilOut <= 7 && !lowStockIds.has(item.product_id);
    })
    .sort((a, b) => Number(a.days_until_out) - Number(b.days_until_out))
    .slice(0, 2);

  // velocityRisks already filters out lowStockIds, so the two arrays cannot
  // duplicate the same product_id — but the backend story_actions may still
  // collide with these titles. Final cross-source dedupe lives in
  // ownerBriefActions (by title).
  return [
    ...soldLowStock.map(({ stock, sold }) => ({
      type: "risk" as const,
      title: copy.reportsView.inventoryRestockTitle(stock.product_name),
      detail: copy.reportsView.inventoryRestockDetail(
        stock.product_name,
        sold.quantity_sold,
        stock.stock_on_hand,
        stock.low_stock_threshold,
      ),
    })),
    ...velocityRisks.map((item) => ({
      type: "risk" as const,
      title: copy.reportsView.inventoryVelocityTitle(item.product_name),
      detail: copy.reportsView.inventoryVelocityDetail(
        item.product_name,
        Number(item.days_until_out),
        item.stock_on_hand,
        item.units_per_day_7d,
      ),
    })),
  ];
}

function advancedRecommendations(
  story: BusinessStoryReport,
  previousStory: BusinessStoryReport | null,
): SmartAction[] {
  const actions: SmartAction[] = [];
  const netSalesChange =
    previousStory && previousStory.summary.completed_orders > 0
      ? pctChange(Number(story.summary.net_sales), Number(previousStory.summary.net_sales))
      : null;

  if (netSalesChange !== null && netSalesChange <= -10) {
    actions.push({
      type: "risk",
      title: copy.reportsView.salesDropTitle,
      detail: copy.reportsView.salesDropDetail(Math.abs(netSalesChange)),
    });
  }

  if (story.peak_hour && story.peak_hour.order_count >= 3) {
    actions.push({
      type: "opportunity",
      title: copy.reportsView.peakHourActionTitle(story.peak_hour.label),
      detail: copy.reportsView.peakHourActionDetail(
        story.peak_hour.label,
        story.peak_hour.order_count,
        formatMoney(story.peak_hour.net_sales),
      ),
    });
  }

  if (story.dominant_payment?.method === "cash" && story.dominant_payment.sales_share_pct >= 70) {
    actions.push({
      type: "operational_improvement",
      title: copy.reportsView.cashHeavyTitle,
      detail: copy.reportsView.cashHeavyDetail(story.dominant_payment.sales_share_pct),
    });
  }

  if (story.summary.refund_count === 0 && story.summary.cancellation_count === 0 && story.summary.completed_orders > 0) {
    actions.push({
      type: "good_signal",
      title: copy.reportsView.cleanOpsActionTitle,
      detail: copy.reportsView.cleanOpsActionDetail,
    });
  }

  return actions.slice(0, 4);
}

function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function toneFromDelta(delta: number | null): "up" | "down" | "neutral" {
  if (delta === null || delta === 0) return "neutral";
  return delta > 0 ? "up" : "down";
}

function strongestWindowDetail(
  currentDaypart: ReturnType<typeof bestDaypartRow>,
  previousDaypart: ReturnType<typeof bestDaypartRow>,
  peakHour: BusinessStoryReport["peak_hour"],
): string {
  if (currentDaypart && previousDaypart) {
    const previousDetail = copy.reportsView.compareDaypart(previousDaypart.label);
    return peakHour && peakHour.daypart_key === currentDaypart.key
      ? `${previousDetail} ${copy.reportsView.currentPeakHour(peakHour.label)}`
      : previousDetail;
  }
  if (currentDaypart && peakHour && peakHour.daypart_key === currentDaypart.key) {
    return copy.reportsView.currentPeakHour(peakHour.label);
  }
  return copy.reportsView.compareNoPrevious;
}

function ReportDetails({ children }: { children: ReactNode }) {
  return (
    <details className="group rounded-xl border bg-card text-card-foreground shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 marker:hidden">
        <div className="min-w-0">
          <p className="font-semibold">{copy.reportsView.detailToggleTitle}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {copy.reportsView.detailToggleBody}
          </p>
        </div>
        <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-6 border-t p-5">{children}</div>
    </details>
  );
}

function ExecutiveSummary({ story }: { story: BusinessStoryReport }) {
  const bestDaypart = bestDaypartRow(story);
  return (
    <Card className="border-kova-blue/20 bg-kova-blue/5">
      <CardContent className="grid gap-5 p-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-kova-blue" />
            <p className="text-sm font-semibold text-kova-blue">
              {copy.reportsView.executiveSummary}
            </p>
          </div>
          <p className="max-w-4xl text-base leading-7 text-kova-ink">
            {executiveSummaryCopy(story)}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          <SummaryFact
            label={copy.reportsView.period}
            value={`${fullDateLabel(story.summary.start_date)} - ${fullDateLabel(story.summary.end_date)}`}
          />
          <SummaryFact
            label={copy.reportsView.bestMoment}
            value={bestDaypart?.label ?? copy.reportsView.noData}
          />
          <SummaryFact
            label={copy.reportsView.timezone}
            value={timezoneLabel(story.summary.timezone)}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background/80 p-3">
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function EmptyBusinessState({ onPickToday }: { onPickToday?: () => void }) {
  return (
    <Card className="border-kova-blue/20 bg-kova-blue/[0.03]">
      <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-kova-blue/10">
          <ShoppingCart className="h-6 w-6 text-kova-blue" />
        </div>
        <div className="flex-1">
          <p className="text-base font-semibold">{copy.reportsView.emptyStoryTitle}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {copy.reportsView.emptyStoryBody}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:shrink-0">
          <RouterLink to="/register" className={buttonVariants({ size: "sm" })}>
            {copy.reportsView.emptyStoryCta}
          </RouterLink>
          {onPickToday ? (
            <Button variant="outline" size="sm" onClick={onPickToday}>
              {copy.reportsView.emptyStorySecondaryCta}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function DecisionSection({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          {icon}
          <CardTitle>{title}</CardTitle>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function SalesByDayChart({ story }: { story: BusinessStoryReport }) {
  const rows: ChartRow[] = story.sales_by_day.map((row) => ({
    id: row.date,
    label: dateWithWeekdayLabel(row.date),
    value: Number(row.net_sales),
    valueLabel: formatMoney(row.net_sales),
    meta: [
      { label: copy.reportsView.chartOrders, value: String(row.order_count) },
      { label: copy.reportsView.avgTicket, value: formatMoney(row.average_ticket) },
    ],
    accentClassName: "bg-kova-blue",
  }));
  return (
    <InteractiveBarChart
      title={copy.reportsView.salesByDayQuestion}
      rows={rows}
      emptyLabel={copy.reportsView.noDailySales}
      ariaLabel={copy.reportsView.salesByDayTitle}
      {...chartCopy()}
    />
  );
}

function SalesByDaypartChart({ story }: { story: BusinessStoryReport }) {
  const rows: ChartRow[] = story.sales_by_daypart.map((row) => ({
    id: row.key,
    label: row.label,
    value: Number(row.net_sales),
    valueLabel: formatMoney(row.net_sales),
    meta: [
      { label: copy.reportsView.chartOrders, value: String(row.order_count) },
      { label: copy.reportsView.chartShareLabel, value: pctLabel(row.sales_share_pct) },
      { label: copy.reportsView.avgTicket, value: formatMoney(row.average_ticket) },
    ],
    accentClassName: "bg-kova-growth",
  }));
  return (
    <InteractiveRankChart
      title={copy.reportsView.daypartSalesQuestion}
      rows={rows}
      emptyLabel={copy.reportsView.noDaypartSales}
      ariaLabel={copy.reportsView.daypartSalesTitle}
      {...chartCopy()}
    />
  );
}

function HourlyChart({ rows, story }: { rows: SalesByHourRow[]; story: BusinessStoryReport }) {
  const toChartRow = (row: SalesByHourRow, accent: string): ChartRow => ({
    id: String(row.hour),
    label: `${String(row.hour).padStart(2, "0")}:00`,
    value: Number(row.net_sales),
    valueLabel: formatMoney(row.net_sales),
    meta: [{ label: copy.reportsView.chartOrders, value: String(row.order_count) }],
    accentClassName: accent,
  });

  const active = rows.filter((row) => Number(row.net_sales) > 0);
  const sorted = [...active].sort((a, b) => Number(b.net_sales) - Number(a.net_sales));
  const bestRows = sorted.slice(0, 3).map((row) => toChartRow(row, "bg-kova-growth"));
  const worstRows = sorted
    .slice(-3)
    .reverse()
    .filter((row) => !bestRows.some((b) => b.id === String(row.hour)))
    .map((row) => toChartRow(row, "bg-kova-blue-light"));

  if (active.length === 0) {
    return (
      <InteractiveRankChart
        title={copy.reportsView.hourlyQuestion}
        rows={[]}
        emptyLabel={copy.reportsView.noHourlySales}
        ariaLabel={copy.reportsView.hourlySales}
        {...chartCopy()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <InteractiveRankChart
        title={copy.reportsView.hourlyTopTitle}
        insight={story.peak_hour ? copy.reportsView.peakHourDetail(story.peak_hour.label) : undefined}
        rows={bestRows}
        emptyLabel={copy.reportsView.noHourlySales}
        ariaLabel={copy.reportsView.hourlyTopAriaLabel}
        {...chartCopy()}
      />
      {worstRows.length > 0 && (
        <InteractiveRankChart
          title={copy.reportsView.hourlyWorstTitle}
          insight={copy.reportsView.hourlyWorstInsight}
          rows={worstRows}
          emptyLabel={copy.reportsView.noHourlySales}
          ariaLabel={copy.reportsView.hourlyWorstAriaLabel}
          {...chartCopy()}
        />
      )}
    </div>
  );
}

function TimingAnalysis({ story, hourly }: { story: BusinessStoryReport; hourly: SalesByHourRow[] }) {
  return (
    <DecisionSection
      icon={<ClockIcon />}
      title={copy.reportsView.timingAnalysisTitle}
      description={copy.reportsView.timingAnalysisDescription}
    >
      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SalesByDayChart story={story} />
        <SalesByDaypartChart story={story} />
        <div className="xl:col-span-2">
          <HourlyChart rows={hourly} story={story} />
        </div>
      </div>
    </DecisionSection>
  );
}

function ClockIcon() {
  return <Clock3 className="h-5 w-5 text-muted-foreground" />;
}

function ProductInventoryAnalysis({
  story,
  lowStock,
  velocity,
}: {
  story: BusinessStoryReport;
  lowStock: StockItem[];
  velocity: InventoryVelocityItem[];
}) {
  const lowStockByProduct = new Map(lowStock.map((item) => [item.product_id, item]));
  const velocityByProduct = new Map(velocity.map((item) => [item.product_id, item]));
  const rows = story.product_drivers.map((product) => {
    const stock = lowStockByProduct.get(product.product_id);
    const velocityItem = velocityByProduct.get(product.product_id);
    return {
      product,
      stock,
      velocity: velocityItem,
      action: productInventoryAction(product, stock, velocityItem),
    };
  });

  return (
    <DecisionSection
      icon={<Package className="h-5 w-5 text-muted-foreground" />}
      title={copy.reportsView.productInventoryTitle}
      description={copy.reportsView.productInventoryDescription}
    >
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/30 p-5 text-sm text-muted-foreground">
          {copy.reportsView.noProducts}
        </p>
      ) : (
        <>
        {/* Mobile: stacked cards (more readable than scrolling a 5-col table) */}
        <div className="sm:hidden space-y-3">
          {rows.map(({ product, stock, velocity: velocityItem, action }) => (
            <div key={product.product_id} className="rounded-lg border bg-card p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium text-sm leading-snug flex-1">{product.product_name}</p>
                <Badge variant={action.variant} className="shrink-0">{action.label}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div>
                  <p className="text-muted-foreground uppercase tracking-wide text-[10px]">{copy.reportsView.salesColumn}</p>
                  <p className="font-semibold tabular-nums">{formatMoney(product.gross_sales)}</p>
                  <p className="text-muted-foreground text-[11px]">{pctLabel(product.sales_share_pct)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground uppercase tracking-wide text-[10px]">{copy.reportsView.unitsColumn}</p>
                  <p className="font-semibold tabular-nums">{product.quantity_sold}</p>
                </div>
              </div>
              <div className="text-xs">
                <p className="text-muted-foreground uppercase tracking-wide text-[10px]">{copy.reportsView.stockColumn}</p>
                <p>
                  {stock || velocityItem ? copy.reportsView.stockStatus(
                    stock?.stock_on_hand ?? velocityItem?.stock_on_hand ?? 0,
                    stock?.low_stock_threshold ?? null,
                    velocityItem?.days_until_out ?? null,
                  ) : (
                    <span className="text-muted-foreground">{copy.reportsView.noTrackedStock}</span>
                  )}
                </p>
              </div>
              <p className="text-xs leading-5 text-muted-foreground border-t pt-2">{action.detail}</p>
            </div>
          ))}
        </div>

        {/* Desktop: tabular layout */}
        <div className="hidden sm:block overflow-x-auto rounded-lg border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">{copy.reportsView.productColumn}</th>
                <th className="px-4 py-3 font-medium">{copy.reportsView.salesColumn}</th>
                <th className="px-4 py-3 font-medium">{copy.reportsView.unitsColumn}</th>
                <th className="px-4 py-3 font-medium">{copy.reportsView.stockColumn}</th>
                <th className="px-4 py-3 font-medium">{copy.reportsView.suggestedActionColumn}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(({ product, stock, velocity: velocityItem, action }) => (
                <tr key={product.product_id} className="align-top">
                  <td className="px-4 py-3 font-medium">{product.product_name}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatMoney(product.gross_sales)}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {pctLabel(product.sales_share_pct)}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{product.quantity_sold}</td>
                  <td className="px-4 py-3">
                    {stock || velocityItem ? (
                      <span>
                        {copy.reportsView.stockStatus(
                          stock?.stock_on_hand ?? velocityItem?.stock_on_hand ?? 0,
                          stock?.low_stock_threshold ?? null,
                          velocityItem?.days_until_out ?? null,
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{copy.reportsView.noTrackedStock}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={action.variant}>{action.label}</Badge>
                    <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                      {action.detail}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
      <RestockAlertsPanel story={story} />
      <ProductTrendsPanel story={story} />
    </DecisionSection>
  );
}

function RestockAlertsPanel({ story }: { story: BusinessStoryReport }) {
  const alerts = story.restock_alerts ?? [];
  if (alerts.length === 0) return null;
  return (
    <div className="mt-6 rounded-lg border bg-card p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Package className="h-4 w-4 text-muted-foreground" />
        {copy.reportsView.restockAlertsTitle}
      </h3>
      <div className="space-y-2">
        {alerts.slice(0, 5).map((alert) => (
          <div
            key={alert.product_id}
            className={cn(
              "rounded-lg border px-3 py-2 text-sm",
              alert.severity === "critical"
                ? "border-destructive/30 bg-destructive/5"
                : "border-warning/30 bg-warning/5",
            )}
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-medium">{alert.product_name}</p>
              <Badge variant={alert.severity === "critical" ? "destructive" : "warning"}>
                {alert.severity === "critical"
                  ? copy.reportsView.restockSeverityCritical
                  : copy.reportsView.restockSeverityWarning}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{alert.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductTrendsPanel({ story }: { story: BusinessStoryReport }) {
  const trends = story.product_trends;
  if (!trends) return null;
  const growing = trends.growing.slice(0, 3);
  const declining = trends.declining.slice(0, 3);
  if (growing.length === 0 && declining.length === 0) return null;
  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      <TrendList
        title={copy.reportsView.trendsGrowingTitle}
        tone="growth"
        rows={growing}
        emptyLabel={copy.reportsView.trendsNoGrowing}
      />
      <TrendList
        title={copy.reportsView.trendsDecliningTitle}
        tone="risk"
        rows={declining}
        emptyLabel={copy.reportsView.trendsNoDeclining}
      />
    </div>
  );
}

function TrendList({
  title,
  tone,
  rows,
  emptyLabel,
}: {
  title: string;
  tone: "growth" | "risk";
  rows: BusinessStoryReport["product_trends"] extends infer T
    ? T extends { growing: infer R }
      ? R extends Array<infer Row>
        ? Row[]
        : never
      : never
    : never;
  emptyLabel: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.product_id} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium truncate">{row.product_name}</span>
              <span
                className={cn(
                  "tabular-nums text-xs font-semibold",
                  tone === "growth" ? "text-[color:var(--kova-growth)]" : "text-destructive",
                )}
              >
                {row.delta_pct > 0 ? "+" : ""}
                {row.delta_pct}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function productInventoryAction(
  product: BusinessStoryReport["product_drivers"][number],
  stock: StockItem | undefined,
  velocity: InventoryVelocityItem | undefined,
) {
  const daysUntilOut = velocity?.days_until_out === null ? null : Number(velocity?.days_until_out);
  if (stock?.is_low_stock) {
    return {
      label: copy.reportsView.actionRestock,
      detail: copy.reportsView.actionRestockDetail(product.product_name),
      variant: "destructive" as const,
    };
  }
  if (daysUntilOut !== null && Number.isFinite(daysUntilOut) && daysUntilOut <= 7) {
    return {
      label: copy.reportsView.actionPrepare,
      detail: copy.reportsView.actionPrepareDetail(product.product_name, daysUntilOut),
      variant: "secondary" as const,
    };
  }
  if (product.sales_share_pct >= 40) {
    return {
      label: copy.reportsView.actionProtect,
      detail: copy.reportsView.actionProtectDetail(product.product_name),
      variant: "secondary" as const,
    };
  }
  return {
    label: copy.reportsView.actionMonitor,
    detail: copy.reportsView.actionMonitorDetail(product.product_name),
    variant: "outline" as const,
  };
}

function PaymentMix({ story }: { story: BusinessStoryReport }) {
  const payment = story.dominant_payment;
  const rows: ChartRow[] = story.payment_mix.map((row) => ({
    id: row.method,
    label: reasonLabel(row.method),
    value: Number(row.amount),
    valueLabel: formatMoney(row.amount),
    meta: [
      { label: copy.reportsView.chartPayments, value: String(row.payment_count) },
      { label: copy.reportsView.chartShareLabel, value: pctLabel(row.sales_share_pct) },
    ],
    accentClassName: "bg-kova-blue",
  }));
  return (
    <div>
      <InteractiveRankChart
        title={copy.reportsView.paymentQuestion}
        insight={
          payment
            ? copy.reportsView.paymentStoryInsight(reasonLabel(payment.method), payment.sales_share_pct)
            : undefined
        }
        rows={rows}
        emptyLabel={copy.reportsView.noPayments}
        ariaLabel={copy.reportsView.paymentBreakdown}
        {...chartCopy()}
      />
    </div>
  );
}

function OperationsSignals({ story }: { story: BusinessStoryReport }) {
  const signals = story.operational_signals;
  return (
    <div>
      {signals.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/30 p-5 text-sm text-muted-foreground">
          {copy.reportsView.noOperationalSignals}
        </p>
      ) : (
        <div className="space-y-3">
          {signals.map((signal) => (
            <InsightCard key={`${signal.title}-${signal.detail}`} type={signal.type}>
              <p className="font-semibold">{signal.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{signal.detail}</p>
            </InsightCard>
          ))}
        </div>
      )}
    </div>
  );
}

function PaymentOperationsAnalysis({ story }: { story: BusinessStoryReport }) {
  return (
    <DecisionSection
      icon={<CreditCard className="h-5 w-5 text-muted-foreground" />}
      title={copy.reportsView.paymentOperationsTitle}
      description={copy.reportsView.paymentOperationsDescription}
    >
      <div className="grid gap-6 xl:grid-cols-2">
        <div>
          <PaymentMix story={story} />
          <p className="mt-2 text-xs text-muted-foreground">
            {copy.reportsView.grossVsNetNote}
          </p>
        </div>
        <div>
          <div className="mb-4 flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{copy.reportsView.operationsTitle}</h3>
          </div>
          <OperationsSignals story={story} />
        </div>
      </div>
    </DecisionSection>
  );
}

function EmployeeCoaching({ rows }: { rows: SalesByEmployeeRow[] }) {
  const topEmployee = [...rows].sort((a, b) => Number(b.net_sales) - Number(a.net_sales))[0];
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

  if (rows.length <= 1) {
    return (
      <DecisionSection
        icon={<Users className="h-5 w-5 text-muted-foreground" />}
        title={copy.reportsView.employeePerformance}
        description={copy.reportsView.employeeAnalysisDescription}
      >
        <p className="rounded-lg border border-dashed bg-muted/30 p-5 text-sm text-muted-foreground">
          {rows.length === 1
            ? copy.reportsView.employeeSingleInsight(rows[0].display_name)
            : copy.reportsView.noEmployeeSales}
        </p>
      </DecisionSection>
    );
  }

  return (
    <DecisionSection
      icon={<Users className="h-5 w-5 text-muted-foreground" />}
      title={copy.reportsView.employeePerformance}
      description={copy.reportsView.employeeAnalysisDescription}
    >
      <InteractiveBarChart
        title={copy.reportsView.employeeQuestion}
        insight={
          topEmployee ? copy.reportsView.employeeStoryInsight(topEmployee.display_name) : undefined
        }
        rows={chartRows}
        emptyLabel={copy.reportsView.noEmployeeSales}
        ariaLabel={copy.reportsView.employeePerformance}
        {...chartCopy()}
      />
    </DecisionSection>
  );
}

function EmployeeContributionPanel({ story }: { story: BusinessStoryReport }) {
  const contribution = story.employee_contribution;
  if (!contribution || contribution.rows.length === 0) return null;
  return (
    <div className="rounded-lg border bg-card p-4 mt-2">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Users className="h-4 w-4 text-muted-foreground" />
        {copy.reportsView.employeeContributionTitle}
      </h3>
      <p className="text-xs text-muted-foreground">
        {contribution.even_distribution
          ? copy.reportsView.employeeContributionEven
          : contribution.top
            ? copy.reportsView.employeeContributionTop(
                contribution.top.display_name,
                contribution.top.sales_share_pct,
              )
            : null}
      </p>
      <ul className="mt-3 space-y-1.5">
        {contribution.rows.map((row) => (
          <li
            key={row.user_id ?? row.display_name}
            className="flex items-center justify-between text-sm"
          >
            <span className="truncate">{row.display_name}</span>
            <span className="tabular-nums text-xs text-muted-foreground">
              {row.sales_share_pct}% · {formatMoney(row.net_sales)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InsightCard({
  type,
  children,
  ...props
}: {
  type: "opportunity" | "risk" | "good_signal" | "operational_improvement";
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn(
        "rounded-lg border p-4",
        type === "risk"
          ? "border-destructive/30 bg-destructive/5"
          : type === "good_signal"
            ? "border-kova-growth/30 bg-kova-growth/5"
            : "border-kova-blue/20 bg-kova-blue/5",
        props.className,
      )}
    >
      {children}
    </div>
  );
}

function bestDayRow(story: BusinessStoryReport) {
  return [...story.sales_by_day].sort((a, b) => Number(b.net_sales) - Number(a.net_sales))[0] ?? null;
}

function bestDaypartRow(story: BusinessStoryReport) {
  const row = [...story.sales_by_daypart].sort((a, b) => Number(b.net_sales) - Number(a.net_sales))[0];
  return row && Number(row.net_sales) > 0 ? row : null;
}

function executiveSummaryCopy(story: BusinessStoryReport): string {
  if (story.summary.completed_orders === 0) {
    return copy.reportsView.executiveEmpty(
      fullDateLabel(story.summary.start_date),
      fullDateLabel(story.summary.end_date),
    );
  }
  const bestDay = bestDayRow(story);
  const bestDaypart = bestDaypartRow(story);
  return [
    copy.reportsView.executiveIntro(
      fullDateLabel(story.summary.start_date),
      fullDateLabel(story.summary.end_date),
      formatMoney(story.summary.net_sales),
      story.summary.completed_orders,
      formatMoney(story.summary.average_ticket),
    ),
    bestDay ? copy.reportsView.executiveBestDay(dateLabel(bestDay.date)) : null,
    bestDaypart
      ? copy.reportsView.executiveBestDaypart(
          bestDaypart.label,
          story.peak_hour && story.peak_hour.daypart_key === bestDaypart.key ? story.peak_hour.label : null,
        )
      : null,
    story.top_product_by_sales
      ? copy.reportsView.executiveTopProduct(story.top_product_by_sales.product_name)
      : null,
    story.dominant_payment
      ? copy.reportsView.executivePayment(
          reasonLabel(story.dominant_payment.method),
          story.dominant_payment.sales_share_pct,
        )
      : null,
    story.summary.refund_count === 0 && story.summary.cancellation_count === 0
      ? copy.reportsView.executiveCleanOps
      : copy.reportsView.executiveOpsRisk,
  ].filter(Boolean).join(" ");
}
