import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./useAuth";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  if (state.status === "loading") return null;
  if (state.status === "unauthenticated") return <Navigate to="/login" replace />;
  return <>{children}</>;
}
