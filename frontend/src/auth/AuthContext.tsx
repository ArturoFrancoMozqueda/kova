import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { getReceiptSettings } from "@/settings/api";
import {
  clearErrorReportingIdentity,
  setErrorReportingIdentity,
} from "@/observability/errorReporting";
import { ApiError, getSession, logout as apiLogout, refreshSession } from "./api";
import { normalizeFeatureFlags, type FeatureFlags } from "./featureFlags";
import { setActiveOfflineTenant } from "@/offline/activeTenant";
import { captureApiRequestId, clearLatestRequestId } from "@/lib/supportContext";
import { queryClient } from "@/lib/queryClient";
import { setReportsCacheIdentity } from "@/reports/api";
import { setBillingCacheIdentity } from "@/billing/api";
import {
  announceSessionChange,
  clearLogoutPending,
  hasLogoutPending,
  markLogoutPending,
  onSessionChange,
} from "./sessionCoordination";

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

export type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | {
      status: "unavailable";
      reason:
        | "network"
        | "offline_access_expired"
        | "offline_not_prepared"
        | "offline_logout_storage";
    }
  | {
      status: "authenticated";
      user: AuthUser;
      tenantId: string;
      tenantName: string;
      tenantLogoUrl: string | null;
      featureFlags: FeatureFlags;
      sessionMode: "online" | "offline";
    };

