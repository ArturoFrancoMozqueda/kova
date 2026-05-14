import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { getSession, logout as apiLogout } from "./api";

export type AuthUser = {
  id: string;
  email: string;
  tenant_id: string;
  role: string;
};

type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; user: AuthUser; tenantId: string; tenantName: string };

type AuthContextValue = {
  state: AuthState;
  logout: () => Promise<void>;
  refresh: () => Promise<AuthState>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const session = await getSession();
      if (!session.authenticated) {
        const next: AuthState = { status: "unauthenticated" };
        setState(next);
        return next;
      }
      const next: AuthState = {
        status: "authenticated",
        user: session.user,
        tenantId: session.tenant_id,
        tenantName: session.tenant_name,
      };
      setState(next);
      return next;
    } catch {
      const next: AuthState = { status: "unauthenticated" };
      setState(next);
      return next;
    }
  }, []);

  useEffect(() => {
    if (state.status === "authenticated") {
      return;
    }
    const publicAuthRoutes = new Set(["/login", "/signup", "/verify-email"]);
    if (publicAuthRoutes.has(location.pathname)) {
      setState({ status: "unauthenticated" });
      return;
    }
    void refresh();
  }, [location.pathname, refresh, state.status]);

  const logout = useCallback(async () => {
    await apiLogout();
    setState({ status: "unauthenticated" });
  }, []);

  return <AuthContext.Provider value={{ state, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used within AuthProvider");
  return ctx;
}
