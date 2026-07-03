import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { opsCopy } from "../copy";
import type { OpsStatus } from "../types";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "success" | "warning";

// Central mapping reused by KpiCard and tests.
export const STATUS_STYLE: Record<OpsStatus, { variant: BadgeVariant; label: string; className?: string }> = {
  ok: { variant: "success", label: opsCopy.status.ok },
  warning: { variant: "warning", label: opsCopy.status.warning },
  critical: { variant: "destructive", label: opsCopy.status.critical },
  // degraded is visually distinct from warning: amber outline, not filled.
  degraded: { variant: "warning", label: opsCopy.status.degraded, className: "border border-warning-foreground/40" },
  not_configured: { variant: "secondary", label: opsCopy.status.not_configured, className: "border-dashed border" },
};

export function StatusBadge({ status, className }: { status: OpsStatus; className?: string }) {
  const style = STATUS_STYLE[status];
  return (
    <Badge variant={style.variant} className={cn(style.className, className)}>
      {style.label}
    </Badge>
  );
}
