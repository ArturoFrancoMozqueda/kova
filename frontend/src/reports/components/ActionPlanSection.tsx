import { useState } from "react";
import { CheckCircle2, Eye, Sparkles } from "lucide-react";

import { copy } from "@/i18n/messages";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { cn } from "@/lib/utils";
import type { ActionPlanItem } from "../utils/actionPlan";
import { ActionFeedback, DoneToggle, GoLink } from "./planShared";
import { trackAnalysisActionStarted, type AnalysisHelpfulness } from "@/telemetry/funnel";

/** Hard cap on action rows even when expanded. */
const MAX_ACTIONS = 8;

function SignalIcon({ tone }: { tone: ActionPlanItem["tone"] }) {
  if (tone === "ok") {
    return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-kova-growth" aria-hidden />;
  }
  return <Eye className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" aria-hidden />;
}

function ChecklistRow({
  item,
  done,
  feedback,
  onToggleDone,
  onFeedback,
}: {
  item: ActionPlanItem;
  done: boolean;
  feedback?: AnalysisHelpfulness;
  onToggleDone: (item: ActionPlanItem) => void;
  onFeedback: (item: ActionPlanItem, value: AnalysisHelpfulness) => void;
}) {
  // Only actions are tasks the owner can mark as done; watch/ok signals keep
  // their state icon.
  const checkable = item.tone === "action";
  return (
    <li className="flex items-start gap-3 rounded-kova-md border border-kova-border bg-white px-4 py-3">
      {checkable ? (
        <DoneToggle done={done} onToggle={() => onToggleDone(item)} priority={item.priority} />
      ) : (
        <SignalIcon tone={item.tone} />
      )}
      <div className="min-w-0">
        <p
          className={cn(
            "text-sm font-medium leading-5 text-kova-ink",
            checkable && done && "text-kova-muted line-through",
          )}
        >
          {item.action}
        </p>
        {item.evidence ? (
          <p className="mt-0.5 text-xs leading-5 text-kova-muted">{item.evidence}</p>
        ) : null}
        {item.linkTo && !(checkable && done) ? (
          <GoLink
            to={item.linkTo}
            label={item.templateId === "R5" ? copy.reportsView.restockPlan.activate : undefined}
            onClick={() => {
              if (!item.priority) return;
              void trackAnalysisActionStarted({
                template_id: item.templateId,
                decision_area: item.decisionArea,
                priority: item.priority,
                surface: "plan",
              });
            }}
          />
        ) : null}
        {checkable && done ? (
          <ActionFeedback value={feedback} onSelect={(value) => onFeedback(item, value)} />
        ) : null}
      </div>
    </li>
  );
}

/**
 * The full operational to-do beyond the priority card: remaining actions plus
 * derived signals, collapsed by default at the end of the report. Every row
 * keeps its exact figures in the evidence line; nothing is summarized away.
 */
export function ActionPlanSection({
  actions,
  signals,
  doneIds,
  feedbackById,
  onToggleDone,
  onFeedback,
}: {
  actions: ActionPlanItem[];
  signals: ActionPlanItem[];
  doneIds: Set<string>;
  feedbackById: Record<string, AnalysisHelpfulness>;
  onToggleDone: (item: ActionPlanItem) => void;
  onFeedback: (item: ActionPlanItem, value: AnalysisHelpfulness) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = [...actions.slice(0, MAX_ACTIONS), ...signals];
  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-kova-blue" />
          <h2 className="text-lg font-semibold leading-none tracking-tight">{copy.reportsView.recommendationsTitle}</h2>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Disclosure
          open={expanded}
          onOpenChange={setExpanded}
          trigger={expanded ? copy.reportsView.planSectionHide : copy.reportsView.planSectionShow(items.length)}
          triggerClassName="-ml-3"
          panelClassName="mt-3"
        >
          <ul className="space-y-2" aria-label={copy.reportsView.recommendationsTitle}>
            {items.map((item) => (
              <ChecklistRow
                key={item.id}
                item={item}
                done={doneIds.has(item.id)}
                feedback={feedbackById[item.id]}
                onToggleDone={() => onToggleDone(item)}
                onFeedback={onFeedback}
              />
            ))}
          </ul>
        </Disclosure>
      </CardContent>
    </Card>
  );
}
