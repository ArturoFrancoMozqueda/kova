import { lazy, Suspense, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { ApiError } from "./api";
import { useOpsMe } from "./hooks";

const NotFound = lazy(() => import("@/routes/NotFound"));

/**
 * Gate for /internal/ops. Real authorization is server-side (every ops endpoint
 * enforces the allowlist); this is UX only. On 403 we render NotFound rather
 * than redirect so the route's existence isn't revealed to tenant users who
 * guess it. Fail closed: any unexpected error renders NotFound, never content.
 */
export default function RequireInternalAdmin({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const me = useOpsMe(state.status === "authenticated");

  if (state.status === "loading") return null;
  if (state.status === "unauthenticated") return <Navigate to="/login" replace />;
  if (me.isPending) return null;
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <Navigate to="/login" replace />;
    }
    return (
      <Suspense fallback={null}>
        <NotFound />
      </Suspense>
    );
  }
  return <>{children}</>;
}
