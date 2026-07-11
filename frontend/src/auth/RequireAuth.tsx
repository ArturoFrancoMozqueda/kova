import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { RouteFallback } from "@/components/ui/route-fallback";
import { useAuth } from "./useAuth";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  if (state.status === "loading") return <RouteFallback />;
  if (state.status === "unauthenticated") return <Navigate to="/login" replace />;
  return <>{children}</>;
}
