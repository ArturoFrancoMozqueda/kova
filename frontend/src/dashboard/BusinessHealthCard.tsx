import { Card, CardContent } from "@/components/ui/card";
import { copy } from "@/i18n/messages";
import type { PaymentBreakdown, SalesSummary } from "@/reports/types";
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  CreditCard,
  Package,
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

  // 2) Refund rate (weight 0.25). 0% → 1.0, ≥10% → 0
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
        ? "text-warning"
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

  return (
    <Card className="h-full">
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          <div
            className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full ${ringBg}`}
            aria-hidden="true"
          >
            <span className={`text-xl font-bold tabular-nums ${ringClass}`}>
              {isEmptyBusinessDay ? "—" : score}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Activity className="h-4 w-4 text-kova-blue" />
              <p className="text-sm font-semibold text-kova-ink">
                {copy.dashboard.healthTitle}
              </p>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ringBg} ${ringClass}`}
              >
                {band === "healthy"
                  ? copy.dashboard.healthBandHealthy
                  : band === "watch"
                    ? copy.dashboard.healthBandWatch
                    : band === "setup"
                      ? copy.dashboard.healthBandSetup
                    : copy.dashboard.healthBandCritical}
              </span>
            </div>
            {!isEmptyBusinessDay && (
              <p className="mt-2 text-base font-semibold leading-6 text-kova-ink">
                {plainFactorSummary(factors)}
              </p>
            )}
            <p className="text-sm text-kova-muted mt-1">{subtitle}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {factors.map((f) => {
            const Icon = f.icon;
            const tone =
              f.status === "up" || f.status === "ok"
                ? "text-kova-growth"
                : f.status === "down" || f.status === "warn"
                  ? "text-destructive"
                  : "text-kova-muted";
            const StatusIcon =
              f.status === "up"
                ? TrendingUp
                : f.status === "down"
                  ? TrendingDown
                  : f.status === "ok"
                    ? CheckCircle2
                    : f.status === "warn"
                      ? AlertTriangle
                      : Minus;
            return (
              <div
                key={f.key}
                className="flex items-center gap-2 rounded-md border border-kova-border p-2.5"
              >
                <Icon className="h-4 w-4 text-kova-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-kova-tertiary">
                    {f.label}
                  </p>
                  <p className="text-sm text-kova-ink truncate">{f.detail}</p>
                </div>
                <StatusIcon className={`h-4 w-4 shrink-0 ${tone}`} />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
