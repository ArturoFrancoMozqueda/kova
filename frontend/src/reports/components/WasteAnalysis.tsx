import { Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { copy } from "@/i18n/messages";
import { formatMoney } from "@/orders/format";
import type { BusinessStoryReport } from "../types";

export function WasteAnalysis({ story }: { story: BusinessStoryReport }) {
  const waste = story.waste;
  if (!waste || waste.movement_count === 0) return null;
  return (
    <Card data-testid="waste-analysis">
      <CardHeader className="sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold leading-none tracking-tight flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            {copy.reportsView.wasteTitle}
          </h2>
          <p className="mt-2 text-sm text-kova-muted">{copy.reportsView.wasteBody}</p>
        </div>
        <Badge variant={waste.complete ? "secondary" : "warning"}>
          {waste.complete ? copy.reportsView.wasteComplete : copy.reportsView.wasteIncomplete}
        </Badge>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
        <div className="rounded-kova-md border border-kova-border bg-kova-mist p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-kova-tertiary">
            {copy.reportsView.wasteValue}
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-kova-ink">
            {waste.value === null ? copy.reportsView.notAvailable : formatMoney(waste.value)}
          </p>
          <p className="mt-1 text-xs text-kova-muted">
            {copy.reportsView.wasteUnits(waste.units, waste.movement_count)}
          </p>
          {waste.value === null ? (
            <p className="mt-2 text-xs text-kova-muted">
              {copy.reportsView.wasteKnownValue(formatMoney(waste.known_value), waste.products_without_cost)}
            </p>
          ) : null}
        </div>
        <div className="divide-y divide-kova-border rounded-kova-md border border-kova-border">
          {waste.by_reason.map((row) => (
            <div key={row.reason_code} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="text-sm text-kova-ink">{copy.inventoryModal.reasonCodes[row.reason_code]}</span>
              <span className="text-sm font-semibold tabular-nums text-kova-ink">
                {row.value === null ? copy.reportsView.productWithoutCost : formatMoney(row.value)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
