import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { getReceiptSettings } from "@/settings/api";
import { clearSentryIdentity, setSentryIdentity } from "../observability/sentry";
import { getSession, logout as apiLogout, refreshSession } from "./api";
import { normalizeFeatureFlags, type FeatureFlags } from "./featureFlags";
import { setActiveOfflineTenant } from "@/offline/activeTenant";
import { captureApiRequestId, clearLatestRequestId } from "@/lib/supportContext";

export type AuthUser = {
  id: string;
  email: string;
  tenant_id: string;
  role: string;
  /** Unverified accounts can sign in and operate the register, but cannot start
   * a subscription. Optional so a session probe served by an older backend
   * reads as verified instead of nagging a confirmed account. */
  email_verified?: boolean;
};

type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | {
      status: "authenticated";
      user: AuthUser;
      tenantId: string;
      tenantName: string;
      tenantLogoUrl: string | null;
      featureFlags: FeatureFlags;
    };

type AuthContextValue = {
  state: AuthState;
  logout: () => Promise<void>;
  refresh: () => Promise<AuthState>;
  setTenantLogoUrl: (logoUrl: string | null) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const authenticatedTenantId = state.status === "authenticated" ? state.tenantId : null;

  useEffect(() => {
    setActiveOfflineTenant(authenticatedTenantId);
    clearLatestRequestId();
    return () => {
      setActiveOfflineTenant(null);
      clearLatestRequestId();
    };
  }, [authenticatedTenantId]);

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
      clearSentryIdentity();
      const next: AuthState = { status: "unauthenticated" };
      setState(next);
      return next;
    }
    setSentryIdentity(session.user);
    const next: AuthState = {
      status: "authenticated",
      user: session.user,
      tenantId: session.tenant_id,
      tenantName: session.tenant_name,
      tenantLogoUrl: null,
      featureFlags: normalizeFeatureFlags(session.feature_flags),
    };
    setState(next);

    // Branding should not delay the authenticated shell. Load it after the
    // session is ready and only apply it if this is still the active tenant.
    void getReceiptSettings()
      .then((settings) => {
        setState((current) =>
          current.status === "authenticated" && current.tenantId === session.tenant_id
            ? { ...current, tenantLogoUrl: settings.logo_url }
            : current,
        );
      })
      .catch(() => undefined);
    return next;
  }, []);

  const setTenantLogoUrl = useCallback((logoUrl: string | null) => {
    setState((current) =>
      current.status === "authenticated" ? { ...current, tenantLogoUrl: logoUrl } : current,
    );
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
      captureApiRequestId(input, response);
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
      const retriedResponse = await originalFetch(input, init);
      captureApiRequestId(input, retriedResponse);
      return retriedResponse;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    clearLatestRequestId();
    // Wipe the cached catalog so a different tenant on this device can never
    // read the previous tenant's products from IndexedDB. Best-effort:
    // logout must still complete if the cache clear fails. Imported on demand
    // so dexie (the vendor-offline chunk) stays out of the eager bundle that
    // every landing visitor downloads.
    await import("../offline/catalogCache")
      .then(({ clearCatalogCache }) => clearCatalogCache())
      .catch(() => undefined);
    await import("../customerOrders/cache")
      .then(({ clearCustomerOrderCache }) => clearCustomerOrderCache())
      .catch(() => undefined);
    clearSentryIdentity();
    setState({ status: "unauthenticated" });
  }, []);

  return (
    <AuthContext.Provider value={{ state, logout, refresh, setTenantLogoUrl }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used within AuthProvider");
  return ctx;
}

/** Auth state when it happens to be available, `null` otherwise.
 *
 * For views that only *decorate* with identity — showing a verification notice,
 * disabling a paid CTA — rather than depending on it. Those should degrade, not
 * crash, when rendered outside a provider (isolated tests, storybook-style
 * previews). Anything that gates access must keep using `useAuthContext`. */
export function useOptionalAuthContext(): AuthContextValue | null {
  return useContext(AuthContext);
}
