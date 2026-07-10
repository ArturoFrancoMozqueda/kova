import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, CheckCircle2, Eye, Lightbulb, Sparkles } from "lucide-react";

import { useAuth } from "@/auth/useAuth";
import { copy } from "@/i18n/messages";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { BusinessStoryReport } from "../types";
import { buildActionPlan, recommendationLink, type ActionPlanItem } from "../utils/actionPlan";
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

function GoLink({ to }: { to: string }) {
  return (
    <Link
      to={to}
      className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-kova-blue hover:underline"
    >
      {copy.reportsView.actionGoInventory}
      <ArrowRight className="h-3 w-3" aria-hidden />
    </Link>
  );
}

function DoneToggle({
  done,
  onToggle,
  priority,
}: {
  done: boolean;
  onToggle: () => void;
  priority?: RecommendationPriority;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? copy.reportsView.planDone : copy.reportsView.planMarkDone}
      onClick={onToggle}
      className={cn(
        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
        done
          ? "border-kova-growth bg-kova-growth text-white"
          : priority === "alta"
            ? "border-kova-danger/50 hover:border-kova-danger"
            : priority === "media"
              ? "border-warning hover:border-warning-foreground"
              : "border-kova-blue/50 hover:border-kova-blue",
      )}
    >
      {done ? <Check className="h-3 w-3" aria-hidden /> : null}
    </button>
  );
}

function HeroRecommendation({
  recommendation,
  done,
  onToggleDone,
}: {
  recommendation: Recommendation;
  done: boolean;
  onToggleDone: () => void;
}) {
  const link = recommendationLink(recommendation.id);
  return (
    <div
      data-testid="priority-recommendation"
      className={cn(
        "rounded-kova-md border-2 p-5",
        toneBorder(recommendation.tone),
        done && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-kova-muted">
          {copy.reportsView.priorityRecommendationKicker}
        </p>
        <Button variant="ghost" size="sm" className="-mr-2 -mt-1.5 h-7 px-2 text-xs" onClick={onToggleDone}>
          {done ? (
            <span className="flex items-center gap-1 text-kova-growth">
              <Check className="h-3.5 w-3.5" /> {copy.reportsView.planDone}
            </span>
          ) : (
            copy.reportsView.planMarkDone
          )}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={priorityBadgeVariant(recommendation.priority)}>
          {copy.reportsView.priorityLabel(recommendation.priority)}
        </Badge>
        <p className={cn("text-base font-semibold text-kova-ink", done && "line-through")}>
          {recommendation.finding}
        </p>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{recommendation.evidence}</p>
      <p className={cn("mt-2 flex items-start gap-1.5 text-sm font-medium text-kova-ink", done && "line-through")}>
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-kova-blue" />
        {recommendation.action}
      </p>
      {recommendation.impact ? (
        <p className="mt-2 text-xs text-kova-muted">
          {copy.reportsView.recImpactPrefix}: {recommendation.impact}
        </p>
      ) : null}
      {link && !done ? <GoLink to={link} /> : null}
    </div>
  );
}

function SignalIcon({ tone }: { tone: ActionPlanItem["tone"] }) {
  if (tone === "ok") {
    return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-kova-growth" aria-hidden />;
  }
  return <Eye className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" aria-hidden />;
}

function ChecklistRow({
  item,
  done,
  onToggleDone,
}: {
  item: ActionPlanItem;
  done: boolean;
  onToggleDone: () => void;
}) {
  // Only actions are tasks the owner can mark as done; watch/ok signals keep
  // their state icon.
  const checkable = item.tone === "action";
  return (
    <li className="flex items-start gap-3 rounded-kova-md border border-kova-border bg-white px-4 py-3">
      {checkable ? (
        <DoneToggle done={done} onToggle={onToggleDone} priority={item.priority} />
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
        {item.linkTo && !(checkable && done) ? <GoLink to={item.linkTo} /> : null}
      </div>
    </li>
  );
}

function readDoneIds(storageKey: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * "Qué hacer ahora": the operational to-do of the report. The priority action
 * stays as the hero card; below it, a compact checklist synthesizes the other
 * recommendations (action-first, with a route link when the action can be
 * executed in-app) plus derived signals. Actions can be checked off; the done
 * set persists locally per tenant + period, so the plan feels alive between
 * visits without touching the backend.
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
  const { state } = useAuth();
  const tenantId = state.status === "authenticated" ? state.tenantId : "local";
  const storageKey = `kova:plan:${tenantId}:${story.summary.start_date}:${story.summary.end_date}`;

  const [doneIds, setDoneIds] = useState<Set<string>>(() => readDoneIds(storageKey));
  useEffect(() => {
    setDoneIds(readDoneIds(storageKey));
  }, [storageKey]);

  const toggleDone = (id: string) => {
    setDoneIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      try {
        window.localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        /* quota/denied: the toggle still works for the session */
      }
      return next;
    });
  };

  const { hero, actions, signals } = buildActionPlan({ recommendations, story, previousStory });
  const heroId = hero ? `${hero.id}|${hero.subjectId}` : null;

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
        {!hero || !heroId ? (
          <div className="rounded-kova-md border border-kova-growth/30 bg-kova-growth/5 p-4">
            <p className="text-sm text-muted-foreground">{copy.reportsView.recommendationsEmpty}</p>
          </div>
        ) : (
          <>
            <HeroRecommendation
              recommendation={hero}
              done={doneIds.has(heroId)}
              onToggleDone={() => toggleDone(heroId)}
            />
            {visibleItems.length > 0 ? (
              <ul className="space-y-2">
                {visibleItems.map((item) => (
                  <ChecklistRow
                    key={item.id}
                    item={item}
                    done={doneIds.has(item.id)}
                    onToggleDone={() => toggleDone(item.id)}
                  />
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
