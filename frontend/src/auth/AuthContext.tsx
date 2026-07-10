import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { clearCatalogCache } from "../offline/catalogCache";
import { getSession, logout as apiLogout, refreshSession } from "./api";

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
    const probe = async () => {
      try {
        return await getSession();
      } catch {
        return null;
      }
    };

    let session = await probe();
    // The access_token JWT has a short TTL (15 min). If it has expired
    // mid-session, /auth/session returns { authenticated: false } but the
    // refresh_token cookie is still valid. Try a single refresh before
    // declaring the user logged out — fixes BUG-005 (session loss between
    // /reports and /settings after a few minutes of activity).
    if (session && !session.authenticated) {
      const refreshed = await refreshSession().catch(() => false);
      if (refreshed) {
        session = await probe();
      }
    }

    if (!session || !session.authenticated) {
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

  // Global 401 interceptor: when an API call comes back unauthorized,
  // try to refresh the session once and retry the original request.
  // Skipped for auth endpoints themselves to avoid recursive loops.
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    let refreshPromise: Promise<boolean> | null = null;

    const shouldSkip = (url: string): boolean =>
      url.includes("/api/v1/auth/login") ||
      url.includes("/api/v1/auth/refresh") ||
      url.includes("/api/v1/auth/logout") ||
      url.includes("/api/v1/auth/session") ||
      url.includes("/api/v1/auth/signup");

    window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      if (response.status !== 401) return response;
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (!url.includes("/api/") || shouldSkip(url)) return response;

      // De-dupe concurrent refresh attempts.
      if (!refreshPromise) {
        refreshPromise = refreshSession().finally(() => {
          refreshPromise = null;
        });
      }
      const ok = await refreshPromise.catch(() => false);
      if (!ok) return response;
      // Retry the original request once with refreshed cookies.
      return originalFetch(input, init);
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    // Wipe the cached catalog so a different tenant on this device can never
    // read the previous tenant's products from IndexedDB. Best-effort:
    // logout must still complete if the cache clear fails.
    await clearCatalogCache().catch(() => undefined);
    setState({ status: "unauthenticated" });
  }, []);

  return <AuthContext.Provider value={{ state, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used within AuthProvider");
  return ctx;
}
