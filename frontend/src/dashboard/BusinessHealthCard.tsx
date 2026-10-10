import { Card, CardContent } from "@/components/ui/card";
import { copy } from "@/i18n/messages";
import type { PaymentBreakdown, SalesSummary } from "@/reports/types";
import {
  Activity,
  TrendingUp,
  RotateCcw,
  CreditCard,
  Package,
  ChevronDown,
} from "lucide-react";

type Props = {
  summary: SalesSummary;
  yesterday: SalesSummary | null;
  payments: PaymentBreakdown;
  lowStockCount: number;
  compareLabel: string;
};

type Band = "healthy" | "watch" | "critical" | "setup";

type Factor = {
  key: "sales" | "refunds" | "inventory" | "payments";
  label: string;
  status: "up" | "down" | "flat" | "ok" | "warn" | "none";
  detail: string;
  takeaway: string; // self-contained one-line story for the summary
  score: number; // 0..1
  weight: number;
  icon: typeof Activity;
};

function pctRound(pct: number): number {
  const abs = Math.abs(pct);
  return abs < 1 ? 1 : Math.round(abs);
}

function plainFactorSummary(factors: Factor[]): string {
  // Lead with the most important risk; otherwise a win; otherwise neutral.
  const risk = factors.find((f) => f.status === "down" || f.status === "warn");
  if (risk) return risk.takeaway;
  const win = factors.find((f) => f.status === "up" || f.status === "ok");
  if (win) return win.takeaway;
  return factors[0]?.takeaway ?? copy.dashboard.healthSubtitleWatch;
}

