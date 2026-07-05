import { AlertCircle, RefreshCw, ShieldOff, ShoppingCart } from "lucide-react";
import { Link as RouterLink } from "react-router-dom";

import { copy } from "@/i18n/messages";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

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
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <AlertCircle className="mb-3 h-10 w-10 text-destructive" />
        <p className="text-sm font-medium text-destructive" role="alert">
          {copy.reportsView.loadError}
        </p>
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {copy.reportsView.retry}
        </Button>
      </CardContent>
    </Card>
  );
}

export function EmptyBusinessState({ onPickToday }: { onPickToday?: () => void }) {
  return (
    <Card className="border-kova-blue/20 bg-kova-blue/[0.03]">
      <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-kova-blue/10">
          <ShoppingCart className="h-6 w-6 text-kova-blue" />
        </div>
        <div className="flex-1">
          <p className="text-base font-semibold">{copy.reportsView.emptyStoryTitle}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{copy.reportsView.emptyStoryBody}</p>
        </div>
        <div className="flex flex-wrap gap-2 sm:shrink-0">
          <RouterLink to="/register" className={buttonVariants({ size: "sm" })}>
            {copy.reportsView.emptyStoryCta}
          </RouterLink>
          {onPickToday ? (
            <Button variant="outline" size="sm" onClick={onPickToday}>
              {copy.reportsView.emptyStorySecondaryCta}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function PermissionDenied() {
  return (
    <main className="flex-1 p-6">
      <div className="mb-6 flex items-center gap-3">
        <ShieldOff className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{copy.reportsView.title}</h1>
          <p className="text-sm text-muted-foreground">{copy.reportsView.permissionHidden}</p>
        </div>
      </div>
    </main>
  );
}
