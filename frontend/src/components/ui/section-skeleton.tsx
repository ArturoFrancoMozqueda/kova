import { cn } from "@/lib/utils";
import { Skeleton } from "./skeleton";

/** A pending read occupies its own region; ready neighbouring content stays usable. */
export function SectionSkeleton({
  label,
  variant = "list",
  className,
}: {
  label: string;
  variant?: "list" | "chart" | "form" | "summary";
  className?: string;
}) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className={cn("space-y-4", className)}>
      <span className="sr-only">{label}</span>
      {variant === "chart" ? <Skeleton className="h-56 w-full" /> : variant === "summary" ? (
        <div className="grid grid-cols-3 gap-3" aria-hidden="true">
          {[0, 1, 2].map(index => <Skeleton key={index} className="h-12" />)}
        </div>
      ) : (
        <div className="space-y-4" aria-hidden="true">
          {[0, 1, 2].map(row => (
            <div key={row} className="space-y-2">
              <Skeleton className={cn("h-4 max-w-full", row === 1 ? "w-2/3" : "w-1/2")} />
              <Skeleton className={variant === "form" ? "h-11 w-full" : "h-4 w-full"} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
