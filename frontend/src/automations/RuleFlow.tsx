import type { LucideIcon } from "lucide-react";
import { ArrowDown, CheckCheck, ClockAlert, ListChecks, PackageCheck, PackageSearch, Zap } from "lucide-react";
import type { AutomationRule } from "./types";

const triggers: Record<string, { icon: LucideIcon; label: string }> = {
  order_ready: { icon: PackageCheck, label: "Un pedido se marca como listo" },
  order_fulfilled: { icon: CheckCheck, label: "Un pedido se entrega" },
  restock_review: { icon: PackageSearch, label: "Un producto necesita reposición" },
  service_case_overdue: { icon: ClockAlert, label: "Una atención vence" },
};

/**
 * "Cuando → Entonces" for one rule, with the internal task drawn the way it
 * shows up in Pendientes. Rules only create internal tasks: no messages,
 * no payments, so nothing else is drawn.
 */
export function RuleFlow({ rule }: { rule: AutomationRule }) {
  const trigger = triggers[rule.template_key] ?? { icon: Zap, label: "Ocurre el evento de la regla" };
  const Trigger = trigger.icon;
  return (
    <ol className="mt-4 space-y-1.5 text-sm" aria-label={`Cómo funciona: ${rule.title}`}>
      <li className="flex items-center gap-3 rounded-xl border border-kova-border bg-kova-mist/60 p-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-kova-blue shadow-sm">
          <Trigger className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0"><span className="block text-[11px] font-semibold uppercase tracking-wide text-kova-muted">Cuando</span>{trigger.label}</span>
      </li>
      <li aria-hidden="true" className="flex justify-center text-kova-muted"><ArrowDown className="h-4 w-4" /></li>
      <li className="flex items-center gap-3 rounded-xl border border-dashed border-kova-blue/40 bg-white p-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-kova-blue/10 text-kova-blue">
          <ListChecks className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-kova-muted">Entonces aparece en Pendientes</span>
          <span className="break-words font-medium">{rule.task ?? "Una tarea interna para tu equipo"}</span>
        </span>
      </li>
    </ol>
  );
}
