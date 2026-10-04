import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/billing/api", () => ({ setBillingCacheIdentity: billingIdentity }));

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
      <button type="button" onClick={() => void logout().catch(() => undefined)}>
        logout-probe
      </button>
    </div>
  );
}

describe("AuthProvider identity continuity", () => {
  beforeEach(() => {
    window.localStorage.clear();
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
    view.unmount();
    expect(billingIdentity).toHaveBeenLastCalledWith(null);
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
});
