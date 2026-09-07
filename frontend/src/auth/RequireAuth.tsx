import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { RouteFallback } from "@/components/ui/route-fallback";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { WifiOff } from "lucide-react";
import { copy } from "@/i18n/messages";
import { useAuth } from "./useAuth";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { state, refresh } = useAuth();
  if (state.status === "loading") return <RouteFallback />;
  if (state.status === "unauthenticated") return <Navigate to="/login" replace />;
  if (state.status === "unavailable") {
    const body = state.reason === "offline_access_expired"
      ? copy.auth.offlineAccessExpired
      : state.reason === "offline_not_prepared"
        ? copy.auth.offlineAccessNotPrepared
        : copy.auth.offlineAccessUnavailable;
    return (
      <main className="grid min-h-screen place-items-center bg-kova-mist p-6">
        <Card className="w-full max-w-lg">
          <CardContent className="flex flex-col items-center p-8 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-warning/10 text-warning-strong">
              <WifiOff className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-semibold text-kova-ink">{copy.auth.offlineAccessTitle}</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground" role="alert">{body}</p>
            <Button className="mt-5" onClick={() => void refresh()}>{copy.auth.retrySession}</Button>
          </CardContent>
        </Card>
      </main>
    );
  }
  if (
    state.sessionMode === "offline" &&
    !["/register", "/caja", "/sync-queue"].includes(location.pathname)
  ) {
    return <Navigate to="/register" replace />;
  }
  return <>{children}</>;
}
