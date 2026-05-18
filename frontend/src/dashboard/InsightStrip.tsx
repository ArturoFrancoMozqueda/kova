import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { copy } from "@/i18n/messages";
import type { SalesSummary, PaymentBreakdown, TopProducts } from "@/reports/types";
import type { StockItem } from "@/inventory/types";
import {
  Sparkles,
  AlertCircle,
  Receipt,
  ShoppingCart,
  TrendingUp,
  Package,
  ArrowRight,
} from "lucide-react";

type Props = {
  summary: SalesSummary;
  yesterday: SalesSummary | null;
  payments: PaymentBreakdown;
  topProducts: TopProducts;
  lowStock: StockItem[];
};

type ActionCard = {
  key: string;
  title: string;
  desc: string;
  cta: string;
  to: string;
  tone: "warn" | "info" | "primary";
  icon: typeof AlertCircle;
};

function paymentLabel(method: string): string {
  return method.replace("_", " ");
}

function pctRound(pct: number): number {
  const abs = Math.abs(pct);
  return abs < 1 ? 1 : Math.round(abs);
}

export function InsightStrip({ summary, yesterday, payments, topProducts, lowStock }: Props) {
  const orderCount = summary.order_count;
  const netSales = Number(summary.net_sales);
  const yNet = yesterday ? Number(yesterday.net_sales) : null;
  const yOrders = yesterday?.order_count ?? null;

  // Headline
  let headline: string;
  if (orderCount === 0) {
    headline = copy.dashboard.storyHeadlineEmpty;
  } else if (yNet === null || yNet === 0) {
    headline = copy.dashboard.storyHeadlineNoYesterday;
  } else {
    const pct = ((netSales - yNet) / yNet) * 100;
    if (pct > 1) headline = copy.dashboard.storyHeadlineUp(pctRound(pct));
    else if (pct < -1) headline = copy.dashboard.storyHeadlineDown(pctRound(pct));
    else headline = copy.dashboard.storyHeadlineFlat;
  }

  // Supporting bullets
  const bullets: string[] = [];

  const top = topProducts.products[0];
  if (top && top.quantity_sold > 0) {
    bullets.push(copy.dashboard.storyTopProduct(top.product_name, top.quantity_sold));
  }

  if (orderCount > 0 && yOrders && yOrders > 0 && yNet && yNet > 0) {
    const avg = netSales / orderCount;
    const yAvg = yNet / yOrders;
    if (yAvg > 0) {
      const pct = ((avg - yAvg) / yAvg) * 100;
      if (pct > 3) bullets.push(copy.dashboard.storyTicketUp(pctRound(pct)));
      else if (pct < -3) bullets.push(copy.dashboard.storyTicketDown(pctRound(pct)));
    }
  }

  if (payments.payments.length > 0) {
    const total = payments.payments.reduce((s, p) => s + Number(p.amount), 0);
    if (total > 0) {
      const dominant = [...payments.payments].sort(
        (a, b) => Number(b.amount) - Number(a.amount),
      )[0];
      const pct = Math.round((Number(dominant.amount) / total) * 100);
      if (pct >= 60) {
        bullets.push(copy.dashboard.storyPaymentDominant(paymentLabel(dominant.method), pct));
      }
    }
  }

  if (summary.refund_count > 0) {
    bullets.push(copy.dashboard.storyRefundsFlag(summary.refund_count));
  }

  if (lowStock.length === 1) {
    bullets.push(copy.dashboard.storyLowStockOne(lowStock[0].product_name));
  } else if (lowStock.length > 1) {
    bullets.push(copy.dashboard.storyLowStockMany(lowStock.length));
  }

  // Recommended actions (rule-based, prioritized)
  const actions: ActionCard[] = [];

  if (lowStock.length > 0) {
    const names = lowStock
      .slice(0, 3)
      .map((s) => s.product_name)
      .join(", ");
    actions.push({
      key: "restock",
      title: copy.dashboard.actionRestockTitle,
      desc: copy.dashboard.actionRestockDesc(names),
      cta: copy.dashboard.actionRestockCta,
      to: "/inventory",
      tone: "warn",
      icon: Package,
    });
  }

  if (summary.refund_count > 0) {
    actions.push({
      key: "refunds",
      title: copy.dashboard.actionReviewRefundsTitle,
      desc: copy.dashboard.actionReviewRefundsDesc(summary.refund_count),
      cta: copy.dashboard.actionReviewRefundsCta,
      to: "/reports",
      tone: "info",
      icon: Receipt,
    });
  }

  if (orderCount === 0) {
    actions.push({
      key: "start",
      title: copy.dashboard.actionStartSellingTitle,
      desc: copy.dashboard.actionStartSellingDesc,
      cta: copy.dashboard.actionStartSellingCta,
      to: "/register",
      tone: "primary",
      icon: ShoppingCart,
    });
  }

  if (
    actions.length < 3 &&
    orderCount > 0 &&
    top &&
    top.quantity_sold >= 3 &&
    yNet !== null &&
    yNet > 0 &&
    netSales > yNet
  ) {
    actions.push({
      key: "promote",
      title: copy.dashboard.actionPromoteTopTitle,
      desc: copy.dashboard.actionPromoteTopDesc(top.product_name),
      cta: copy.dashboard.actionPromoteTopCta,
      to: "/catalog",
      tone: "info",
      icon: TrendingUp,
    });
  }

  // TODO(backend): richer "why" insights need: hourly sales (best hour, peak window),
  // per-employee sales, refund reasons, stock velocity (days-until-out).
  // Current narrative uses today vs yesterday + top product + payment mix + low-stock
  // — all real data from existing endpoints.

  return (
    <div className="space-y-4">
      <Card className="bg-gradient-to-br from-kova-mist/50 to-white border-kova-blue/15">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-kova-blue" />
            {copy.dashboard.storyTitle}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-lg font-semibold tracking-tight text-kova-ink leading-snug">
            {headline}
          </p>
          {bullets.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-kova-muted">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-kova-blue/60" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {actions.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{copy.dashboard.nextActionsTitle}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {actions.slice(0, 3).map((a) => {
                const Icon = a.icon;
                const toneClass =
                  a.tone === "warn"
                    ? "border-warning/40 bg-warning/5 hover:bg-warning/10"
                    : a.tone === "primary"
                      ? "border-kova-blue/40 bg-kova-blue/5 hover:bg-kova-blue/10"
                      : "border-kova-border hover:bg-kova-mist/40";
                const iconClass =
                  a.tone === "warn"
                    ? "bg-warning/15 text-warning-foreground"
                    : a.tone === "primary"
                      ? "bg-kova-blue/15 text-kova-blue"
                      : "bg-kova-mist text-kova-ink";
                return (
                  <Link
                    key={a.key}
                    to={a.to}
                    className={`group flex flex-col gap-2 rounded-lg border p-3 transition-colors ${toneClass}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-md ${iconClass}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <p className="text-sm font-semibold text-kova-ink">{a.title}</p>
                    </div>
                    <p className="text-xs text-kova-muted leading-relaxed">{a.desc}</p>
                    <span className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-kova-blue">
                      {a.cta}
                      <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
