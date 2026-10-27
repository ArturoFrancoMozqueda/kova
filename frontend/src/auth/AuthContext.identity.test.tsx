import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, useEffect, useState } from "react";
import { queryClient } from "@/lib/queryClient";
import { OFFLINE_ACCESS_MAX_AGE_MS } from "@/offline/accessPolicy";

const coordination = vi.hoisted(() => ({
  listener: null as null | (() => void),
  logoutPending: false,
}));
const offlineAccess = vi.hoisted(() => ({
  cache: vi.fn(),
  clear: vi.fn(),
  read: vi.fn(),
}));
const localCaches = vi.hoisted(() => ({
  clearCatalog: vi.fn(),
  clearCustomerOrders: vi.fn(),
}));
const reportIdentity = vi.hoisted(() => vi.fn());
vi.mock("@/reports/api", () => ({ setReportsCacheIdentity: reportIdentity }));
const billingIdentity = vi.hoisted(() => vi.fn());
const billingSubscription = vi.hoisted(() => vi.fn());
vi.mock("@/billing/api", () => ({ setBillingCacheIdentity: billingIdentity, getBillingSubscription: billingSubscription }));

vi.mock("./api", () => ({
  ApiError: class ApiError extends Error {},
  getSession: vi.fn(),
  logout: vi.fn(),
  refreshSession: vi.fn(),
}));
vi.mock("./sessionCoordination", () => ({
  announceSessionChange: vi.fn(),
  clearLogoutPending: vi.fn(),
  hasLogoutPending: vi.fn(() => coordination.logoutPending),
  markLogoutPending: vi.fn(),
  onSessionChange: (listener: () => void) => {
    coordination.listener = listener;
    return () => { coordination.listener = null; };
  },
}));
vi.mock("@/offline/offlineAccess", () => ({
  cacheVerifiedOfflineAccess: offlineAccess.cache,
  clearOfflineAccess: offlineAccess.clear,
  readPreparedOfflineAccess: offlineAccess.read,
}));
vi.mock("@/offline/catalogCache", () => ({
  clearCatalogCache: localCaches.clearCatalog,
}));
vi.mock("@/customerOrders/cache", () => ({
  clearCustomerOrderCache: localCaches.clearCustomerOrders,
}));
vi.mock("@/settings/api", () => ({
  getReceiptSettings: vi.fn().mockResolvedValue({ logo_url: null }),
}));

import { getSession, logout as apiLogout, refreshSession } from "./api";
import { AuthProvider, useAuthContext } from "./AuthContext";
import { TrialChip } from "@/billing/TrialChip";

const session = (tenantId: string, userId: string, role = "owner") => ({
  authenticated: true as const,
  user: {
    id: userId,
    email: `${userId}@example.com`,
    tenant_id: tenantId,
    role,
  },
  tenant_id: tenantId,
  tenant_name: `Negocio ${tenantId}`,
  feature_flags: {},
});

function Probe() {
  const { state, logout } = useAuthContext();
  return (
    <div>
      {state.status === "authenticated"
        ? `${state.tenantId}:${state.user.id}:${state.sessionMode}`
        : state.status}
      {state.status === "authenticated" && state.commercialAccess?.allowed === false && <p>Acceso comercial bloqueado</p>}
      <button type="button" onClick={() => void logout().catch(() => undefined)}>
        logout-probe
      </button>
    </div>
  );
}

function StatefulProbe({ onMount, onUnmount }: { onMount: () => void; onUnmount: () => void }) {
  const { state, refresh, logout, setTenantLogoUrl } = useAuthContext();
  const [draft, setDraft] = useState(0);
  useEffect(() => {
    onMount();
    return onUnmount;
  }, [onMount, onUnmount]);
  return <div>
    <p>{state.status === "authenticated" ? `${state.tenantId}:${state.user.id}:${state.user.role}:${state.sessionMode}` : state.status}</p>
    <p data-testid="draft">{draft}</p>
    <button onClick={() => setDraft((value) => value + 1)}>edit-draft</button>
    <button onClick={() => void refresh()}>refresh-probe</button>
    <button onClick={() => void logout()}>logout-probe</button>
    <button onClick={() => setTenantLogoUrl("/brand/logo.png")}>change-logo</button>
  </div>;
}

