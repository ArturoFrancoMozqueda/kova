import { type ComponentType, FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import {
  REPORTS_VIEW_ALL_PERMISSION,
  usePermission,
} from "../auth/permissions";
import { copy } from "../i18n/messages";
import { formatMoney, reasonLabel } from "../orders/format";
import { getBusinessStory, getSalesByHour } from "./api";
import { InteractiveBarChart, InteractiveRankChart, type ChartRow } from "./InteractiveCharts";
import type { BusinessStoryReport, SalesByEmployeeRow, SalesByHourRow } from "./types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  CalendarDays,
  Clock3,
  CreditCard,
  DollarSign,
  Filter,
  Package,
  RefreshCw,
  RotateCcw,
  ShieldOff,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "loaded";
      story: BusinessStoryReport;
      hourly: SalesByHourRow[];
    };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
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
      setLoadState({ status: "loaded", story, hourly });
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
      />

      {loadState.status === "loading" ? <LoadingState /> : null}
      {loadState.status === "error" ? <ErrorState onRetry={load} /> : null}

      {loadState.status === "loaded" ? (
        <ReportsStory story={loadState.story} hourly={loadState.hourly} />
      ) : null}
    </main>
  );
}

function ReportsHeader({
  startDate,
  endDate,
  setStartDate,
  setEndDate,
  submit,
}: {
  startDate: string;
  endDate: string;
  setStartDate: (value: string) => void;
  setEndDate: (value: string) => void;
  submit: (event: FormEvent) => void;
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

function ReportsStory({ story, hourly }: { story: BusinessStoryReport; hourly: SalesByHourRow[] }) {
  const hasSales = story.summary.completed_orders > 0;
  return (
    <div className="space-y-6">
      <ExecutiveSummary story={story} />
      {!hasSales ? <EmptyBusinessState /> : null}
      <KpiGrid story={story} />

      <StorySection
        kicker={copy.reportsView.whenItHappened}
        title={copy.reportsView.salesByDayTitle}
        description={dailyInsight(story)}
      >
        <SalesByDayChart story={story} />
      </StorySection>

      <StorySection
        kicker={copy.reportsView.whenItHappened}
        title={copy.reportsView.daypartSalesTitle}
        description={daypartInsight(story)}
      >
        <SalesByDaypartChart story={story} />
      </StorySection>

      <StorySection
        kicker={copy.reportsView.hourlyDrilldownKicker}
        title={copy.reportsView.hourlySales}
        description={peakHourInsight(story)}
      >
        <HourlyChart rows={hourly} story={story} />
      </StorySection>

      <section className="grid gap-6 xl:grid-cols-2">
        <SalesDrivers story={story} />
        <PaymentMix story={story} />
        <OperationsSignals story={story} />
        <EmployeeCoaching rows={story.sales_by_employee} />
      </section>

      <RecommendedActions story={story} />
    </div>
  );
}

function ExecutiveSummary({ story }: { story: BusinessStoryReport }) {
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
            value={story.sales_by_daypart.find((row) => row.net_sales !== "0.00")?.label ?? copy.reportsView.noData}
          />
          <SummaryFact
            label={copy.reportsView.timezone}
            value={story.summary.timezone}
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

function EmptyBusinessState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <ShoppingCart className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <p className="font-semibold">{copy.reportsView.emptyStoryTitle}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {copy.reportsView.emptyStoryBody}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function KpiGrid({ story }: { story: BusinessStoryReport }) {
  const bestDay = bestDayRow(story);
  const bestDaypart = bestDaypartRow(story);
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={copy.reportsView.title}>
      <KpiCard
        icon={TrendingUp}
        label={copy.reportsView.netSales}
        value={formatMoney(story.summary.net_sales)}
        microcopy={copy.reportsView.kpiNetSales(story.summary.completed_orders)}
        accent="text-kova-blue"
      />
      <KpiCard
        icon={ShoppingCart}
        label={copy.reportsView.completedOrders}
        value={String(story.summary.completed_orders)}
        microcopy={copy.reportsView.kpiOrders(story.summary.completed_orders)}
        accent="text-kova-ink"
      />
      <KpiCard
        icon={DollarSign}
        label={copy.reportsView.avgTicket}
        value={formatMoney(story.summary.average_ticket)}
        microcopy={copy.reportsView.kpiAverageTicket(formatMoney(story.summary.average_ticket))}
        accent="text-kova-growth"
      />
      <KpiCard
        icon={Package}
        label={copy.reportsView.topProduct}
        value={story.top_product_by_sales?.product_name ?? copy.reportsView.noData}
        microcopy={
          story.top_product_by_sales
            ? copy.reportsView.kpiTopProduct(
                story.top_product_by_sales.product_name,
                story.top_product_by_sales.sales_share_pct,
              )
            : copy.reportsView.kpiTopProductEmpty
        }
        accent="text-kova-growth"
      />
      <KpiCard
        icon={CalendarDays}
        label={copy.reportsView.bestDay}
        value={bestDay ? dateLabel(bestDay.date) : copy.reportsView.noData}
        microcopy={
          bestDay
            ? copy.reportsView.kpiBestDay(dateLabel(bestDay.date), bestDay.sales_share_pct)
            : copy.reportsView.kpiBestDayEmpty
        }
        accent="text-kova-blue"
      />
      <KpiCard
        icon={Clock3}
        label={copy.reportsView.bestDaypart}
        value={bestDaypart ? bestDaypart.label : copy.reportsView.noData}
        microcopy={
          bestDaypart
            ? copy.reportsView.kpiBestDaypart(bestDaypart.label, bestDaypart.sales_share_pct)
            : copy.reportsView.kpiBestDaypartEmpty
        }
        accent="text-kova-blue-light"
      />
      <KpiCard
        icon={RotateCcw}
        label={copy.reportsView.refunds}
        value={String(story.summary.refund_count)}
        microcopy={copy.reportsView.kpiRefunds(story.summary.refund_count)}
        accent="text-destructive"
      />
      <KpiCard
        icon={XCircle}
        label={copy.reportsView.voids}
        value={String(story.summary.cancellation_count)}
        microcopy={copy.reportsView.kpiCancellations(story.summary.cancellation_count)}
        accent="text-warning"
      />
    </section>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  microcopy,
  accent,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  microcopy: string;
  accent?: string;
}) {
  return (
    <Card className="data-card">
      <CardContent className="p-5">
        <div className="mb-2 flex items-center gap-2">
          <Icon className={cn("h-4 w-4", accent ?? "text-muted-foreground")} />
          <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
        </div>
        <p className="min-h-8 break-words text-2xl font-bold tracking-tight tabular-nums">
          {value}
        </p>
        <p className="mt-2 text-sm leading-5 text-muted-foreground">{microcopy}</p>
      </CardContent>
    </Card>
  );
}

function StorySection({
  kicker,
  title,
  description,
  children,
}: {
  kicker: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <p className="text-xs font-semibold uppercase text-kova-blue">{kicker}</p>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function SalesByDayChart({ story }: { story: BusinessStoryReport }) {
  const rows: ChartRow[] = story.sales_by_day.map((row) => ({
    id: row.date,
    label: dateLabel(row.date),
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
  const chartRows: ChartRow[] = rows.map((row) => ({
    id: String(row.hour),
    label: `${String(row.hour).padStart(2, "0")}:00`,
    value: Number(row.net_sales),
    valueLabel: formatMoney(row.net_sales),
    meta: [{ label: copy.reportsView.chartOrders, value: String(row.order_count) }],
    accentClassName: "bg-kova-blue",
  }));
  return (
    <InteractiveBarChart
      title={copy.reportsView.hourlyQuestion}
      insight={story.peak_hour ? copy.reportsView.peakHourDetail(story.peak_hour.label) : undefined}
      rows={chartRows}
      emptyLabel={copy.reportsView.noHourlySales}
      ariaLabel={copy.reportsView.hourlySales}
      {...chartCopy()}
    />
  );
}

function SalesDrivers({ story }: { story: BusinessStoryReport }) {
  const top = story.top_product_by_sales;
  const rows: ChartRow[] = story.product_drivers.map((product) => ({
      id: product.product_id,
      label: product.product_name,
      value: Number(product.gross_sales),
      valueLabel: formatMoney(product.gross_sales),
      meta: [
        { label: copy.reportsView.chartUnits, value: String(product.quantity_sold) },
        { label: copy.reportsView.chartShareLabel, value: pctLabel(product.sales_share_pct) },
      ],
      accentClassName: "bg-kova-growth",
  }));

  return (
    <DriverCard icon={Package} title={copy.reportsView.salesDriversTitle}>
      <InteractiveRankChart
        title={copy.reportsView.productsQuestion}
        insight={
          top
            ? copy.reportsView.productDriverInsight(
                top.product_name,
                top.sales_share_pct,
              )
            : undefined
        }
        rows={rows}
        emptyLabel={copy.reportsView.noProducts}
        ariaLabel={copy.reportsView.salesDriversTitle}
        {...chartCopy()}
      />
    </DriverCard>
  );
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
    <DriverCard icon={CreditCard} title={copy.reportsView.paymentBreakdown}>
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
    </DriverCard>
  );
}

function OperationsSignals({ story }: { story: BusinessStoryReport }) {
  const signals = story.operational_signals;
  return (
    <DriverCard icon={RotateCcw} title={copy.reportsView.operationsTitle}>
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
    </DriverCard>
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
  return (
    <DriverCard icon={Users} title={copy.reportsView.employeePerformance}>
      <InteractiveBarChart
        title={copy.reportsView.employeeQuestion}
        insight={
          rows.length > 1 && topEmployee
            ? copy.reportsView.employeeStoryInsight(topEmployee.display_name)
            : rows.length === 1
              ? copy.reportsView.employeeSingleInsight(rows[0].display_name)
              : undefined
        }
        rows={chartRows}
        emptyLabel={copy.reportsView.noEmployeeSales}
        ariaLabel={copy.reportsView.employeePerformance}
        {...chartCopy()}
      />
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

function RecommendedActions({ story }: { story: BusinessStoryReport }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-muted-foreground" />
          <CardTitle>{copy.reportsView.actionTitle}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2">
          {story.recommended_actions.map((action) => (
            <InsightCard key={`${action.title}-${action.detail}`} type={action.type}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{copy.reportsView.actionType(action.type)}</Badge>
                <p className="font-semibold">{action.title}</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{action.detail}</p>
            </InsightCard>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function InsightCard({
  type,
  children,
}: {
  type: "opportunity" | "risk" | "good_signal" | "operational_improvement";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        type === "risk"
          ? "border-destructive/30 bg-destructive/5"
          : type === "good_signal"
            ? "border-kova-growth/30 bg-kova-growth/5"
            : "border-kova-blue/20 bg-kova-blue/5",
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

function dailyInsight(story: BusinessStoryReport): string {
  const best = bestDayRow(story);
  if (!best) return copy.reportsView.dailyInsightEmpty;
  if (story.sales_by_day.length < 2) {
    return copy.reportsView.dailyInsightSingle(dateLabel(best.date), formatMoney(best.net_sales));
  }
  return copy.reportsView.dailyInsightBest(dateLabel(best.date), best.sales_share_pct);
}

function daypartInsight(story: BusinessStoryReport): string {
  const best = bestDaypartRow(story);
  if (!best) return copy.reportsView.daypartInsightEmpty;
  return copy.reportsView.daypartInsightBest(
    best.label,
    formatMoney(best.net_sales),
    best.order_count,
    best.sales_share_pct,
  );
}

function peakHourInsight(story: BusinessStoryReport): string {
  if (!story.peak_hour) return copy.reportsView.peakHourEmpty;
  return copy.reportsView.peakHourStory(story.peak_hour.label);
}
