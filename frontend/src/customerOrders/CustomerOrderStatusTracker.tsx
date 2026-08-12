import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { orderedStatuses, statusLabels } from "./labels";
import type { CustomerOrderStatus } from "./types";

export function CustomerOrderStatusTracker({ status }: { status: CustomerOrderStatus }) {
  if (status === "cancelled") {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">
        Pedido cancelado
      </div>
    );
  }
  const activeIndex = orderedStatuses.indexOf(status);
  return (
    <ol className="grid grid-cols-5 gap-1" aria-label="Progreso del pedido">
      {orderedStatuses.map((step, index) => {
        const complete = index < activeIndex;
        const active = index === activeIndex;
        return (
          <li key={step} className="min-w-0">
            <div className="mb-2 flex items-center">
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs",
                  complete && "border-kova-growth bg-kova-growth text-white",
                  active && "border-primary bg-primary text-primary-foreground",
                  !complete && !active && "border-border bg-background text-muted-foreground",
                )}
                aria-current={active ? "step" : undefined}
              >
                {complete ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-2.5 w-2.5" />}
              </span>
              {index < orderedStatuses.length - 1 ? (
                <span className={cn("h-px flex-1", index < activeIndex ? "bg-kova-growth" : "bg-border")} />
              ) : null}
            </div>
            <span className={cn("block truncate text-[10px] sm:text-xs", active ? "font-semibold text-foreground" : "text-muted-foreground")}>
              {statusLabels[step]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
