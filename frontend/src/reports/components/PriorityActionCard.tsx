import { useState } from "react";
import { Check, Lightbulb } from "lucide-react";

import { copy } from "@/i18n/messages";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { cn } from "@/lib/utils";
import { recommendationDecisionArea, recommendationLink } from "../utils/actionPlan";
import type { Recommendation, RecommendationPriority } from "../utils/recommendations";
import { ActionFeedback, GoLink } from "./planShared";
import {
  trackAnalysisActionStarted,
  trackAnalysisRecommendationOpened,
  type AnalysisHelpfulness,
} from "@/telemetry/funnel";

function priorityBadgeVariant(priority: RecommendationPriority) {
  if (priority === "alta") return "destructive" as const;
  if (priority === "media") return "warning" as const;
  return "secondary" as const;
}

function toneBorder(tone: Recommendation["tone"]) {
  if (tone === "risk") return "border-destructive/30 bg-destructive/5";
  if (tone === "good_signal") return "border-kova-growth/30 bg-kova-growth/5";
  return "border-kova-blue/20 bg-kova-blue/5";
}

/**
 * The one action the owner should take now, as a compact card: finding +
 * action stay always visible with their exact figures; the supporting
 * evidence and estimated impact open on demand ("Ver por qué") so the card
 * fits the dashboard rail without losing precision.
 */
export function PriorityActionCard({
  recommendation,
  done,
  feedback,
  onToggleDone,
  onFeedback,
}: {
  recommendation: Recommendation | null;
  done: boolean;
  feedback?: AnalysisHelpfulness;
  onToggleDone: () => void;
  onFeedback: (value: AnalysisHelpfulness) => void;
}) {
  const [whyOpen, setWhyOpen] = useState(false);

  if (!recommendation) {
    return (
      <div className="rounded-kova-md border border-kova-growth/30 bg-kova-growth/5 p-4">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-kova-muted">
          {copy.reportsView.priorityRecommendationKicker}
        </p>
        <p className="text-sm text-muted-foreground">{copy.reportsView.recommendationsEmpty}</p>
      </div>
    );
  }

  const link = recommendationLink(recommendation.id, recommendation.subjectId, recommendation.subjectName);
  const telemetryContext = {
    template_id: recommendation.id,
    decision_area: recommendationDecisionArea(recommendation.id),
    priority: recommendation.priority,
    surface: "prioridad" as const,
  };

  return (
    <div
      data-testid="priority-recommendation"
      className={cn("rounded-kova-md border-2 p-4", toneBorder(recommendation.tone))}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-kova-muted">
          {copy.reportsView.priorityRecommendationKicker}
        </p>
        {recommendation.tone !== "good_signal" ? (
          <Button variant="ghost" size="sm" className="-mr-2 -mt-1.5 h-7 px-2 text-xs" onClick={onToggleDone}>
            {done ? (
              <span className="flex items-center gap-1 text-emerald-700">
                <Check className="h-3.5 w-3.5" /> {copy.reportsView.planDone}
              </span>
            ) : (
              copy.reportsView.planMarkDone
            )}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={priorityBadgeVariant(recommendation.priority)}>
          {copy.reportsView.priorityLabel(recommendation.priority)}
        </Badge>
        <p className={cn("text-sm font-semibold text-kova-ink", done && "line-through")}>
          {recommendation.finding}
        </p>
      </div>
      <p className={cn("mt-2 flex items-start gap-1.5 text-sm font-medium text-kova-ink", done && "line-through")}>
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-kova-blue" />
        {recommendation.action}
      </p>
      <Disclosure
        open={whyOpen}
        onOpenChange={(open) => {
          setWhyOpen(open);
          if (open && !whyOpen) void trackAnalysisRecommendationOpened(telemetryContext);
        }}
        className="mt-2"
        trigger={whyOpen ? copy.reportsView.priorityWhyHide : copy.reportsView.priorityWhyShow}
        triggerClassName="h-auto gap-1 px-0 py-0 text-xs text-kova-blue hover:bg-transparent hover:underline"
        panelClassName="mt-1.5"
      >
        <div className="space-y-1">
          <p className="text-sm leading-6 text-muted-foreground">{recommendation.evidence}</p>
          {recommendation.impact ? (
            <p className="text-xs text-kova-muted">
              {copy.reportsView.recImpactPrefix}: {recommendation.impact}
            </p>
          ) : null}
        </div>
      </Disclosure>
      {link && !done ? (
        <div>
          <GoLink
            to={link}
            label={recommendation.id === "R5" ? copy.reportsView.restockPlan.activate : undefined}
            onClick={() => void trackAnalysisActionStarted(telemetryContext)}
          />
        </div>
      ) : null}
      {done && recommendation.tone !== "good_signal" ? (
        <ActionFeedback value={feedback} onSelect={onFeedback} />
      ) : null}
    </div>
  );
}
