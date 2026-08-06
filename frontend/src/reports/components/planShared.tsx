import { Link } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";

import { copy } from "@/i18n/messages";
import { cn } from "@/lib/utils";
import type { AnalysisHelpfulness } from "@/telemetry/funnel";
import type { RecommendationPriority } from "../utils/recommendations";

export function GoLink({ to, onClick }: { to: string; onClick?: () => void }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-kova-blue hover:underline"
    >
      {copy.reportsView.actionGoInventory}
      <ArrowRight className="h-3 w-3" aria-hidden />
    </Link>
  );
}

export function DoneToggle({
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

export function ActionFeedback({
  value,
  onSelect,
}: {
  value?: AnalysisHelpfulness;
  onSelect: (value: AnalysisHelpfulness) => void;
}) {
  return (
    <div className="mt-2 border-t border-kova-border pt-2">
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label={copy.reportsView.actionFeedbackQuestion}
      >
        <p className="text-xs text-kova-muted">{copy.reportsView.actionFeedbackQuestion}</p>
        <button
          type="button"
          aria-pressed={value === "helpful"}
          onClick={() => onSelect("helpful")}
          className={cn(
            "rounded-kova-sm border px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue focus-visible:ring-offset-2",
            value === "helpful"
              ? "border-kova-growth bg-kova-growth/10 text-kova-growth"
              : "border-kova-border bg-white text-kova-ink hover:border-kova-growth/50",
          )}
        >
          {copy.reportsView.actionFeedbackHelpful}
        </button>
        <button
          type="button"
          aria-pressed={value === "not_yet"}
          onClick={() => onSelect("not_yet")}
          className={cn(
            "rounded-kova-sm border px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue focus-visible:ring-offset-2",
            value === "not_yet"
              ? "border-kova-blue bg-kova-blue/10 text-kova-blue"
              : "border-kova-border bg-white text-kova-ink hover:border-kova-blue/50",
          )}
        >
          {copy.reportsView.actionFeedbackNotYet}
        </button>
      </div>
      {value ? (
        <p className="mt-1 text-xs text-kova-muted" role="status">
          {copy.reportsView.actionFeedbackSaved}
        </p>
      ) : null}
    </div>
  );
}
