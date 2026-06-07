import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { copy } from "@/i18n/messages";
import type { SalesByHourRow, SalesSummary, TopProducts } from "@/reports/types";
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
  hourly: SalesByHourRow[];
  topProducts: TopProducts;
  lowStock: StockItem[];
  compareLabel: string;
  suppressLowStock?: boolean;
  show?: "all" | "banner" | "actions";
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

export function InsightStrip({
  summary,
  yesterday,
  hourly,
  topProducts,
  lowStock,
  compareLabel,
  suppressLowStock = false,
  show = "all",
}: Props) {
  const orderCount = summary.order_count;
  const netSales = Number(summary.net_sales);
  const yNet = yesterday ? Number(yesterday.net_sales) : null;
  const top = topProducts.products[0];
  const [bestHour] = topHoursByNetSales(hourly, 1);
  const bestHourLabel = bestHour ? formatHourRange(bestHour.hour) : "";

  // Sales vs previous period — only meaningful when the current period has sales.
  let salesPct: number | null = null;
  if (orderCount > 0 && yNet !== null && yNet > 0) {
    salesPct = ((netSales - yNet) / yNet) * 100;
  }

  // One concise, prioritized story line (real data only): lead with the most
  // useful signal, add at most one supporting/implication clause.
  let story: string;
  if (orderCount === 0) {
    story = copy.dashboard.storyBannerEmpty;
  } else if (salesPct !== null && salesPct > 5) {
    story = bestHour
      ? copy.dashboard.storyBannerSalesUpHour(pctRound(salesPct), compareLabel, bestHourLabel)
      : copy.dashboard.storyBannerSalesUp(pctRound(salesPct), compareLabel);
  } else if (top && top.quantity_sold > 0) {
    const isLow = lowStock.some((s) => s.product_id === top.product_id);
    story = isLow
      ? copy.dashboard.storyBannerStarLow(top.product_name)
      : bestHour
        ? copy.dashboard.storyBannerStarHour(top.product_name, top.quantity_sold, bestHourLabel)
        : copy.dashboard.storyBannerStar(top.product_name, top.quantity_sold);
  } else if (salesPct !== null && salesPct < -5) {
    story = copy.dashboard.storyBannerSalesDown(pctRound(salesPct), compareLabel);
  } else if (bestHour) {
    story = copy.dashboard.storyBannerHour(bestHourLabel);
  } else {
    story = copy.dashboard.storyHeadlineNoYesterday;
  }

  const emphasisTokens = [top?.product_name ?? "", bestHourLabel];

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
  // Current narrative uses period comparison + top product + payment mix + low-stock
  // — all real data from existing endpoints.

  const showBanner = show !== "actions";
  const showActions = show !== "banner" && actions.length > 0;
  if (!showBanner && !showActions) return null;

  return (
    <div className="space-y-4">
      {showBanner && (
      <Card className="bg-gradient-to-br from-kova-mist/50 to-white border-kova-blue/15">
        <CardContent className="flex items-start gap-2.5 p-4">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-kova-blue" />
          <p className="text-sm leading-relaxed text-kova-ink">
            {emphasize(story, emphasisTokens)}
          </p>
        </CardContent>
      </Card>
      )}

      {showActions && (
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
