import type { ReactNode } from "react";
import { LivePulse } from "@/components/brand/RealTime";
import { opsCopy } from "../copy";
import { formatRelative } from "../format";

export function PageHeader({
  title,
  updatedAt,
  children,
}: {
  title: string;
  updatedAt?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold tracking-tight text-kova-ink">{title}</h1>
      <div className="flex items-center gap-3">
        {updatedAt ? (
          <span className="flex items-center gap-1.5 text-xs text-kova-muted">
            <LivePulse label="en vivo" />
            {opsCopy.common.updatedAt} {formatRelative(updatedAt)}
          </span>
        ) : null}
        {children}
      </div>
    </div>
  );
}
