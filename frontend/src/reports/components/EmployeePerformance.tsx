import { Info, Users } from "lucide-react";

import { copy } from "@/i18n/messages";
import { formatMoney } from "@/orders/format";
import { RankBarChart } from "../charts/RankBarChart";
import type { ChartRow } from "../charts/types";
import type { BusinessStoryReport, SalesByEmployeeRow } from "../types";
import { displayPersonName } from "../utils/format";
import { ReportSection } from "./ReportSection";

function averageTicket(row: SalesByEmployeeRow): string {
  const net = Number(row.net_sales);
  return formatMoney(row.order_count > 0 ? net / row.order_count : 0);
}

function Caveat() {
  return (
    <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {copy.reportsView.teamCaveat}
    </p>
  );
}

export function EmployeePerformance({ story }: { story: BusinessStoryReport }) {
  const rows = story.sales_by_employee;
  const contribution = story.employee_contribution;

  if (rows.length === 0) {
    return (
      <ReportSection
        icon={<Users className="h-5 w-5 text-muted-foreground" />}
        title={copy.reportsView.employeePerformance}
        description={copy.reportsView.teamAnalysisDescription}
      >
        <p className="rounded-kova-md border border-dashed bg-muted/30 p-5 text-sm text-muted-foreground">
          {copy.reportsView.noEmployeeSales}
        </p>
      </ReportSection>
    );
  }

  if (rows.length === 1) {
    const only = rows[0];
    return (
      <ReportSection
        icon={<Users className="h-5 w-5 text-muted-foreground" />}
        title={copy.reportsView.employeePerformance}
        description={copy.reportsView.teamAnalysisDescription}
      >
        <p className="rounded-kova-md border border-dashed bg-muted/30 p-5 text-sm leading-6 tabular-nums text-muted-foreground">
          {copy.reportsView.teamSingle(
            displayPersonName(only.display_name),
            only.order_count,
            formatMoney(only.net_sales),
            averageTicket(only),
          )}
        </p>
      </ReportSection>
    );
  }

  const totalNet = rows.reduce((sum, row) => sum + Number(row.net_sales), 0);
  const ranked = [...rows].sort((a, b) => Number(b.net_sales) - Number(a.net_sales));
  const shareOf = (row: SalesByEmployeeRow) =>
    totalNet > 0 ? Math.round((Number(row.net_sales) / totalNet) * 100) : 0;

  // With exactly two people a sentence beats a two-bar chart: it names both
  // contributions directly and keeps the section compact.
  if (ranked.length === 2) {
    const [first, second] = ranked;
    return (
      <ReportSection
        icon={<Users className="h-5 w-5 text-muted-foreground" />}
        title={copy.reportsView.employeePerformance}
        description={copy.reportsView.teamAnalysisDescription}
      >
        <p className="rounded-kova-md border border-kova-border bg-kova-mist/40 p-4 text-sm leading-6 tabular-nums text-kova-ink">
          {copy.reportsView.teamPair(
            displayPersonName(first.display_name),
            formatMoney(first.net_sales),
            shareOf(first),
            displayPersonName(second.display_name),
            formatMoney(second.net_sales),
            shareOf(second),
          )}
        </p>
        <Caveat />
      </ReportSection>
    );
  }

  const chartRows: ChartRow[] = ranked.map((row) => ({
    id: row.user_id ?? row.display_name,
    label: displayPersonName(row.display_name),
    value: Number(row.net_sales),
    valueLabel: formatMoney(row.net_sales),
    meta: [
      { label: copy.reportsView.chartOrders, value: String(row.order_count) },
      { label: copy.reportsView.chartShareLabel, value: `${shareOf(row)}%` },
      { label: copy.reportsView.avgTicket, value: averageTicket(row) },
      { label: copy.reportsView.chartRefunds, value: String(row.refund_count) },
    ],
  }));

  const insight = contribution?.even_distribution
    ? copy.reportsView.teamEven
    : contribution?.top
      ? copy.reportsView.employeeContributionTop(
          displayPersonName(contribution.top.display_name),
          contribution.top.sales_share_pct,
        )
      : undefined;

  return (
    <ReportSection
      icon={<Users className="h-5 w-5 text-muted-foreground" />}
      title={copy.reportsView.employeePerformance}
      description={copy.reportsView.teamAnalysisDescription}
    >
      {insight ? <p className="mb-3 text-sm text-muted-foreground">{insight}</p> : null}
      <RankBarChart
        title={copy.reportsView.teamChartTitle}
        subtitle={copy.reportsView.teamChartSubtitle}
        rows={chartRows}
        emptyLabel={copy.reportsView.noEmployeeSales}
        valueFormatter={(value) => formatMoney(value)}
      />
      <Caveat />
    </ReportSection>
  );
}
