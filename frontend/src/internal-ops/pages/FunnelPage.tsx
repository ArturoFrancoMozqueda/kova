import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { InteractiveBarChart, type ChartRow } from "@/reports/InteractiveCharts";
import { resolveApiErrorMessage } from "@/lib/apiError";
import { cn } from "@/lib/utils";
import { opsCopy } from "../copy";
import { formatPercent } from "../format";
import { useFunnel } from "../hooks";
import { PageHeader } from "../components/PageHeader";
import { ErrorState } from "../components/states";
import type { FunnelWindow } from "../types";

const STEP_LABELS: Record<string, string> = {
  signup: "Registro",
  email_verified: "Email verificado",
  first_product: "Primer producto",
  first_sale: "Primera venta",
  checkout_started: "Checkout iniciado",
  paid: "Pagando",
};

const WINDOWS: FunnelWindow[] = ["7d", "30d", "90d"];

export default function FunnelPage() {
  const [window, setWindow] = useState<FunnelWindow>("30d");
  const query = useFunnel(window);

  const conversionByTo = new Map<string, number>();
  if (query.data) {
    for (const c of query.data.conversions) conversionByTo.set(c.to, c.rate);
  }

  const rows: ChartRow[] =
    query.data?.steps.map((step) => ({
      id: step.name,
      label: STEP_LABELS[step.name] ?? step.name,
      value: step.count,
      valueLabel: String(step.count),
      meta: conversionByTo.has(step.name)
        ? [{ label: "conversión del paso previo", value: formatPercent(conversionByTo.get(step.name) ?? 0) }]
        : undefined,
    })) ?? [];

  return (
    <>
      <PageHeader title={opsCopy.nav.funnel} updatedAt={query.data?.generated_at}>
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWindow(w)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium",
                window === w ? "bg-[color:var(--kova-blue)] text-white" : "text-kova-muted hover:bg-muted",
              )}
            >
              {w}
            </button>
          ))}
        </div>
      </PageHeader>

      {query.isPending ? (
        <Skeleton className="h-64" />
      ) : query.isError ? (
        <ErrorState message={resolveApiErrorMessage(query.error, opsCopy.common.loadError)} onRetry={query.refetch} />
      ) : (
        <InteractiveBarChart
          title={`Cohorte de ${query.data.cohort_size} clientes (${window})`}
          rows={rows}
          emptyLabel={opsCopy.common.empty}
          ariaLabel="Embudo de activación por paso"
          detailPlaceholder="Selecciona un paso para ver su conversión."
          totalShareLabel={(pct) => `${pct}% del total`}
        />
      )}
    </>
  );
}
