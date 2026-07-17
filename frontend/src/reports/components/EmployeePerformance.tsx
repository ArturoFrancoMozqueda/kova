import { Users } from "lucide-react";

import { copy } from "@/i18n/messages";
import { formatMoney } from "@/orders/format";
import { RankBarChart } from "../charts/RankBarChart";
import type { ChartRow } from "../charts/types";
import type { BusinessStoryReport, SalesByEmployeeRow } from "../types";
import { displayPersonName } from "../utils/format";
import { InfoDisclosure } from "./InfoDisclosure";
import { BentoPanel } from "./ReportSection";

function averageTicket(row: SalesByEmployeeRow): string {
  const net = Number(row.net_sales);
  return formatMoney(row.order_count > 0 ? net / row.order_count : 0);
}

function Caveat() {
  return <InfoDisclosure>{copy.reportsView.teamCaveat}</InfoDisclosure>;
}

export function EmployeePerformance({ story }: { story: BusinessStoryReport }) {
  const rows = story.sales_by_employee;
  const contribution = story.employee_contribution;

  if (rows.length === 0) {
    return (
      <BentoPanel
        icon={<Users className="h-5 w-5 text-muted-foreground" />}
        title={copy.reportsView.employeePerformance}
      >
        <p className="rounded-kova-md border border-dashed bg-muted/30 p-5 text-sm text-muted-foreground">
          {copy.reportsView.noEmployeeSales}
        </p>
      </BentoPanel>
    );
  }

  const totalNet = rows.reduce((sum, row) => sum + Number(row.net_sales), 0);
  const ranked = [...rows].sort((a, b) => Number(b.net_sales) - Number(a.net_sales));
  const shareOf = (row: SalesByEmployeeRow) =>
    totalNet > 0 ? Math.round((Number(row.net_sales) / totalNet) * 100) : 0;

  const highlight = contribution?.even_distribution
    ? copy.reportsView.highlightTeamEven
    : ranked.length > 1
      ? copy.reportsView.highlightTopSeller(displayPersonName(ranked[0].display_name), shareOf(ranked[0]))
      : null;

  if (rows.length === 1) {
    const only = rows[0];
    return (
      <BentoPanel
        icon={<Users className="h-5 w-5 text-muted-foreground" />}
        title={copy.reportsView.employeePerformance}
      >
        <p className="rounded-kova-md border border-dashed bg-muted/30 p-5 text-sm leading-6 tabular-nums text-muted-foreground">
          {copy.reportsView.teamSingle(
            displayPersonName(only.display_name),
            only.order_count,
            formatMoney(only.net_sales),
            averageTicket(only),
          )}
        </p>
      </BentoPanel>
    );
  }

  // With exactly two people a sentence beats a two-bar chart: it names both
  // contributions directly and keeps the section compact.
  if (ranked.length === 2) {
    const [first, second] = ranked;
    return (
      <BentoPanel
        icon={<Users className="h-5 w-5 text-muted-foreground" />}
        title={copy.reportsView.employeePerformance}
        highlight={highlight}
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
      </BentoPanel>
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

  return (
    <BentoPanel
      icon={<Users className="h-5 w-5 text-muted-foreground" />}
      title={copy.reportsView.employeePerformance}
      highlight={highlight}
    >
      <RankBarChart
        subtitle={copy.reportsView.teamChartSubtitle}
        rows={chartRows}
        emptyLabel={copy.reportsView.noEmployeeSales}
        valueFormatter={(value) => formatMoney(value)}
      />
      <Caveat />
    </BentoPanel>
  );
}
