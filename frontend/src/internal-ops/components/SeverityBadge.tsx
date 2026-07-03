import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { opsCopy } from "../copy";
import type { IncidentSeverity } from "../types";

const SEVERITY_STYLE: Record<
  IncidentSeverity,
  { variant: "destructive" | "warning" | "secondary"; label: string; className?: string }
> = {
  critical: { variant: "destructive", label: opsCopy.severity.critical },
  warning: { variant: "warning", label: opsCopy.severity.warning },
  info: { variant: "secondary", label: opsCopy.severity.info },
};

export function SeverityBadge({ severity, className }: { severity: IncidentSeverity; className?: string }) {
  const style = SEVERITY_STYLE[severity];
  return (
    <Badge variant={style.variant} className={cn(style.className, className)}>
      {style.label}
    </Badge>
  );
}
