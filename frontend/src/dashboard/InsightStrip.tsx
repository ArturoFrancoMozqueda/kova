import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { copy } from "@/i18n/messages";
import type { SalesByHourRow, SalesSummary, PaymentBreakdown, TopProducts } from "@/reports/types";
import { formatHourRange, topHoursByNetSales } from "@/reports/hours";
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
  hourly: SalesByHourRow[];
  topProducts: TopProducts;
  lowStock: StockItem[];
  suppressLowStock?: boolean;
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

/**
 * Render `text` with the given data tokens (product name, hour range) and any
 * percentage figure highlighted in blue, leaving the surrounding prose plain.
 */
function emphasize(text: string, tokens: string[]): ReactNode[] {
  const escaped = tokens
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const patterns = [...escaped, "\\d+%"];
  const splitter = new RegExp(`(${patterns.join("|")})`, "g");
  const isMatch = new RegExp(`^(?:${patterns.join("|")})$`);
  return text
    .split(splitter)
    .filter(Boolean)
    .map((part, i) =>
      isMatch.test(part) ? (
        <span key={i} className="font-semibold text-kova-blue">
          {part}
        </span>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
}

export function InsightStrip({ summary, yesterday, payments, hourly, topProducts, lowStock, suppressLowStock = false }: Props) {
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

  const [bestHour] = topHoursByNetSales(hourly, 1);
  if (bestHour) {
    bullets.push(copy.dashboard.storyBestHour(formatHourRange(bestHour.hour)));
  }

  if (summary.refund_count > 0) {
    bullets.push(copy.dashboard.storyRefundsFlag(summary.refund_count));
  }

  if (!suppressLowStock && lowStock.length === 1) {
    bullets.push(copy.dashboard.storyLowStockOne(lowStock[0].product_name));
  } else if (!suppressLowStock && lowStock.length > 1) {
    bullets.push(copy.dashboard.storyLowStockMany(lowStock.length));
  }

  // Recommended actions (rule-based, prioritized)
  const actions: ActionCard[] = [];

  if (!suppressLowStock && lowStock.length > 0) {
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

  // TODO(backend): richer "why" insights still need per-employee sales in dashboard,
  // refund reasons, and stock velocity (days-until-out).
  // Current narrative uses today vs yesterday + top product + payment mix + low-stock
  // — all real data from existing endpoints.

  // One condensed line: headline + the single highest-priority signal. The
  // data tokens (top product, peak hour) are highlighted; the rest stays plain.
  const story = [headline, bullets[0]].filter(Boolean).join(" ");
  const emphasisTokens = [
    top && top.quantity_sold > 0 ? top.product_name : "",
    bestHour ? formatHourRange(bestHour.hour) : "",
  ];

  return (
    <div className="space-y-4">
      <Card className="bg-gradient-to-br from-kova-mist/50 to-white border-kova-blue/15">
        <CardContent className="flex items-start gap-2.5 p-4">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-kova-blue" />
          <p className="text-sm leading-relaxed text-kova-ink">
            {emphasize(story, emphasisTokens)}
          </p>
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
