import { ShoppingCart } from "lucide-react";

import { copy } from "@/i18n/messages";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewEmpty, ViewError, ViewPermissionDenied } from "@/components/ui/view-states";

export function LoadingState() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index}>
            <CardContent className="p-5">
              <Skeleton className="mb-3 h-4 w-24" />
              <Skeleton className="h-7 w-28" />
              <Skeleton className="mt-2 h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="p-6">
          <Skeleton className="mb-4 h-5 w-40" />
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <ViewError
      message={copy.reportsView.loadError}
      onRetry={onRetry}
      retryLabel={copy.reportsView.retry}
    />
  );
}

export function EmptyBusinessState({ onPickToday }: { onPickToday?: () => void }) {
  return (
    <ViewEmpty
      icon={<ShoppingCart className="h-6 w-6" />}
      title={copy.reportsView.emptyStoryTitle}
      body={copy.reportsView.emptyStoryBody}
      primaryCta={{ label: copy.reportsView.emptyStoryCta, to: "/register" }}
      secondaryCta={
        onPickToday
          ? { label: copy.reportsView.emptyStorySecondaryCta, onClick: onPickToday }
          : undefined
      }
    />
  );
}

export function PermissionDenied() {
  return (
    <ViewPermissionDenied
      title={copy.reportsView.title}
      description={copy.reportsView.permissionHidden}
    />
  );
}
