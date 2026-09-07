import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const coordination = vi.hoisted(() => ({ listener: null as null | (() => void) }));
const offlineAccess = vi.hoisted(() => ({
  cache: vi.fn(),
  clear: vi.fn(),
  read: vi.fn(),
}));

vi.mock("./api", () => ({
  ApiError: class ApiError extends Error {},
  getSession: vi.fn(),
  logout: vi.fn(),
  refreshSession: vi.fn(),
}));
vi.mock("./sessionCoordination", () => ({
  announceSessionChange: vi.fn(),
  clearLogoutPending: vi.fn(),
  hasLogoutPending: vi.fn(() => false),
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
vi.mock("@/settings/api", () => ({
  getReceiptSettings: vi.fn().mockResolvedValue({ logo_url: null }),
}));

import { getSession } from "./api";
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
  const { state } = useAuthContext();
  return (
    <div>
      {state.status === "authenticated"
        ? `${state.tenantId}:${state.user.id}:${state.sessionMode}`
        : state.status}
    </div>
  );
}

describe("AuthProvider identity continuity", () => {
  beforeEach(() => {
    window.localStorage.clear();
    coordination.listener = null;
    offlineAccess.cache.mockReset().mockResolvedValue(undefined);
    offlineAccess.clear.mockReset().mockResolvedValue(undefined);
    offlineAccess.read.mockReset();
    vi.mocked(getSession).mockReset();
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

    let resolveProbe!: (value: ReturnType<typeof session>) => void;
    vi.mocked(getSession).mockImplementationOnce(() => new Promise((resolve) => {
      resolveProbe = resolve;
    }));
    act(() => coordination.listener?.());
    expect(screen.getByText("loading")).toBeVisible();
    await expect(window.fetch("/api/v1/orders", { method: "POST" })).rejects.toThrow(
      /verificando el negocio activo/i,
    );
    expect(networkFetch).not.toHaveBeenCalled();

    resolveProbe(session("tenant-b", "user-b", "cashier"));
    expect(await screen.findByText("tenant-b:user-b:online")).toBeVisible();
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
  });
});
