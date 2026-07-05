import { useState } from "react";
import { Lightbulb, Sparkles } from "lucide-react";

import { copy } from "@/i18n/messages";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Recommendation, RecommendationPriority } from "../utils/recommendations";

const MAX_COLLAPSED = 3;
const MAX_EXPANDED = 6;

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

function RecommendationItem({ recommendation }: { recommendation: Recommendation }) {
  return (
    <div className={cn("rounded-kova-md border p-4", toneBorder(recommendation.tone))}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={priorityBadgeVariant(recommendation.priority)}>
          {copy.reportsView.priorityLabel(recommendation.priority)}
        </Badge>
        <p className="font-semibold text-kova-ink">{recommendation.finding}</p>
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

export function RecommendationCards({ recommendations }: { recommendations: Recommendation[] }) {
  const [expanded, setExpanded] = useState(false);
  const capped = recommendations.slice(0, MAX_EXPANDED);
  const visible = expanded ? capped : capped.slice(0, MAX_COLLAPSED);
  const hasMore = capped.length > MAX_COLLAPSED;

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
        {visible.length === 0 ? (
          <div className="rounded-kova-md border border-kova-growth/30 bg-kova-growth/5 p-4">
            <p className="text-sm text-muted-foreground">{copy.reportsView.recommendationsEmpty}</p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((recommendation) => (
              <RecommendationItem
                key={`${recommendation.id}-${recommendation.subjectId}`}
                recommendation={recommendation}
              />
            ))}
          </div>
        )}
        {hasMore ? (
          <Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
            {expanded ? copy.reportsView.recShowLess : copy.reportsView.recShowAll(capped.length)}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
