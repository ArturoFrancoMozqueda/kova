import { CheckCircle2, FileText, MessageCircle, Sparkles, XCircle, type LucideIcon } from "lucide-react";
import { RankBars } from "@/components/visual";
import type { Opportunity, OpportunityStage } from "./types";

export const stageLabels: Record<OpportunityStage, string> = {
  new: "Nueva",
  contacted: "En contacto",
  proposal: "Propuesta",
  won: "Ganada",
  lost: "Perdida",
};

export const stageIcons: Record<OpportunityStage, LucideIcon> = {
  new: Sparkles,
  contacted: MessageCircle,
  proposal: FileText,
  won: CheckCircle2,
  lost: XCircle,
};

const stageOrder: OpportunityStage[] = ["new", "contacted", "proposal", "won", "lost"];

const money = (cents: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);

/** Estimated amounts arrive as decimal strings; sum in whole cents for display only. */
const toCents = (amount: string) => {
  const value = Number(amount);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
};

/**
 * Pipeline by stage: count and estimated amount of the opportunities the API
 * returned. When there are more pages it says the numbers are for this page.
 */
export function CrmStageFunnel({ opportunities, hasMore }: { opportunities: Opportunity[]; hasMore: boolean }) {
  const totals = new Map<OpportunityStage, { count: number; cents: number }>();
  for (const row of opportunities) {
    const current = totals.get(row.stage) ?? { count: 0, cents: 0 };
    totals.set(row.stage, { count: current.count + 1, cents: current.cents + toCents(row.estimated_amount) });
  }
  const scope = hasMore ? " en esta página" : "";
  const rows = stageOrder.map((stage) => {
    const Icon = stageIcons[stage];
    const { count, cents } = totals.get(stage) ?? { count: 0, cents: 0 };
    return {
      id: stage,
      label: stageLabels[stage],
      value: count,
      valueLabel: `${count} · ${money(cents)}`,
      leading: (
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-kova-blue/10 text-kova-blue">
          <Icon className="h-4 w-4" />
        </span>
      ),
    };
  });
  return (
    <section aria-labelledby="crm-funnel" className="rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="crm-funnel" className="font-semibold">Oportunidades por etapa</h3>
        <p className="text-xs text-muted-foreground">Cantidad y monto estimado{scope}</p>
      </div>
      <RankBars className="mt-4" rows={rows} label={`Oportunidades por etapa${scope}`} emptyLabel="Sin oportunidades registradas." />
    </section>
  );
}
