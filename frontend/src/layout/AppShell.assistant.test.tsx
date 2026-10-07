import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ state: {
  status: "authenticated", tenantId: "tenant-a", tenantName: "Mi negocio", tenantLogoUrl: null,
  sessionMode: "online", user: { id: "user-a", email: "owner@example.com", role: "owner" },
}, logout: vi.fn() }));
vi.mock("@/auth/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/auth/AuthContext", () => ({ useAuthContext: () => auth }));
vi.mock("@/auth/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/branches/BranchSelector", () => ({ BranchSelector: () => null }));
vi.mock("@/offline/OfflineIndicator", () => ({ OfflineIndicator: () => null }));
vi.mock("@/billing/BillingBanner", () => ({ BillingBanner: () => null }));
vi.mock("@/billing/TrialChip", () => ({ TrialChip: () => null }));
vi.mock("@/auth/EmailVerificationBanner", () => ({ EmailVerificationBanner: () => null }));
vi.mock("@/onboarding/FirstUseTour", () => ({ FirstUseTour: () => null }));
vi.mock("@/support/SupportDialog", () => ({ SupportDialog: () => null }));
vi.mock("@/telemetry/funnel", () => ({ flushFunnelEvents: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import AppShell from "./AppShell";

const host = () => <MemoryRouter initialEntries={["/reports"]}><AppShell /></MemoryRouter>;
describe("assistant continuity in the application shell", () => {
  beforeEach(() => {
    auth.state = { status: "authenticated", tenantId: "tenant-a", tenantName: "Mi negocio", tenantLogoUrl: null,
      sessionMode: "online", user: { id: "user-a", email: "owner@example.com", role: "owner" } };
    window.sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const data = input.endsWith("/capabilities") ? { enabled: true, inference_ready: true }
        : input.endsWith("/preferences") ? { chat_consent: true }
        : input.endsWith("/usage") ? { tenant_used: 0, tenant_limit: 8000, reset_at: "2026-10-08T00:00:00Z" }
        : {};
      return new Response(JSON.stringify(data));
    }));
  });
  it("keeps the open chat and private draft across same-identity session refresh", async () => {
    const view = render(host());
    fireEvent.click(await screen.findByRole("button", { name: "Abrir asistente Kova" }));
    const field = await screen.findByRole("textbox", { name: "Tu pregunta" });
    fireEvent.change(field, { target: { value: "Mi pregunta pendiente" } });
    const requests = vi.mocked(fetch).mock.calls.length;
    auth.state = { ...auth.state, tenantName: "Nombre actualizado", user: { ...auth.state.user } };
    view.rerender(host());
    expect(screen.getByRole("textbox", { name: "Tu pregunta" })).toBe(field);
    expect(field).toHaveValue("Mi pregunta pendiente");
    expect(fetch).toHaveBeenCalledTimes(requests);
  });
  it("clears the private draft on tenant change and hides chat on role revocation", async () => {
    const view = render(host());
    fireEvent.click(await screen.findByRole("button", { name: "Abrir asistente Kova" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Tu pregunta" }), { target: { value: "Del primer negocio" } });
    auth.state = { ...auth.state, tenantId: "tenant-b" };
    view.rerender(host());
    expect(screen.queryByRole("dialog", { name: "Asistente Kova" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir asistente Kova" }));
    expect(await screen.findByRole("textbox", { name: "Tu pregunta" })).toHaveValue("");
    auth.state = { ...auth.state, user: { ...auth.state.user, role: "cashier" } };
    view.rerender(host());
    expect(screen.queryByRole("dialog", { name: "Asistente Kova" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Abrir asistente Kova" })).toBeNull();
  });
});
