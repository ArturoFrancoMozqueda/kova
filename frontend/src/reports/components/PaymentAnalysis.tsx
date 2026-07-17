import { CreditCard } from "lucide-react";

import { copy } from "@/i18n/messages";
import { formatMoney, reasonLabel } from "@/orders/format";
import { DistributionBar, type DistributionSegment } from "../charts/DistributionBar";
import type { BusinessStoryReport } from "../types";
import { InfoDisclosure } from "./InfoDisclosure";
import { BentoPanel } from "./ReportSection";

function contextLine(story: BusinessStoryReport, previousStory: BusinessStoryReport | null): string {
  const mix = story.payment_mix;
  const totalPayments = mix.reduce((sum, row) => sum + row.payment_count, 0);
  const cash = mix.find((row) => row.method === "cash");
  if (cash && cash.sales_share_pct >= 70 && totalPayments >= 10) {
    return copy.reportsView.paymentContextCash(cash.sales_share_pct);
  }
  // Backend payment keys are cash | bank_transfer | manual_card. "Card-heavy"
  // means the non-cash rails (transfer + manual card) dominate the mix.
  const cardlike = mix
    .filter((row) => row.method === "manual_card" || row.method === "bank_transfer")
    .reduce((sum, row) => sum + row.sales_share_pct, 0);
  if (cardlike >= 80) {
    return copy.reportsView.paymentContextCardHeavy(cardlike);
  }
  const previousMethods = new Set((previousStory?.payment_mix ?? []).map((row) => row.method));
  const currentMethods = new Set(mix.map((row) => row.method));
  // Only flag new/lost methods against a previous period that actually had
  // sales — with a young history everything is "new" and the note is noise.
  if (previousStory && previousStory.summary.completed_orders > 0) {
    const newMethod = mix.find((row) => !previousMethods.has(row.method));
    if (newMethod) return copy.reportsView.paymentInsightNewMethod(reasonLabel(newMethod.method));
    const lost = [...previousMethods].find((method) => !currentMethods.has(method));
    if (lost) return copy.reportsView.paymentInsightLostMethod(reasonLabel(lost));
  }
  return copy.reportsView.paymentInsightBalanced;
}

export function PaymentAnalysis({
  story,
  previousStory,
}: {
  story: BusinessStoryReport;
  previousStory: BusinessStoryReport | null;
}) {
  const segments: DistributionSegment[] = story.payment_mix.map((row) => ({
    id: row.method,
    label: reasonLabel(row.method),
    value: Number(row.amount),
    valueLabel: formatMoney(row.amount),
    sharePct: row.sales_share_pct,
    meta: copy.reportsView.paymentTransactions(row.payment_count),
  }));
  const srSummary =
    segments.length > 0
      ? segments.map((segment) => `${segment.label}: ${segment.sharePct}%`).join(", ") + "."
      : undefined;
  const dominant = story.dominant_payment;
  const highlight = dominant
    ? copy.reportsView.highlightPayment(
        reasonLabel(dominant.method),
        dominant.sales_share_pct,
        formatMoney(dominant.amount),
      )
    : null;

  return (
    <BentoPanel
      icon={<CreditCard className="h-5 w-5 text-muted-foreground" />}
      title={copy.reportsView.paymentOperationsTitle}
      highlight={highlight}
    >
      {/* Composition, not ranking: one 100% bar shows how the whole cobro
          splits by method; the legend carries each number exactly once. */}
      <DistributionBar
        segments={segments}
        emptyLabel={copy.reportsView.noPayments}
        srSummary={srSummary}
      />
      {segments.length > 0 ? (
        <p className="mt-3 text-sm leading-6 text-kova-muted">
          {contextLine(story, previousStory)}
        </p>
      ) : null}
      <InfoDisclosure>{copy.reportsView.grossVsNetNote}</InfoDisclosure>
    </BentoPanel>
  );
}
