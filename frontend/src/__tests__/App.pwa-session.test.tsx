import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { copy } from "@/i18n/messages";

vi.mock("@/auth/api", () => ({
  ApiError: class ApiError extends Error {},
  getSession: vi.fn(),
  logout: vi.fn(),
  refreshSession: vi.fn(),
}));
vi.mock("@/settings/api", () => ({ getReceiptSettings: vi.fn().mockResolvedValue({ logo_url: null }) }));
vi.mock("@/offline/offlineAccess", () => ({ cacheVerifiedOfflineAccess: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/layout/AppShell", () => ({ default: () => <Outlet /> }));
vi.mock("@/dashboard/DashboardView", () => ({ default: () => <h1>Panel autenticado</h1> }));
vi.mock("@/register/RegisterView", () => {
  function RegisterStub() {
    const navigate = useNavigate();
    return <button onClick={() => navigate("/dashboard")}>Ir al panel</button>;
  }
  return { default: RegisterStub };
});

import { getSession } from "@/auth/api";
import { AppRoutes } from "../App";

const authenticated = {
  authenticated: true as const,
  user: { id: "user-1", email: "owner@example.com", tenant_id: "tenant-1", role: "owner" },
  tenant_id: "tenant-1", tenant_name: "Mi negocio", feature_flags: {},
};

afterEach(() => { vi.clearAllMocks(); });

describe("App device update state during session adoption", () => {
  it("keeps an announced update visible after the initial session adopts an identity", async () => {
    let resolveSession!: (session: typeof authenticated) => void;
    vi.mocked(getSession).mockImplementationOnce(() => new Promise((resolve) => { resolveSession = resolve; }));
    render(<MemoryRouter initialEntries={["/dashboard"]}><AppRoutes /></MemoryRouter>);
    act(() => window.dispatchEvent(new CustomEvent("pos:pwa-update-available")));
    expect(screen.getByText(copy.pwaUpdate.title)).toBeVisible();

    await act(async () => resolveSession(authenticated));
    await screen.findByRole("heading", { name: "Panel autenticado" });
    expect(screen.getByText(copy.pwaUpdate.title)).toBeVisible();
    expect(screen.getByRole("button", { name: copy.pwaUpdate.update })).toBeEnabled();
  });

  it("keeps a deferred update pending through session adoption and applies it only on a safe route", async () => {
    let resolveSession!: (session: typeof authenticated) => void;
    vi.mocked(getSession).mockImplementationOnce(() => new Promise((resolve) => { resolveSession = resolve; }));
    const apply = vi.fn();
    window.addEventListener("pos:pwa-apply-update", apply);
    try {
      render(<MemoryRouter initialEntries={["/register"]}><AppRoutes /></MemoryRouter>);
      act(() => window.dispatchEvent(new CustomEvent("pos:pwa-update-available")));
      fireEvent.click(screen.getByRole("button", { name: copy.pwaUpdate.update }));
      expect(screen.getByText(copy.pwaUpdate.deferredDescription)).toBeVisible();
      expect(apply).not.toHaveBeenCalled();

      await act(async () => resolveSession(authenticated));
      await screen.findByRole("button", { name: "Ir al panel" });
      expect(screen.getByText(copy.pwaUpdate.title)).toBeVisible();
      expect(screen.getByRole("button", { name: copy.pwaUpdate.waiting })).toBeDisabled();
      expect(apply).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Ir al panel" }));
      await screen.findByRole("heading", { name: "Panel autenticado" });
      expect(apply).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("pos:pwa-apply-update", apply);
    }
  });
});
