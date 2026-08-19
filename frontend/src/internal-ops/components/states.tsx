import { Card, CardContent } from "@/components/ui/card";
import { opsCopy } from "../copy";
import { StatusBadge } from "./StatusBadge";

// Convention borrowed from reports: dashed border + muted bg for empty regions.
export function SectionEmptyState({ label = opsCopy.common.empty }: { label?: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-sm text-muted-foreground">
      {label}
    </div>
  );
}

export function NotConfiguredCard({ label }: { label?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-6">
        <p className="text-sm text-muted-foreground">{label ?? opsCopy.common.notConfigured}</p>
        <StatusBadge status="not_configured" />
      </CardContent>
    </Card>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-kova-danger/40 bg-kova-danger/5 p-6 text-sm">
      <p className="text-kova-ink">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 text-sm font-medium text-[color:var(--kova-blue)] hover:underline"
      >
        {opsCopy.common.retry}
      </button>
    </div>
  );
}