type AuthContextValue = {
  state: AuthState;
  logout: () => Promise<void>;
  refresh: () => Promise<AuthState>;
  setTenantLogoUrl: (logoUrl: string | null) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function clearLocalIdentityData(): Promise<void> {
  const [{ clearCatalogCache }, { clearCustomerOrderCache }, { clearOfflineAccess }] =
    await Promise.all([
      import("../offline/catalogCache"),
      import("../customerOrders/cache"),
      import("../offline/offlineAccess"),
    ]);
  // Start every erasure before awaiting the aggregate so a failure in one
  // store does not prevent best-effort cleanup of the others.
  await Promise.all([
    clearCatalogCache(),
    clearCustomerOrderCache(),
    clearOfflineAccess(),
  ]);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const stateRef = useRef<AuthState>(state);
  const refreshEpoch = useRef(0);
  const initialProbeStarted = useRef(false);
  const identityChangePending = useRef(false);
  const authenticatedTenantId = state.status === "authenticated" ? state.tenantId : null;

  const applyState = useCallback((next: AuthState) => {
    const cacheIdentity = next.status === "authenticated" && next.sessionMode === "online"
      ? { tenantId: next.tenantId, userId: next.user.id, role: next.user.role }
      : null;
    setReportsCacheIdentity(cacheIdentity);
    setBillingCacheIdentity(cacheIdentity);
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => () => {
    setReportsCacheIdentity(null);
    setBillingCacheIdentity(null);
  }, []);

  useEffect(() => {
    setActiveOfflineTenant(authenticatedTenantId);
    clearLatestRequestId();
    return () => {
      setActiveOfflineTenant(null);
      clearLatestRequestId();
    };
  }, [authenticatedTenantId]);

  const refreshInternal = useCallback(async (
    allowOfflineFallback: boolean,
    preserveCurrentOnUnavailable = false,
  ): Promise<AuthState> => {
    const epoch = ++refreshEpoch.current;
    const commit = (next: AuthState) => {
      if (refreshEpoch.current === epoch) {
        identityChangePending.current = false;
        applyState(next);
      }
      return next;
    };
    if (hasLogoutPending()) {
      let serverSessionCleared = false;
      try {
        await apiLogout();
        serverSessionCleared = true;
      } catch {
        // Keep local access closed. The marker retries revocation after the
        // next successful login/network opportunity.
      }
      try {
        await clearLocalIdentityData();
      } catch {
        // The durable logout marker remains set. Do not read the cached
        // identity again until its stores can be erased successfully.
        clearErrorReportingIdentity();
        return commit({ status: "unavailable", reason: "offline_logout_storage" });
      }
      if (serverSessionCleared) clearLogoutPending();
      clearErrorReportingIdentity();
      return commit({ status: "unauthenticated" });
    }
    const unavailable = async (error: unknown): Promise<AuthState> => {
      if (preserveCurrentOnUnavailable && stateRef.current.status === "authenticated") {
        return stateRef.current;
      }
      const networkUnavailable = !(error instanceof ApiError);
      if (allowOfflineFallback && networkUnavailable) {
        const { readPreparedOfflineAccess } = await import("@/offline/offlineAccess");
        const cached = await readPreparedOfflineAccess().catch(() => ({ status: "missing" as const }));
        if (cached.status === "ready") {
          const next: AuthState = {
            status: "authenticated",
            user: { ...cached.snapshot.user, email: "" },
            tenantId: cached.snapshot.tenant_id,
            tenantName: cached.snapshot.tenant_name,
            tenantLogoUrl: null,
            featureFlags: normalizeFeatureFlags(cached.snapshot.feature_flags),
            sessionMode: "offline",
          };
          clearErrorReportingIdentity();
          return commit(next);
        }
        return commit({
          status: "unavailable",
          reason: cached.status === "expired"
            ? "offline_access_expired"
            : cached.status === "not_prepared"
              ? "offline_not_prepared"
              : "network",
        });
      }
      clearErrorReportingIdentity();
      return commit({ status: "unavailable", reason: "network" });
    };

    let session;
    try {
      session = await getSession();
    } catch (error) {
      return unavailable(error);
    }
    // The access_token JWT has a short TTL (15 min). If it has expired
    // mid-session, /auth/session returns { authenticated: false } but the
    // refresh_token cookie is still valid. Try a single refresh before
    // declaring the user logged out — fixes BUG-005 (session loss between
    // /reports and /settings after a few minutes of activity).
    if (session && !session.authenticated) {
      let refreshed: boolean;
      try {
        refreshed = await refreshSession();
      } catch (error) {
        return unavailable(error);
      }
      if (refreshed) {
        try {
          session = await getSession();
        } catch (error) {
          return unavailable(error);
        }
      }
    }

    if (!session.authenticated) {
      await import("@/offline/offlineAccess")
        .then(({ clearOfflineAccess }) => clearOfflineAccess())
        .catch(() => undefined);
      clearErrorReportingIdentity();
      const next: AuthState = { status: "unauthenticated" };
      return commit(next);
    }
    setErrorReportingIdentity(session.user);
    const next: AuthState = {
      status: "authenticated",
      user: session.user,
      tenantId: session.tenant_id,
      tenantName: session.tenant_name,
      tenantLogoUrl: null,
      featureFlags: normalizeFeatureFlags(session.feature_flags),
      sessionMode: "online",
    };
    const previous = stateRef.current;
    if (
      previous.status === "authenticated" &&
      (previous.tenantId !== session.tenant_id || previous.user.id !== session.user.id)
    ) {
      queryClient.clear();
    }
    await import("@/offline/offlineAccess")
      .then(({ cacheVerifiedOfflineAccess }) => cacheVerifiedOfflineAccess({
        tenant_id: session.tenant_id,
        tenant_name: session.tenant_name,
        user: session.user,
        feature_flags: session.feature_flags,
      }))
      .catch(() => undefined);
    commit(next);

    // Branding should not delay the authenticated shell. Load it after the
    // session is ready and only apply it if this is still the active tenant.
    void getReceiptSettings()
      .then((settings) => {
        setState((current) => {
          const branded =
            current.status === "authenticated" && current.tenantId === session.tenant_id
              ? { ...current, tenantLogoUrl: settings.logo_url }
              : current;
          stateRef.current = branded;
          return branded;
        });
      })
      .catch(() => undefined);
    return next;
  }, [applyState]);

  const refresh = useCallback(() => refreshInternal(true), [refreshInternal]);

  const setTenantLogoUrl = useCallback((logoUrl: string | null) => {
    setState((current) => {
      const next = current.status === "authenticated"
        ? { ...current, tenantLogoUrl: logoUrl }
        : current;
      stateRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    if (state.status === "authenticated") return;
    const publicAuthRoutes = new Set(["/login", "/signup", "/verify-email"]);
    if (publicAuthRoutes.has(location.pathname)) {
      if (state.status !== "unauthenticated") applyState({ status: "unauthenticated" });
      return;
    }
    if (state.status === "loading" && !initialProbeStarted.current) {
      initialProbeStarted.current = true;
      void refresh();
    }
  }, [applyState, location.pathname, refresh, state.status]);

  // Login/logout cookies are shared by every tab. Suspend this tab's old
  // tenant immediately, then accept only a fresh server probe. The offline
  // fallback is deliberately disabled for this path: another tab just told us
  // the shared cookie identity may have changed.
  useEffect(() => onSessionChange(() => {
    if (stateRef.current.status !== "authenticated") return;
    identityChangePending.current = true;
    refreshEpoch.current += 1;
    applyState({ status: "loading" });
    setActiveOfflineTenant(null);
    queryClient.clear();
    void refreshInternal(false);
  }), [applyState, refreshInternal]);

  useEffect(() => {
    const revalidate = () => {
      if (stateRef.current.status !== "authenticated") return;
      // Keep the current form mounted while the probe is pending. Every
      // mutation still carries its expected identity, so the server blocks a
      // stale tab even during this small focus/reconnect window.
      void refreshInternal(false, true);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    window.addEventListener("online", revalidate);
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", revalidate);
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshInternal]);

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
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const unsafeApiRequest = url.includes("/api/") && ["POST", "PUT", "PATCH", "DELETE"].includes(method) && !shouldSkip(url);
      let requestInit = init;
      if (unsafeApiRequest) {
        if (identityChangePending.current) {
          throw new TypeError("La sesión cambió. Kova está verificando el negocio activo.");
        }
        const identity = stateRef.current;
        if (identity.status === "authenticated" && identity.sessionMode === "offline") {
          throw new TypeError("La sesión debe validarse en línea antes de enviar cambios.");
        }
        if (identity.status === "authenticated") {
          const headers = new Headers(input instanceof Request ? input.headers : undefined);
          new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
          headers.set("X-Kova-Expected-Tenant", identity.tenantId);
          headers.set("X-Kova-Expected-User", identity.user.id);
          requestInit = { ...init, headers };
        }
      }

      const response = await originalFetch(input, requestInit);
      captureApiRequestId(input, response);
      if (response.headers.get("X-Kova-Identity-Mismatch") === "true") {
        identityChangePending.current = true;
        refreshEpoch.current += 1;
        applyState({ status: "loading" });
        setActiveOfflineTenant(null);
        queryClient.clear();
        void refreshInternal(false);
        throw new TypeError("La sesión cambió. Kova está verificando el negocio activo.");
      }
      if (response.status !== 401) return response;
      if (!url.includes("/api/") || shouldSkip(url)) return response;

      // De-dupe concurrent refresh attempts.
      if (!refreshPromise) {
        refreshPromise = refreshSession().finally(() => {
          refreshPromise = null;
        });
      }
      const ok = await refreshPromise;
      if (!ok) return response;
      // Retry the original request once with refreshed cookies.
      const retriedResponse = await originalFetch(input, requestInit);
      captureApiRequestId(input, retriedResponse);
      return retriedResponse;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [applyState, refreshInternal]);

  const logout = useCallback(async () => {
    identityChangePending.current = true;
    markLogoutPending();
    try {
      await clearLocalIdentityData();
    } catch (error) {
      // Never claim logout on a shared device while a verified identity can
      // still be reopened from durable storage. The current tab stays in its
      // existing state and the operator gets an explicit retry message.
      identityChangePending.current = false;
      throw error;
    }
    try {
      await apiLogout();
      clearLogoutPending();
    } catch {
      // Offline logout must still remove locally cached access on a shared
      // device. The marker prevents a later reload from trusting old cookies
      // and retries server revocation when the network is available.
    }
    clearLatestRequestId();
    clearErrorReportingIdentity();
    queryClient.clear();
    identityChangePending.current = false;
    applyState({ status: "unauthenticated" });
    announceSessionChange();
  }, [applyState]);

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