export function BusinessHealthCard({
  summary,
  yesterday,
  payments,
  lowStockCount,
  compareLabel,
}: Props) {
  const factors: Factor[] = [];

  // 1) Sales trend (weight 0.40)
  const net = Number(summary.net_sales);
  const yNet = yesterday ? Number(yesterday.net_sales) : null;
  // Only compare when the CURRENT period also has sales — otherwise a zero
  // period would show a misleading "-100%" (the KPI cards already suppress it).
  if (yNet != null && yNet > 0 && summary.order_count > 0) {
    const pct = ((net - yNet) / yNet) * 100;
    // map -50%..+50% to 0..1, clamp
    const score = Math.max(0, Math.min(1, 0.5 + pct / 100));
    factors.push({
      key: "sales",
      label: copy.dashboard.healthFactorSales,
      status: pct > 1 ? "up" : pct < -1 ? "down" : "flat",
      detail:
        pct > 1
          ? copy.dashboard.healthFactorSalesUp(pctRound(pct), compareLabel)
          : pct < -1
            ? copy.dashboard.healthFactorSalesDown(pctRound(pct), compareLabel)
            : copy.dashboard.healthFactorSalesFlat(compareLabel),
      takeaway:
        pct > 1
          ? copy.dashboard.healthSummarySalesUp(pctRound(pct), compareLabel)
          : pct < -1
            ? copy.dashboard.healthSummarySalesDown(pctRound(pct), compareLabel)
            : copy.dashboard.healthSummarySalesFlat(compareLabel),
      score,
      weight: 0.4,
      icon: TrendingUp,
    });
  } else if (summary.order_count > 0) {
    factors.push({
      key: "sales",
      label: copy.dashboard.healthFactorSales,
      status: "none",
      detail: copy.dashboard.healthFactorSalesNoData,
      takeaway: copy.dashboard.healthSummarySalesNoData,
      score: 0.6,
      weight: 0.4,
      icon: TrendingUp,
    });
  }

  // 2) Refund-event frequency (weight 0.25). Multiple partial refunds can
  // belong to one order; this is events per order, never a share of orders.
  // Zero events → 1.0, ≥0.1 events per order → 0.
  if (summary.order_count > 0) {
    const rate = summary.refund_count / summary.order_count;
    const score = Math.max(0, 1 - rate * 10);
    factors.push({
      key: "refunds",
      label: copy.dashboard.healthFactorRefunds,
      status: rate === 0 ? "ok" : rate > 0.05 ? "warn" : "flat",
      detail:
        summary.refund_count === 0
          ? copy.dashboard.healthFactorRefundsClean
          : copy.dashboard.healthFactorRefundsRate(Math.round(rate * 100)),
      takeaway:
        summary.refund_count === 0
          ? copy.dashboard.healthSummaryRefundsClean
          : copy.dashboard.healthSummaryRefundsRate(Math.round(rate * 100)),
      score,
      weight: 0.25,
      icon: RotateCcw,
    });
  }

  // 3) Inventory (weight 0.15). 0 low → 1, ≥5 low → 0
  factors.push({
    key: "inventory",
    label: copy.dashboard.healthFactorInventory,
    status: lowStockCount === 0 ? "ok" : lowStockCount >= 3 ? "warn" : "flat",
    detail:
      lowStockCount === 0
        ? copy.dashboard.healthFactorInventoryOk
        : copy.dashboard.healthFactorInventoryLow(lowStockCount),
    takeaway:
      lowStockCount === 0
        ? copy.dashboard.healthSummaryInventoryOk
        : copy.dashboard.healthSummaryInventoryLow(lowStockCount),
    score: Math.max(0, 1 - lowStockCount / 5),
    weight: 0.15,
    icon: Package,
  });

  // 4) Payment adoption (weight 0.20). %non-cash → 0..1
  const totalPay = payments.payments.reduce((s, p) => s + Number(p.amount), 0);
  if (totalPay > 0) {
    const cash = payments.payments.find((p) => p.method === "cash");
    const cashAmt = cash ? Number(cash.amount) : 0;
    const nonCashPct = ((totalPay - cashAmt) / totalPay) * 100;
    factors.push({
      key: "payments",
      label: copy.dashboard.healthFactorPayments,
      status: nonCashPct >= 30 ? "ok" : nonCashPct === 0 ? "warn" : "flat",
      detail:
        nonCashPct === 0
          ? copy.dashboard.healthFactorPaymentsCashOnly
          : copy.dashboard.healthFactorPaymentsMix(Math.round(nonCashPct)),
      takeaway:
        nonCashPct === 0
          ? copy.dashboard.healthSummaryPaymentsCashOnly
          : copy.dashboard.healthSummaryPaymentsMix(Math.round(nonCashPct)),
      score: Math.min(1, nonCashPct / 50),
      weight: 0.2,
      icon: CreditCard,
    });
  } else {
    factors.push({
      key: "payments",
      label: copy.dashboard.healthFactorPayments,
      status: "none",
      detail: copy.dashboard.healthFactorPaymentsNoData,
      takeaway: copy.dashboard.healthSummaryPaymentsNoData,
      score: 0.5,
      weight: 0.2,
      icon: CreditCard,
    });
  }

  // If no factors carry signal (no orders, no comparison), show empty subtitle but still render
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  const weighted =
    totalWeight > 0
      ? factors.reduce((s, f) => s + f.score * f.weight, 0) / totalWeight
      : 0;
  const score = Math.round(weighted * 100);

  const isEmptyBusinessDay = summary.order_count === 0 && totalPay === 0;
  // Only escalate to "critical" with a real sales comparison; with thin data
  // (no comparable period) cap at "watch" so we don't alarm without signal.
  const hasSalesComparison = yNet != null && yNet > 0 && summary.order_count > 0;
  const band: Band = isEmptyBusinessDay
    ? "setup"
    : score >= 75
      ? "healthy"
      : score >= 50
        ? "watch"
        : hasSalesComparison
          ? "critical"
          : "watch";
  const subtitle =
    isEmptyBusinessDay
      ? copy.dashboard.healthSubtitleEmpty
      : band === "healthy"
        ? copy.dashboard.healthSubtitleHealthy
        : band === "watch"
          ? copy.dashboard.healthSubtitleWatch
          : copy.dashboard.healthSubtitleCritical;

  const ringClass =
    band === "healthy"
      ? "text-kova-growth"
      : band === "watch"
        ? "text-warning-foreground"
        : band === "setup"
          ? "text-kova-blue"
        : "text-destructive";
  const ringBg =
    band === "healthy"
      ? "bg-kova-growth/10"
      : band === "watch"
        ? "bg-warning/10"
        : band === "setup"
          ? "bg-kova-blue/10"
        : "bg-destructive/10";
  const barColor =
    band === "healthy"
      ? "bg-kova-growth"
      : band === "watch"
        ? "bg-warning"
        : band === "setup"
          ? "bg-kova-blue"
        : "bg-destructive";
  const bandLabel =
    band === "healthy"
      ? copy.dashboard.healthBandHealthy
      : band === "watch"
        ? copy.dashboard.healthBandWatch
        : band === "setup"
          ? copy.dashboard.healthBandSetup
        : copy.dashboard.healthBandCritical;

  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-kova-blue" />
            <p className="text-sm font-semibold text-kova-ink">{copy.dashboard.healthTitle}</p>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ringBg} ${ringClass}`}>
            {bandLabel}
          </span>
        </div>

        <div className="mt-3">
          <div className="flex items-baseline gap-1.5">
            <span className={`text-3xl font-bold tabular-nums ${ringClass}`}>
              {isEmptyBusinessDay ? "—" : score}
            </span>
            <span className="text-sm font-medium text-kova-tertiary">/ 100</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-kova-mist">
            <div
              className={`h-full rounded-full ${barColor} transition-[width] duration-500 ease-standard`}
              style={{ width: `${isEmptyBusinessDay ? 0 : score}%` }}
            />
          </div>
        </div>

        {!isEmptyBusinessDay && (
          <p className="mt-3 text-base font-semibold leading-6 text-kova-ink">
            {plainFactorSummary(factors)}
          </p>
        )}
        <p className="mt-1 text-sm text-kova-muted">{subtitle}</p>

        <div className="mt-4 space-y-0.5">
          {factors.map((f) => {
            const Icon = f.icon;
            const tone =
              f.status === "up" || f.status === "ok"
                ? "text-kova-growth"
                : f.status === "down" || f.status === "warn"
                  ? "text-destructive"
                  : "text-kova-muted";
            return (
              <div
                key={f.key}
                className="flex items-center justify-between gap-3 border-b border-kova-border/60 py-2 last:border-0"
              >
                <span className="flex min-w-0 items-center gap-2 text-sm text-kova-muted">
                  <Icon className="h-4 w-4 shrink-0 text-kova-tertiary" />
                  <span className="truncate">{f.label}</span>
                </span>
                <span className={`max-w-[65%] shrink-0 text-right text-sm font-semibold tabular-nums ${tone}`}>
                  {f.detail}
                </span>
              </div>
            );
          })}
        </div>

        {!isEmptyBusinessDay && (
          <details className="group mt-3">
            <summary className="flex cursor-pointer items-center gap-1 text-xs font-medium text-kova-muted hover:text-kova-ink [&::-webkit-details-marker]:hidden">
              {copy.dashboard.healthHowSummary}
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-2 space-y-1.5 text-xs leading-relaxed text-kova-muted">
              <p>{copy.dashboard.healthHowIntro}</p>
              <ul className="space-y-1">
                {[
                  { text: copy.dashboard.healthHowSales, weight: 40 },
                  { text: copy.dashboard.healthHowRefunds, weight: 25 },
                  { text: copy.dashboard.healthHowPayments, weight: 20 },
                  { text: copy.dashboard.healthHowInventory, weight: 15 },
                ].map((row) => (
                  <li key={row.weight} className="flex items-start justify-between gap-3">
                    <span className="min-w-0">{row.text}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-kova-tertiary">
                      {copy.dashboard.healthHowWeight(row.weight)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