describe("AuthProvider identity continuity", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    coordination.listener = null;
    coordination.logoutPending = false;
    offlineAccess.cache.mockReset().mockResolvedValue(undefined);
    offlineAccess.clear.mockReset().mockResolvedValue(undefined);
    offlineAccess.read.mockReset();
    localCaches.clearCatalog.mockReset().mockResolvedValue(undefined);
    localCaches.clearCustomerOrders.mockReset().mockResolvedValue(undefined);
    vi.mocked(getSession).mockReset();
    vi.mocked(refreshSession).mockReset();
    vi.mocked(apiLogout).mockReset().mockResolvedValue(undefined);
    reportIdentity.mockReset();
    billingIdentity.mockReset();
    billingSubscription.mockReset();
  });

  it.each([
    ["tenant", session("tenant-b", "user-a")],
    ["user", session("tenant-a", "user-b")],
    ["role", session("tenant-a", "user-a", "manager")],
  ])("discards all child snapshots and query data when the verified %s changes", async (_change, next) => {
    vi.mocked(getSession).mockResolvedValueOnce(session("tenant-a", "user-a")).mockResolvedValueOnce(next);
    const onMount = vi.fn();
    const onUnmount = vi.fn();
    render(<MemoryRouter initialEntries={["/register"]}><AuthProvider>
      <StatefulProbe onMount={onMount} onUnmount={onUnmount} />
    </AuthProvider></MemoryRouter>);
    await screen.findByText("tenant-a:user-a:owner:online");
    await waitFor(() => expect(onMount).toHaveBeenCalledTimes(2));
    const mounts = onMount.mock.calls.length;
    const unmounts = onUnmount.mock.calls.length;
    queryClient.setQueryData(["private-snapshot"], { tenantId: "tenant-a" });
    act(() => screen.getByRole("button", { name: "edit-draft" }).click());
    expect(screen.getByTestId("draft")).toHaveTextContent("1");
    act(() => screen.getByRole("button", { name: "refresh-probe" }).click());
    await screen.findByText(`${next.tenant_id}:${next.user.id}:${next.user.role}:online`);
    expect(screen.getByTestId("draft")).toHaveTextContent("0");
    expect(onMount).toHaveBeenCalledTimes(mounts + 1);
    expect(onUnmount).toHaveBeenCalledTimes(unmounts + 1);
    expect(queryClient.getQueryData(["private-snapshot"])).toBeUndefined();
  });

  it("preserves child state through same-identity refresh, branding and online/offline changes", async () => {
    const original = session("tenant-a", "user-a");
    vi.mocked(getSession)
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce({ ...original, tenant_name: "Nuevo nombre" })
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(original);
    offlineAccess.read.mockResolvedValue({ status: "ready", snapshot: {
      ...original, user: { id: "user-a", tenant_id: "tenant-a", role: "owner" },
    } });
    const onMount = vi.fn();
    const onUnmount = vi.fn();
    render(<MemoryRouter initialEntries={["/register"]}><AuthProvider>
      <StatefulProbe onMount={onMount} onUnmount={onUnmount} />
    </AuthProvider></MemoryRouter>);
    await screen.findByText("tenant-a:user-a:owner:online");
    const mounts = onMount.mock.calls.length;
    const unmounts = onUnmount.mock.calls.length;
    act(() => screen.getByRole("button", { name: "edit-draft" }).click());
    act(() => screen.getByRole("button", { name: "refresh-probe" }).click());
    await waitFor(() => expect(offlineAccess.cache).toHaveBeenCalledTimes(2));
    act(() => screen.getByRole("button", { name: "change-logo" }).click());
    expect(screen.getByTestId("draft")).toHaveTextContent("1");
    act(() => screen.getByRole("button", { name: "refresh-probe" }).click());
    await screen.findByText("tenant-a:user-a:owner:offline");
    expect(screen.getByTestId("draft")).toHaveTextContent("1");
    act(() => screen.getByRole("button", { name: "refresh-probe" }).click());
    await screen.findByText("tenant-a:user-a:owner:online");
    expect(screen.getByTestId("draft")).toHaveTextContent("1");
    expect(onMount).toHaveBeenCalledTimes(mounts);
    expect(onUnmount).toHaveBeenCalledTimes(unmounts);
  });

  it("does not cache a superseded session or clear the newer identity's queries", async () => {
    let resolveStale!: (value: ReturnType<typeof session>) => void;
    vi.mocked(getSession)
      .mockResolvedValueOnce(session("tenant-a", "user-a"))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }))
      .mockResolvedValueOnce(session("tenant-b", "user-b"));
    render(<MemoryRouter initialEntries={["/register"]}><AuthProvider>
      <StatefulProbe onMount={vi.fn()} onUnmount={vi.fn()} />
    </AuthProvider></MemoryRouter>);
    await screen.findByText("tenant-a:user-a:owner:online");
    act(() => screen.getByRole("button", { name: "refresh-probe" }).click());
    act(() => screen.getByRole("button", { name: "refresh-probe" }).click());
    await screen.findByText("tenant-b:user-b:owner:online");
    queryClient.setQueryData(["current-private-snapshot"], { tenantId: "tenant-b" });
    await act(async () => { resolveStale(session("tenant-a", "user-a")); });
    expect(offlineAccess.cache).toHaveBeenCalledTimes(2);
    expect(offlineAccess.cache).toHaveBeenLastCalledWith(expect.objectContaining({ tenant_id: "tenant-b" }));
    expect(queryClient.getQueryData(["current-private-snapshot"])).toEqual({ tenantId: "tenant-b" });
    expect(screen.getByText("tenant-b:user-b:owner:online")).toBeVisible();
  });

  it("does not reopen a logged-out identity when an earlier session probe finishes", async () => {
    let resolveStale!: (value: ReturnType<typeof session>) => void;
    vi.mocked(getSession)
      .mockResolvedValueOnce(session("tenant-a", "user-a"))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }));
    render(<MemoryRouter initialEntries={["/register"]}><AuthProvider>
      <StatefulProbe onMount={vi.fn()} onUnmount={vi.fn()} />
    </AuthProvider></MemoryRouter>);
    await screen.findByText("tenant-a:user-a:owner:online");
    act(() => screen.getByRole("button", { name: "refresh-probe" }).click());
    act(() => screen.getByRole("button", { name: "logout-probe" }).click());
    await screen.findByText("unauthenticated");
    await act(async () => { resolveStale(session("tenant-a", "user-a")); });
    expect(screen.getByText("unauthenticated")).toBeVisible();
    expect(offlineAccess.cache).toHaveBeenCalledOnce();
    expect(reportIdentity).toHaveBeenLastCalledWith(null);
    expect(billingIdentity).toHaveBeenLastCalledWith(null);
  });

  it("does not cache a session response after the provider unmounts", async () => {
    let resolveStale!: (value: ReturnType<typeof session>) => void;
    vi.mocked(getSession).mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }));
    const view = render(<MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter>);
    view.unmount();
    await act(async () => { resolveStale(session("tenant-a", "user-a")); });
    expect(offlineAccess.cache).not.toHaveBeenCalled();
    expect(reportIdentity).toHaveBeenLastCalledWith(null);
    expect(billingIdentity).toHaveBeenLastCalledWith(null);
  });

  it("restarts the initial probe during StrictMode replay and caches only the current response", async () => {
    vi.mocked(getSession).mockResolvedValue(session("tenant-a", "user-a"));
    render(<StrictMode><MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter></StrictMode>);
    await screen.findByText("tenant-a:user-a:online");
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(offlineAccess.cache).toHaveBeenCalledOnce();
  });

  it("discards child snapshots on logout and does not restore them on the next login", async () => {
    vi.mocked(getSession).mockResolvedValue(session("tenant-a", "user-a"));
    const onMount = vi.fn();
    const onUnmount = vi.fn();
    render(<MemoryRouter initialEntries={["/register"]}><AuthProvider>
      <StatefulProbe onMount={onMount} onUnmount={onUnmount} />
    </AuthProvider></MemoryRouter>);
    await screen.findByText("tenant-a:user-a:owner:online");
    act(() => screen.getByRole("button", { name: "edit-draft" }).click());
    expect(screen.getByTestId("draft")).toHaveTextContent("1");
    act(() => screen.getByRole("button", { name: "logout-probe" }).click());
    await screen.findByText("unauthenticated");
    expect(screen.getByTestId("draft")).toHaveTextContent("0");
    expect(billingIdentity).toHaveBeenLastCalledWith(null);
    act(() => screen.getByRole("button", { name: "refresh-probe" }).click());
    await screen.findByText("tenant-a:user-a:owner:online");
    expect(screen.getByTestId("draft")).toHaveTextContent("0");
  });

  it("suspends a stale tab and adopts only the freshly probed cookie identity", async () => {
    const networkFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    window.fetch = networkFetch;
    vi.mocked(getSession).mockResolvedValueOnce(session("tenant-a", "user-a"));
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <AuthProvider><Probe /></AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText("tenant-a:user-a:online")).toBeVisible();
    expect(reportIdentity).toHaveBeenLastCalledWith({ tenantId: "tenant-a", userId: "user-a", role: "owner" });
    expect(billingIdentity).toHaveBeenLastCalledWith({ tenantId: "tenant-a", userId: "user-a", role: "owner" });

    let resolveProbe!: (value: ReturnType<typeof session>) => void;
    vi.mocked(getSession).mockImplementationOnce(() => new Promise((resolve) => {
      resolveProbe = resolve;
    }));
    act(() => coordination.listener?.());
    expect(screen.getByText("loading")).toBeVisible();
    expect(reportIdentity).toHaveBeenLastCalledWith(null);
    expect(billingIdentity).toHaveBeenLastCalledWith(null);
    await expect(window.fetch("/api/v1/orders", { method: "POST" })).rejects.toThrow(
      /verificando el negocio activo/i,
    );
    expect(networkFetch).not.toHaveBeenCalled();

    resolveProbe(session("tenant-b", "user-b", "cashier"));
    expect(await screen.findByText("tenant-b:user-b:online")).toBeVisible();
    expect(reportIdentity).toHaveBeenLastCalledWith({ tenantId: "tenant-b", userId: "user-b", role: "cashier" });
    expect(billingIdentity).toHaveBeenLastCalledWith({ tenantId: "tenant-b", userId: "user-b", role: "cashier" });
  });

  it("opens only the prepared tenant in local mode when the session endpoint is offline", async () => {
    vi.mocked(getSession).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    offlineAccess.read.mockResolvedValue({
      status: "ready",
      snapshot: {
        id: "active",
        ...session("tenant-a", "user-a"),
        user: {
          id: "user-a",
          tenant_id: "tenant-a",
          role: "owner",
        },
        verified_at: "2026-09-06T08:00:00.000Z",
        expires_at: "2026-09-06T20:00:00.000Z",
      },
    });

    render(
      <MemoryRouter initialEntries={["/register"]}>
        <AuthProvider><Probe /></AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("tenant-a:user-a:offline")).toBeVisible();
    expect(reportIdentity).toHaveBeenLastCalledWith(null);
    expect(billingIdentity).toHaveBeenLastCalledWith(null);
    expect(offlineAccess.cache).not.toHaveBeenCalled();
  });

  it("keeps the shell unavailable when no prepared identity can be verified", async () => {
    vi.mocked(getSession).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    offlineAccess.read.mockResolvedValue({ status: "missing" });

    render(
      <MemoryRouter initialEntries={["/register"]}>
        <AuthProvider><Probe /></AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("unavailable")).toBeVisible());
  });

  it("does not claim logout when durable local identity erasure fails", async () => {
    vi.mocked(getSession).mockResolvedValueOnce(session("tenant-a", "user-a"));
    offlineAccess.clear.mockRejectedValueOnce(new Error("IndexedDB unavailable"));
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <AuthProvider><Probe /></AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText("tenant-a:user-a:online")).toBeVisible();

    screen.getByRole("button", { name: "logout-probe" }).click();

    await waitFor(() => expect(offlineAccess.clear).toHaveBeenCalledOnce());
    expect(screen.getByText("tenant-a:user-a:online")).toBeVisible();
    expect(apiLogout).not.toHaveBeenCalled();
  });

  it("keeps a pending logout fail-closed until local identity erasure succeeds", async () => {
    coordination.logoutPending = true;
    offlineAccess.clear.mockRejectedValueOnce(new Error("IndexedDB unavailable"));

    render(
      <MemoryRouter initialEntries={["/register"]}>
        <AuthProvider><Probe /></AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("unavailable")).toBeVisible());
    expect(apiLogout).toHaveBeenCalledOnce();
    expect(getSession).not.toHaveBeenCalled();
    expect(offlineAccess.read).not.toHaveBeenCalled();
  });

  it("binds every authenticated mutation to the identity visible in the tab", async () => {
    const networkFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    window.fetch = networkFetch;
    vi.mocked(getSession).mockResolvedValueOnce(session("tenant-a", "user-a"));
    const view = render(
      <MemoryRouter initialEntries={["/catalog"]}>
        <AuthProvider><Probe /></AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText("tenant-a:user-a:online")).toBeVisible();

    await window.fetch("/api/v1/catalog/categories", {
      method: "POST",
      headers: { "Idempotency-Key": "category-1" },
    });

    const requestInit = networkFetch.mock.calls[0][1] as RequestInit;
    const headers = new Headers(requestInit.headers);
    expect(headers.get("X-Kova-Expected-Tenant")).toBe("tenant-a");
    expect(headers.get("X-Kova-Expected-User")).toBe("user-a");
    expect(headers.get("Idempotency-Key")).toBe("category-1");
    expect(headers.get("X-Kova-Branch")).toBe("tenant-a");
    const selected = "10000000-0000-4000-8000-000000000001";
    window.sessionStorage.setItem("kova-branch:tenant-a:user-a", selected);
    await window.fetch("/api/v1/orders");
    expect(new Headers(networkFetch.mock.calls[1][1].headers).get("X-Kova-Branch")).toBe(selected);
    await window.fetch("/api/v1/branches", { headers: { "X-Kova-Branch": "tenant-a" } });
    expect(new Headers(networkFetch.mock.calls[2][1].headers).get("X-Kova-Branch")).toBe("tenant-a");
    view.unmount();
    expect(billingIdentity).toHaveBeenLastCalledWith(null);
  });

  it("preserves a captured identity and branch instead of rebinding a stale assistant request", async () => {
    const networkFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    window.fetch = networkFetch;
    vi.mocked(getSession).mockResolvedValueOnce(session("tenant-b", "user-b"));
    const view = render(<MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter>);
    await screen.findByText("tenant-b:user-b:online");
    await window.fetch("/api/v1/assistant/proposals", { method: "POST", headers: {
      "X-Kova-Expected-Tenant": "tenant-a", "X-Kova-Expected-User": "user-a", "X-Kova-Branch": "branch-a",
    } });
    const headers = new Headers(networkFetch.mock.calls[0][1].headers);
    expect(headers.get("X-Kova-Expected-Tenant")).toBe("tenant-a");
    expect(headers.get("X-Kova-Expected-User")).toBe("user-a");
    expect(headers.get("X-Kova-Branch")).toBe("branch-a");
    view.unmount();
  });

  it.each([
    ["offline sync", "/api/v1/sync/offline-sales"],
    ["refund", "/api/v1/orders/order-1/refunds"],
  ])("propagates a temporary refresh failure to %s", async (_flow, url) => {
    const networkFetch = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const refreshOutage = Object.assign(new Error("Refresh temporarily unavailable"), { status: 503 });
    window.fetch = networkFetch;
    vi.mocked(getSession).mockResolvedValueOnce(session("tenant-a", "user-a"));
    vi.mocked(refreshSession).mockRejectedValueOnce(refreshOutage);
    const view = render(
      <MemoryRouter initialEntries={["/register"]}>
        <AuthProvider><Probe /></AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText("tenant-a:user-a:online")).toBeVisible();

    await expect(window.fetch(url, { method: "POST" })).rejects.toBe(refreshOutage);
    expect(refreshSession).toHaveBeenCalledOnce();
    expect(networkFetch).toHaveBeenCalledOnce();
    view.unmount();
  });

  it.each(["renewed", "revoked", "logout"] as const)("shares single-use refresh between TrialChip and the focus probe (%s)", async (outcome) => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    let resolveProbe!: (value: { authenticated: false }) => void;
    let resolveRefresh!: (value: Response) => void;
    let billingRequests = 0;
    let refreshRequests = 0;
    const networkFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input.toString() === "/api/v1/auth/refresh") {
        expect(init?.method).toBe("POST");
        refreshRequests += 1;
        return refreshRequests === 1
          ? new Promise<Response>(resolve => { resolveRefresh = resolve; })
          : Promise.resolve(new Response("Invalid or expired refresh token", { status: 401 }));
      }
      billingRequests += 1;
      return Promise.resolve(new Response("{}", { status: billingRequests === 1 ? 401 : 200 }));
    });
    window.fetch = networkFetch;
    billingSubscription.mockResolvedValueOnce(null).mockImplementation(async () => {
      await window.fetch("/api/v1/billing/subscription");
      return null;
    });
    vi.mocked(getSession)
      .mockResolvedValueOnce(session("tenant-a", "user-a"))
      .mockImplementationOnce(() => new Promise(resolve => { resolveProbe = resolve; }))
      .mockResolvedValue(session("tenant-a", "user-a"));
    // Single-use rotation: a second request loses with 401 although the first
    // request installs valid successor cookies.
    const actualApi = await vi.importActual<typeof import("./api")>("./api");
    vi.mocked(refreshSession).mockImplementation(actualApi.refreshSession);
    const view = render(<MemoryRouter initialEntries={["/register"]}><AuthProvider><Probe /><TrialChip /></AuthProvider></MemoryRouter>);
    await screen.findByText("tenant-a:user-a:online");
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(refreshSession).toHaveBeenCalledTimes(1));
    await act(async () => { resolveProbe({ authenticated: false }); });
    if (outcome === "logout") {
      act(() => screen.getByRole("button", { name: "logout-probe" }).click());
      await screen.findByText("unauthenticated");
    }
    await act(async () => { resolveRefresh(new Response(null, { status: outcome === "revoked" ? 401 : 200 })); });
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(refreshRequests).toBe(1);
    if (outcome === "renewed") {
      await waitFor(() => expect(billingRequests).toBe(2));
      expect(screen.getByText("tenant-a:user-a:online")).toBeVisible();
      expect(offlineAccess.clear).not.toHaveBeenCalled();
      expect(apiLogout).not.toHaveBeenCalled();
      expect(new Headers(networkFetch.mock.calls[2][1]?.headers).get("X-Kova-Branch")).toBe("tenant-a");
    } else {
      await screen.findByText("unauthenticated");
      expect(billingRequests).toBe(1);
      expect(offlineAccess.cache).toHaveBeenCalledOnce();
      expect(apiLogout).toHaveBeenCalledTimes(outcome === "logout" ? 1 : 0);
    }
    view.unmount();
    visibility.mockRestore();
  });

  it("refreshes a changed role for the same user when the tab regains focus", async () => {
    vi.mocked(getSession)
      .mockResolvedValueOnce(session("tenant-a", "user-a", "owner"))
      .mockResolvedValueOnce(session("tenant-a", "user-a", "cashier"));
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <AuthProvider><Probe /></AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText("tenant-a:user-a:online")).toBeVisible();

    act(() => window.dispatchEvent(new Event("focus")));

    await waitFor(() => expect(offlineAccess.cache).toHaveBeenCalledTimes(2));
    expect(offlineAccess.cache.mock.calls[1][0].user.role).toBe("cashier");
    expect(reportIdentity).toHaveBeenLastCalledWith({ tenantId: "tenant-a", userId: "user-a", role: "cashier" });
    expect(billingIdentity).toHaveBeenLastCalledWith({ tenantId: "tenant-a", userId: "user-a", role: "cashier" });
  });

  it("shares concurrent focus, visible and reconnect probes without dropping a later role change", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    let resolveProbe!: (value: ReturnType<typeof session>) => void;
    vi.mocked(getSession)
      .mockResolvedValueOnce(session("tenant-a", "user-a"))
      .mockImplementationOnce(() => new Promise(resolve => { resolveProbe = resolve; }))
      .mockResolvedValueOnce(session("tenant-a", "user-a", "cashier"));
    render(<MemoryRouter initialEntries={["/register"]}><AuthProvider><Probe /></AuthProvider></MemoryRouter>);
    await screen.findByText("tenant-a:user-a:online");
    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
    });
    expect(getSession).toHaveBeenCalledTimes(2);
    await act(async () => { resolveProbe(session("tenant-a", "user-a")); });
    await waitFor(() => expect(offlineAccess.cache).toHaveBeenCalledTimes(2));
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(offlineAccess.cache).toHaveBeenCalledTimes(3));
    expect(reportIdentity).toHaveBeenLastCalledWith({ tenantId: "tenant-a", userId: "user-a", role: "cashier" });
    visibility.mockRestore();
  });

  it("lets a cross-tab identity verification supersede a shared focus probe", async () => {
    let resolveFocus!: (value: ReturnType<typeof session>) => void;
    vi.mocked(getSession)
      .mockResolvedValueOnce(session("tenant-a", "user-a"))
      .mockImplementationOnce(() => new Promise(resolve => { resolveFocus = resolve; }))
      .mockResolvedValueOnce(session("tenant-b", "user-b"));
    render(<MemoryRouter initialEntries={["/register"]}><AuthProvider><Probe /></AuthProvider></MemoryRouter>);
    await screen.findByText("tenant-a:user-a:online");
    act(() => window.dispatchEvent(new Event("focus")));
    act(() => coordination.listener?.());
    await screen.findByText("tenant-b:user-b:online");
    await act(async () => { resolveFocus(session("tenant-a", "user-a")); });
    expect(screen.getByText("tenant-b:user-b:online")).toBeVisible();
    expect(offlineAccess.cache).toHaveBeenCalledTimes(2);
  });

  it("preserves Request bodies, identity, branch and cancellation when retrying after refresh", async () => {
    const bodies: string[] = [];
    const signals: AbortSignal[] = [];
    const networkFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input).toBeInstanceOf(Request);
      const request = input as Request;
      bodies.push(await request.text());
      signals.push(request.signal);
      const headers = new Headers(init?.headers);
      expect(headers.get("X-Kova-Expected-Tenant")).toBe("tenant-a");
      expect(headers.get("X-Kova-Expected-User")).toBe("user-a");
      expect(headers.get("X-Kova-Branch")).toBe("tenant-a");
      expect(headers.get("Idempotency-Key")).toBe("request-body-retry");
      expect(headers.get("X-CSRF-Token")).toBe("synthetic-csrf");
      expect(request.method).toBe("POST");
      expect(request.credentials).toBe("same-origin");
      return new Response("{}", { status: bodies.length === 1 ? 401 : 200 });
    });
    window.fetch = networkFetch;
    vi.mocked(getSession).mockResolvedValueOnce(session("tenant-a", "user-a"));
    vi.mocked(refreshSession).mockResolvedValueOnce(true);
    const view = render(<MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter>);
    await screen.findByText("tenant-a:user-a:online");
    const abort = new AbortController();
    const payload = JSON.stringify({ expected: "synthetic-payload" });
    const input = new Request(`${window.location.origin}/api/v1/orders`, {
      method: "POST", body: payload, signal: abort.signal,
      headers: { "Idempotency-Key": "request-body-retry", "Content-Type": "application/json", "X-CSRF-Token": "synthetic-csrf" },
    });
    expect((await window.fetch(input)).status).toBe(200);
    expect(input.bodyUsed).toBe(true);
    expect(bodies).toEqual([payload, payload]);
    expect(refreshSession).toHaveBeenCalledOnce();
    abort.abort();
    expect(signals.every(signal => signal.aborted)).toBe(true);
    view.unmount();
  });

  it("preserves cancellation while a Request waits for its refreshed cookie", async () => {
    let finishRefresh!: (ok: boolean) => void;
    const bodies: string[] = [];
    const networkFetch = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.signal.aborted) throw new DOMException("Request aborted", "AbortError");
      bodies.push(await request.text());
      return new Response("unauthorized", { status: 401 });
    });
    window.fetch = networkFetch;
    vi.mocked(getSession).mockResolvedValueOnce(session("tenant-a", "user-a"));
    vi.mocked(refreshSession).mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve; }));
    const view = render(<MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter>);
    await screen.findByText("tenant-a:user-a:online");
    const abort = new AbortController();
    const request = window.fetch(new Request(`${window.location.origin}/api/v1/orders`, {
      method: "POST", body: "synthetic-payload", signal: abort.signal,
    }));
    await waitFor(() => expect(refreshSession).toHaveBeenCalledOnce());
    abort.abort();
    finishRefresh(true);
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(bodies).toEqual(["synthetic-payload"]);
    view.unmount();
  });

  it("keeps Request mutations blocked while a cross-tab cookie identity is being verified", async () => {
    const networkFetch = vi.fn();
    window.fetch = networkFetch;
    vi.mocked(getSession)
      .mockResolvedValueOnce(session("tenant-a", "user-a"))
      .mockImplementationOnce(() => new Promise(() => {}));
    const view = render(<MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter>);
    await screen.findByText("tenant-a:user-a:online");
    act(() => coordination.listener?.());
    const request = new Request(`${window.location.origin}/api/v1/orders`, { method: "POST", body: "{}" });
    await expect(window.fetch(request)).rejects.toThrow(/verificando el negocio activo/i);
    expect(networkFetch).not.toHaveBeenCalled();
    view.unmount();
  });

  it("does not attach tenant headers or refresh an unrelated origin's API requests", async () => {
    const networkFetch = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    window.fetch = networkFetch;
    vi.mocked(getSession).mockResolvedValueOnce(session("tenant-a", "user-a"));
    const view = render(<MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter>);
    await screen.findByText("tenant-a:user-a:online");
    await window.fetch(new Request("https://unrelated.example/api/v1/orders", { method: "POST", body: "{}" }));
    expect(networkFetch).toHaveBeenCalledOnce();
    expect(networkFetch.mock.calls[0][1]).toBeUndefined();
    expect(refreshSession).not.toHaveBeenCalled();
    view.unmount();
  });

  it("resolves relative URLs against the document base used by fetch", async () => {
    const networkFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    window.fetch = networkFetch;
    vi.mocked(getSession).mockResolvedValueOnce(session("tenant-a", "user-a"));
    const view = render(<MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter>);
    await screen.findByText("tenant-a:user-a:online");
    const base = document.createElement("base");
    base.href = `${window.location.origin}/nested/`;
    document.head.append(base);
    try {
      await window.fetch("api/v1/orders", { method: "POST", body: "{}" });
      expect(new Headers(networkFetch.mock.calls[0][1]?.headers).has("X-Kova-Expected-Tenant")).toBe(false);
      base.href = `${window.location.origin}/`;
      await window.fetch("api/v1/orders", { method: "POST", body: "{}" });
      expect(new Headers(networkFetch.mock.calls[1][1]?.headers).get("X-Kova-Expected-Tenant")).toBe("tenant-a");
    } finally {
      base.remove();
      view.unmount();
    }
  });

  it("does not retry a consumed explicit stream body override", async () => {
    const networkFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(await new Response(init?.body).text()).toBe("synthetic-stream-body");
      return new Response("unauthorized", { status: 401 });
    });
    window.fetch = networkFetch;
    vi.mocked(getSession).mockResolvedValueOnce(session("tenant-a", "user-a"));
    const view = render(<MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter>);
    await screen.findByText("tenant-a:user-a:online");
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode("synthetic-stream-body"));
      controller.close();
    } });
    const request = new Request(`${window.location.origin}/api/v1/orders`, { method: "POST", body: "original-body" });
    expect((await window.fetch(request, { body: stream })).status).toBe(401);
    expect(networkFetch).toHaveBeenCalledOnce();
    expect(refreshSession).not.toHaveBeenCalled();
    view.unmount();
  });

  it("closes an open session's commercial views and offline permission on a billing rejection", async () => {
    const networkFetch = vi.fn().mockResolvedValue(new Response("payment_required", { status: 402 }));
    window.fetch = networkFetch;
    vi.mocked(getSession).mockResolvedValueOnce({ ...session("tenant-a", "user-a"), commercial_access: {
      allowed: true, reason: "active", valid_until: new Date(Date.now() + 60_000).toISOString(),
    } });
    const view = render(<MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter>);
    await screen.findByText("tenant-a:user-a:online");
    queryClient.setQueryData(["paid-private-data"], { value: "private" });
    await act(async () => { expect((await window.fetch("/api/v1/catalog/products")).status).toBe(402); });
    await screen.findByText("Acceso comercial bloqueado");
    expect(screen.getByText("tenant-a:user-a:online")).toBeInTheDocument();
    await waitFor(() => expect(offlineAccess.clear).toHaveBeenCalled());
    expect(queryClient.getQueryData(["paid-private-data"])).toBeUndefined();
    expect(refreshSession).not.toHaveBeenCalled();
    view.unmount();
  });

  it("expires an already-open register at its billing deadline while offline", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(getSession).mockResolvedValueOnce({ ...session("tenant-a", "user-a"), commercial_access: {
        allowed: true, reason: "trial", valid_until: new Date(Date.now() + 200).toISOString(),
      } }).mockRejectedValue(new TypeError("offline"));
      offlineAccess.read.mockResolvedValue({ status: "expired" });
      const view = render(<MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter>);
      await act(async () => { await vi.dynamicImportSettled(); });
      expect(screen.getByText("tenant-a:user-a:online")).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(199); });
      expect(screen.queryByText("Acceso comercial bloqueado")).not.toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(1); await vi.dynamicImportSettled(); });
      expect(screen.getByText("Acceso comercial bloqueado")).toBeInTheDocument();
      expect(offlineAccess.clear).toHaveBeenCalled();
      expect(getSession).toHaveBeenCalledTimes(2);
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reopen commercial access when an older session probe finishes after a 402", async () => {
    const original = { ...session("tenant-a", "user-a"), commercial_access: {
      allowed: true, reason: "active", valid_until: new Date(Date.now() + 60_000).toISOString(),
    } };
    let finishProbe!: (value: typeof original) => void;
    vi.mocked(getSession).mockResolvedValueOnce(original).mockImplementationOnce(() => new Promise(resolve => { finishProbe = resolve; }));
    window.fetch = vi.fn().mockResolvedValue(new Response("payment_required", { status: 402 }));
    const view = render(<MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter>);
    await screen.findByText("tenant-a:user-a:online");
    act(() => window.dispatchEvent(new Event("focus")));
    await act(async () => { await window.fetch("/api/v1/catalog/products"); });
    await screen.findByText("Acceso comercial bloqueado");
    await act(async () => { finishProbe(original); });
    expect(screen.getByText("Acceso comercial bloqueado")).toBeInTheDocument();
    expect(offlineAccess.cache).toHaveBeenCalledOnce();
    view.unmount();
  });

  it("bounds an already-open seven-day trial to twelve hours without a fresh online probe", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(getSession).mockResolvedValueOnce({ ...session("tenant-a", "user-a"), commercial_access: {
        allowed: true, reason: "signup_trial", valid_until: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      } }).mockImplementationOnce(() => new Promise(() => {}));
      const view = render(<MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter>);
      await act(async () => { await vi.dynamicImportSettled(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(OFFLINE_ACCESS_MAX_AGE_MS - 1); });
      expect(screen.queryByText("Acceso comercial bloqueado")).not.toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(1); await vi.dynamicImportSettled(); });
      expect(screen.getByText("Acceso comercial bloqueado")).toBeInTheDocument();
      expect(getSession).toHaveBeenCalledTimes(2);
      view.unmount();
    } finally { vi.useRealTimers(); }
  });

  it("does not let an older 402 replace a more recently verified billing grant", async () => {
    const original = { ...session("tenant-a", "user-a"), commercial_access: {
      allowed: true, reason: "active", valid_until: new Date(Date.now() + 60_000).toISOString(),
    } };
    const renewed = { ...original, commercial_access: { ...original.commercial_access, valid_until: new Date(Date.now() + 120_000).toISOString() } };
    vi.mocked(getSession).mockResolvedValueOnce(original).mockResolvedValueOnce(renewed);
    let finishRequest!: (value: Response) => void;
    window.fetch = vi.fn().mockImplementation(() => new Promise(resolve => { finishRequest = resolve; }));
    const view = render(<MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter>);
    await screen.findByText("tenant-a:user-a:online");
    const olderRequest = window.fetch("/api/v1/catalog/products");
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(offlineAccess.cache).toHaveBeenCalledTimes(2));
    await act(async () => { finishRequest(new Response("payment_required", { status: 402 })); await olderRequest; });
    expect(screen.queryByText("Acceso comercial bloqueado")).not.toBeInTheDocument();
    expect(offlineAccess.clear).not.toHaveBeenCalled();
    view.unmount();
  });
});
