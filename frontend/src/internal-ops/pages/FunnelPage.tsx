import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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

  const rows =
    query.data?.steps.map((step) => ({
      id: step.name,
      label: STEP_LABELS[step.name] ?? step.name,
      value: step.count,
      conversion: conversionByTo.get(step.name),
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
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold text-kova-ink">
              Cohorte de {query.data.cohort_size} clientes ({window})
            </h2>
            {rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-kova-muted">{opsCopy.common.empty}</p>
            ) : (
              <ol className="mt-5 space-y-4" aria-label="Embudo de activación por paso">
                {rows.map((row) => {
                  const share = query.data.cohort_size
                    ? Math.round((row.value / query.data.cohort_size) * 100)
                    : 0;
                  return (
                    <li key={row.id}>
                      <div className="mb-1.5 flex items-baseline justify-between gap-4 text-sm">
                        <span className="font-medium text-kova-ink">{row.label}</span>
                        <span className="tabular-nums text-kova-muted">
                          {row.value}
                          {row.conversion !== undefined
                            ? ` · ${formatPercent(row.conversion)} del paso previo`
                            : ""}
                        </span>
                      </div>
                      <div
                        className="h-2 overflow-hidden rounded-full bg-kova-mist"
                        role="img"
                        aria-label={`${row.label}: ${row.value}, ${share}% de la cohorte`}
                      >
                        <div
                          className="h-full rounded-full bg-[color:var(--kova-blue)]"
                          style={{ width: `${share}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
