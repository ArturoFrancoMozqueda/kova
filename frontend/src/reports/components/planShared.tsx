import { Link } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";

import { copy } from "@/i18n/messages";
import { cn } from "@/lib/utils";
import type { RecommendationPriority } from "../utils/recommendations";

export function GoLink({ to }: { to: string }) {
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
