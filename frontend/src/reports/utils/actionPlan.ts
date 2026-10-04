import { copy } from "../../i18n/messages";
import { formatMoney } from "../../orders/format";
import type { BusinessStoryReport } from "../types";
import { MIN_COUNT_BASE, calculateSafeGrowth, opsAreNormal } from "./calculations";
import type { Recommendation } from "./recommendations";
import type { AnalysisDecisionArea } from "@/telemetry/funnel";
import { inventoryProductLink } from "@/inventory/restockPlan";

export type ActionPlanTone = "action" | "watch" | "ok";

/** One checklist row of the "Qué hacer ahora" block: the action reads first,
 * the evidence explains it in muted text below. */
export type ActionPlanItem = {
  id: string;
  templateId: string;
  decisionArea: AnalysisDecisionArea;
  tone: ActionPlanTone;
  priority?: Recommendation["priority"];
  action: string;
  evidence?: string;
  /** In-app route where the owner can execute the action (e.g. /inventory). */
  linkTo?: string;
};

const DECISION_AREA_BY_TEMPLATE: Record<string, AnalysisDecisionArea> = {
  R1: "crecimiento",
  R2: "inventario",
  R3: "caja",
  R4: "inventario",
  R5: "inventario",
  R6: "caja",
  R7: "inventario",
  R8: "caja",
  R9: "empleado",
  R10: "crecimiento",
  R11: "crecimiento",
  R12: "inventario",
  R13: "caja",
};

export function recommendationDecisionArea(templateId: string): AnalysisDecisionArea {
  return DECISION_AREA_BY_TEMPLATE[templateId] ?? "crecimiento";
}

/** Known stock goes to the exact inventory item; untracked products go to
 * the existing catalog rather than a product-creation form. */
export function recommendationLink(templateId: string, productId?: string, productName?: string): string | null {
  if (["R2", "R4", "R12"].includes(templateId)) {
    return productId ? inventoryProductLink(productId) : "/inventory";
  }
  if (templateId === "R5") {
    return productName ? `/catalog?${new URLSearchParams({ search: productName })}` : "/catalog";
  }
  return null;
}

export type ActionPlan = {
  hero: Recommendation | null;
  /** Action rows derived from the remaining recommendations, in engine order. */
  actions: ActionPlanItem[];
  /** Derived watch/confirmation signals, rendered after the actions. */
  signals: ActionPlanItem[];
};

/** Average-ticket drops beyond this are worth watching (a signal, not a KPI). */
const TICKET_WATCH_DROP_PCT = -10;

/**
 * Synthesizes the operational to-do for the period: the priority action (hero)
 * plus a short checklist mixing the remaining recommendations (action-first)
 * with derived signals — a falling average ticket to watch, and an explicit
 * "payments/refunds are normal" confirmation so the owner doesn't have to
 * scroll to the ops section to rule that out. Pure and testable; everything
 * comes from data already on screen.
 */
export function buildActionPlan({
  recommendations,
  story,
  previousStory,
}: {
  recommendations: Recommendation[];
  story: BusinessStoryReport;
  previousStory: BusinessStoryReport | null;
}): ActionPlan {
  const [hero = null, ...rest] = recommendations;

  const actions: ActionPlanItem[] = rest.map((rec) => ({
    id: `${rec.id}|${rec.subjectId}`,
    templateId: rec.id,
    decisionArea: recommendationDecisionArea(rec.id),
    tone: rec.tone === "good_signal" ? "ok" : "action",
    priority: rec.priority,
    action: rec.action,
    evidence: `${rec.finding}. ${rec.evidence}`,
    linkTo: recommendationLink(rec.id, rec.subjectId, rec.subjectName) ?? undefined,
  }));

  const signals: ActionPlanItem[] = [];

  // Watch signal: average ticket falling vs a comparable previous period.
  const summary = story.summary;
  const prevSummary = previousStory?.summary ?? null;
  const prevComparable = prevSummary !== null && prevSummary.completed_orders >= MIN_COUNT_BASE;
  if (prevComparable && prevSummary) {
    const growth = calculateSafeGrowth(
      Number(summary.average_ticket),
      Number(prevSummary.average_ticket),
      { minBase: 1 },
    );
    if (growth.kind === "pct" && growth.value <= TICKET_WATCH_DROP_PCT) {
      signals.push({
        id: "signal|ticket-watch",
        templateId: "signal",
        decisionArea: "crecimiento",
        tone: "watch",
        action: copy.reportsView.actionWatchTicketAction,
        evidence: copy.reportsView.actionWatchTicketEvidence(
          formatMoney(summary.average_ticket),
          Math.abs(growth.value),
        ),
      });
    }
  }

  // Confirmation: payments/refunds at a normal level. Skipped when R13 (clean
  // ops) already says it, or when something operational needs real attention.
  const hasCleanOpsRec = recommendations.some((rec) => rec.id === "R13");
  if (!hasCleanOpsRec && opsAreNormal(summary)) {
    signals.push({
      id: "signal|ops-normal",
      templateId: "signal",
      decisionArea: "caja",
      tone: "ok",
      action: copy.reportsView.actionOpsNormalAction,
    });
  }

  return { hero, actions, signals };
}
