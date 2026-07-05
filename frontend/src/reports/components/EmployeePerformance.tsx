import { Info, Users } from "lucide-react";

import { copy } from "@/i18n/messages";
import { formatMoney } from "@/orders/format";
import { RankBarChart } from "../charts/RankBarChart";
import type { ChartRow } from "../charts/types";
import type { BusinessStoryReport, SalesByEmployeeRow } from "../types";
import { ReportSection } from "./ReportSection";

function averageTicket(row: SalesByEmployeeRow): string {
  const net = Number(row.net_sales);
  return formatMoney(row.order_count > 0 ? net / row.order_count : 0);
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
        <p className="rounded-kova-md border border-dashed bg-muted/30 p-5 text-sm leading-6 text-muted-foreground">
          {copy.reportsView.teamSingle(
            only.display_name,
            only.order_count,
            formatMoney(only.net_sales),
            averageTicket(only),
          )}
        </p>
      </ReportSection>
    );
  }

  const totalNet = rows.reduce((sum, row) => sum + Number(row.net_sales), 0);
  const chartRows: ChartRow[] = [...rows]
    .sort((a, b) => Number(b.net_sales) - Number(a.net_sales))
    .map((row) => {
      const share = totalNet > 0 ? Math.round((Number(row.net_sales) / totalNet) * 100) : 0;
      return {
        id: row.user_id ?? row.display_name,
        label: row.display_name,
        value: Number(row.net_sales),
        valueLabel: formatMoney(row.net_sales),
        meta: [
          { label: copy.reportsView.chartOrders, value: String(row.order_count) },
          { label: copy.reportsView.chartShareLabel, value: `${share}%` },
          { label: copy.reportsView.avgTicket, value: averageTicket(row) },
          { label: copy.reportsView.chartRefunds, value: String(row.refund_count) },
        ],
      };
    });

  const insight = contribution?.even_distribution
    ? copy.reportsView.teamEven
    : contribution?.top
      ? copy.reportsView.employeeContributionTop(contribution.top.display_name, contribution.top.sales_share_pct)
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
      <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {copy.reportsView.teamCaveat}
      </p>
    </ReportSection>
  );
}
