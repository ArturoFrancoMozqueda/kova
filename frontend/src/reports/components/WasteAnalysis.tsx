import { Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { copy } from "@/i18n/messages";
import { formatMoney } from "@/orders/format";
import { RankBars } from "@/components/visual";
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
        <div className="rounded-kova-md border border-kova-border p-4">
          {/* Bars by valued loss; a reason without cost keeps its units as the
              visible answer instead of pretending to be $0. */}
          <RankBars
            label={copy.reportsView.wasteTitle}
            emptyLabel={copy.reportsView.notAvailable}
            tone="danger"
            rows={[...waste.by_reason]
              .sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0))
              .map((row) => ({
                id: row.reason_code,
                label: copy.inventoryModal.reasonCodes[row.reason_code],
                value: Number(row.value ?? 0),
                valueLabel: row.value === null ? copy.reportsView.productWithoutCost : formatMoney(row.value),
                detail: `${row.units.toLocaleString("es-MX")} ${row.units === 1 ? "unidad" : "unidades"}`,
              }))}
          />
        </div>
      </CardContent>
    </Card>
  );
}
