import { CreditCard } from "lucide-react";

import { copy } from "@/i18n/messages";
import { formatMoney, reasonLabel } from "@/orders/format";
import { RankBarChart } from "../charts/RankBarChart";
import type { ChartRow } from "../charts/types";
import type { BusinessStoryReport } from "../types";
import { ReportSection } from "./ReportSection";

function contextLine(story: BusinessStoryReport, previousStory: BusinessStoryReport | null): string {
  const mix = story.payment_mix;
  const totalPayments = mix.reduce((sum, row) => sum + row.payment_count, 0);
  const cash = mix.find((row) => row.method === "cash");
  if (cash && cash.sales_share_pct >= 70 && totalPayments >= 10) {
    return copy.reportsView.paymentContextCash(cash.sales_share_pct);
  }
  const cardlike = mix
    .filter((row) => row.method === "card" || row.method === "transfer")
    .reduce((sum, row) => sum + row.sales_share_pct, 0);
  if (cardlike >= 80) {
    return copy.reportsView.paymentContextCardHeavy(cardlike);
  }
  const previousMethods = new Set((previousStory?.payment_mix ?? []).map((row) => row.method));
  const currentMethods = new Set(mix.map((row) => row.method));
  if (previousStory) {
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
  const rows: ChartRow[] = story.payment_mix.map((row) => ({
    id: row.method,
    label: reasonLabel(row.method),
    value: Number(row.amount),
    valueLabel: formatMoney(row.amount),
    meta: [
      { label: copy.reportsView.chartShareLabel, value: `${row.sales_share_pct}%` },
      { label: copy.reportsView.chartPayments, value: copy.reportsView.paymentTransactions(row.payment_count) },
    ],
  }));

  return (
    <ReportSection
      icon={<CreditCard className="h-5 w-5 text-muted-foreground" />}
      title={copy.reportsView.paymentOperationsTitle}
      description={copy.reportsView.paymentOperationsDescription}
    >
      <RankBarChart
        title={copy.reportsView.paymentBreakdown}
        subtitle={copy.reportsView.paymentChartSubtitle}
        rows={rows}
        emptyLabel={copy.reportsView.noPayments}
        valueFormatter={(value) => formatMoney(value)}
      />
      {rows.length > 0 ? (
        <p className="mt-3 rounded-kova-md border border-kova-border bg-kova-mist/40 p-3 text-sm leading-6 text-kova-ink">
          {contextLine(story, previousStory)}
        </p>
      ) : null}
      <p className="mt-2 text-xs text-muted-foreground">{copy.reportsView.grossVsNetNote}</p>
    </ReportSection>
  );
}
