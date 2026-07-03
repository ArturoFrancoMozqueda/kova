import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { OpsStatus } from "../types";
import { Sparkline } from "./Sparkline";
import { StatusBadge } from "./StatusBadge";

export function KpiCard({
  label,
  value,
  status,
  hint,
  trend,
  className,
}: {
  label: string;
  value: ReactNode;
  status?: OpsStatus;
  hint?: string;
  trend?: number[];
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm text-kova-muted">{label}</p>
          {status ? <StatusBadge status={status} /> : null}
        </div>
        <div className="mt-2 flex items-end justify-between gap-2">
          <span className="text-2xl font-semibold tracking-tight text-kova-ink">{value}</span>
          {trend && trend.length > 1 ? (
            <Sparkline points={trend} className={cn("text-[color:var(--kova-blue)]")} />
          ) : null}
        </div>
        {hint ? <p className="mt-1 text-xs text-kova-muted">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
