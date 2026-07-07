import { useState } from "react";
import { CheckCircle2, Eye, Lightbulb, Sparkles } from "lucide-react";

import { copy } from "@/i18n/messages";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { BusinessStoryReport } from "../types";
import { buildActionPlan, type ActionPlanItem } from "../utils/actionPlan";
import type { Recommendation, RecommendationPriority } from "../utils/recommendations";

/** Collapsed rows below the hero (actions + signals combined). */
const MAX_COLLAPSED_ITEMS = 4;
/** Hard cap on action rows even when expanded. */
const MAX_EXPANDED_ACTIONS = 8;

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

function HeroRecommendation({ recommendation }: { recommendation: Recommendation }) {
  return (
    <div
      data-testid="priority-recommendation"
      className={cn("rounded-kova-md border-2 p-5", toneBorder(recommendation.tone))}
    >
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-kova-muted">
        {copy.reportsView.priorityRecommendationKicker}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={priorityBadgeVariant(recommendation.priority)}>
          {copy.reportsView.priorityLabel(recommendation.priority)}
        </Badge>
        <p className="text-base font-semibold text-kova-ink">{recommendation.finding}</p>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{recommendation.evidence}</p>
      <p className="mt-2 flex items-start gap-1.5 text-sm font-medium text-kova-ink">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-kova-blue" />
        {recommendation.action}
      </p>
      {recommendation.impact ? (
        <p className="mt-2 text-xs text-kova-muted">
          {copy.reportsView.recImpactPrefix}: {recommendation.impact}
        </p>
      ) : null}
    </div>
  );
}

function ItemIcon({ item }: { item: ActionPlanItem }) {
  if (item.tone === "ok") {
    return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-kova-growth" aria-hidden />;
  }
  if (item.tone === "watch") {
    return <Eye className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" aria-hidden />;
  }
  return (
    <span
      aria-hidden
      className={cn(
        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
        item.priority === "alta"
          ? "bg-kova-danger"
          : item.priority === "media"
            ? "bg-warning"
            : "bg-kova-blue",
      )}
    />
  );
}

function ChecklistRow({ item }: { item: ActionPlanItem }) {
  return (
    <li className="flex items-start gap-3 rounded-kova-md border border-kova-border bg-white px-4 py-3">
      <ItemIcon item={item} />
      <div className="min-w-0">
        <p className="text-sm font-medium leading-5 text-kova-ink">{item.action}</p>
        {item.evidence ? (
          <p className="mt-0.5 text-xs leading-5 text-kova-muted">{item.evidence}</p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * "Qué hacer ahora": the operational to-do of the report. The priority action
 * stays as the hero card; below it, a compact checklist synthesizes the other
 * recommendations (action-first) plus derived signals — a falling ticket to
 * watch, and the payments/refunds "all normal" confirmation.
 */
export function RecommendationCards({
  recommendations,
  story,
  previousStory,
}: {
  recommendations: Recommendation[];
  story: BusinessStoryReport;
  previousStory: BusinessStoryReport | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const { hero, actions, signals } = buildActionPlan({ recommendations, story, previousStory });

  const cappedActions = actions.slice(0, MAX_EXPANDED_ACTIONS);
  // Signals are the synthesis, so they always survive the collapse; the
  // remaining slots go to the highest-priority actions.
  const collapsedActionCount = Math.max(1, MAX_COLLAPSED_ITEMS - signals.length);
  const collapsedItems = [...cappedActions.slice(0, collapsedActionCount), ...signals];
  const expandedItems = [...cappedActions, ...signals];
  const visibleItems = expanded ? expandedItems : collapsedItems;
  const hasMore = cappedActions.length > collapsedActionCount;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-kova-blue" />
          <CardTitle>{copy.reportsView.recommendationsTitle}</CardTitle>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          {copy.reportsView.recommendationsDescription}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!hero ? (
          <div className="rounded-kova-md border border-kova-growth/30 bg-kova-growth/5 p-4">
            <p className="text-sm text-muted-foreground">{copy.reportsView.recommendationsEmpty}</p>
          </div>
        ) : (
          <>
            <HeroRecommendation recommendation={hero} />
            {visibleItems.length > 0 ? (
              <ul className="space-y-2">
                {visibleItems.map((item) => (
                  <ChecklistRow key={item.id} item={item} />
                ))}
              </ul>
            ) : null}
          </>
        )}
        {hasMore ? (
          <Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
            {expanded
              ? copy.reportsView.recShowLess
              : copy.reportsView.recShowAll(expandedItems.length)}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
