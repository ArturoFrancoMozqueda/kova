import { Calculator, TriangleAlert, WalletCards } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { copy } from "@/i18n/messages";
import { formatMoney } from "@/orders/format";
import type { BusinessStoryReport } from "../types";

export function OperatingExpenseAnalysis({ story }: { story: BusinessStoryReport }) {
  const report = story.operating_expenses;
  if (!report) return null;
  const available = report.margin_complete && report.approximate_operating_profit !== null;
  return (
    <Card className="overflow-hidden border-kova-blue/20" data-testid="operating-expense-analysis">
      <CardHeader className="gap-3 border-b border-kova-border bg-kova-blue/[0.03] sm:flex-row sm:items-start sm:justify-between">
        <div><h2 className="text-lg font-semibold leading-none tracking-tight flex items-center gap-2"><Calculator className="h-5 w-5 text-kova-blue" />{copy.reportsView.operatingTitle}</h2><p className="mt-2 text-sm text-kova-muted">{copy.reportsView.operatingBody}</p></div>
        <Badge variant={report.expense_count > 0 ? "secondary" : "warning"}>{copy.reportsView.operatingExpenseCount(report.expense_count)}</Badge>
      </CardHeader>
      <CardContent className="grid gap-5 pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-kova-tertiary">{copy.reportsView.approximateOperatingProfit}</p>
          {available ? <p className="mt-1 text-3xl font-bold tabular-nums text-kova-ink">{formatMoney(report.approximate_operating_profit!)}</p> : <div className="mt-2 flex items-start gap-3 rounded-kova-md border border-amber-200 bg-amber-50 p-4"><TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" /><p className="text-sm text-kova-muted">{copy.reportsView.operatingUnavailable}</p></div>}
          <p className="mt-3 text-xs text-kova-muted">{copy.reportsView.operatingMethodNote}</p>
          <Link className="mt-3 inline-flex text-sm font-semibold text-kova-blue hover:underline" to="/expenses">{report.expense_count > 0 ? copy.reportsView.manageExpenses : copy.reportsView.addFirstExpense}</Link>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-kova-md border border-kova-border p-4"><span className="flex items-center gap-2 text-sm font-semibold text-kova-ink"><WalletCards className="h-4 w-4 text-kova-blue" />{copy.reportsView.registeredExpenses}</span><span className="font-bold tabular-nums text-kova-ink">{formatMoney(report.total)}</span></div>
          {report.by_category.length > 0 ? <div className="divide-y divide-kova-border rounded-kova-md border border-kova-border">{report.by_category.map((row) => <div key={row.category} className="flex items-center justify-between gap-3 px-3 py-2.5"><span className="text-sm text-kova-ink">{copy.expenses.categories[row.category]}</span><span className="text-sm font-semibold tabular-nums text-kova-ink">{formatMoney(row.amount)}</span></div>)}</div> : <p className="rounded-kova-md bg-kova-mist p-4 text-sm text-kova-muted">{copy.reportsView.noExpensesYet}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
