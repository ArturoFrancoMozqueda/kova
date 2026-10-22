import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ state: {
  status: "authenticated", tenantId: "tenant-a", tenantName: "Mi negocio", tenantLogoUrl: null,
  sessionMode: "online", user: { id: "user-a", email: "owner@example.com", role: "owner" },
}, logout: vi.fn() }));
vi.mock("@/auth/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/auth/AuthContext", () => ({ useAuthContext: () => auth }));
vi.mock("@/auth/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/branches/BranchSelector", () => ({ BranchSelector: () => null }));
vi.mock("@/assistant/AssistantCompanion", () => ({ AssistantCompanion: () => null }));
vi.mock("@/offline/OfflineIndicator", () => ({ OfflineIndicator: () => null }));
vi.mock("@/billing/BillingBanner", () => ({ BillingBanner: () => null }));
vi.mock("@/billing/TrialChip", () => ({ TrialChip: () => null }));
vi.mock("@/auth/EmailVerificationBanner", () => ({ EmailVerificationBanner: () => null }));
vi.mock("@/onboarding/FirstUseTour", () => ({ FirstUseTour: () => null }));
vi.mock("@/support/SupportDialog", () => ({ SupportDialog: () => null }));
vi.mock("@/telemetry/funnel", () => ({ flushFunnelEvents: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import AppShell from "./AppShell";

describe("mobile navigation focus restoration", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false,
      addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: false }))));
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([0, 1])("returns focus to clicked menu trigger %i when pointer activation does not focus it", async (index) => {
    render(<MemoryRouter><AppShell /></MemoryRouter>);
    const trigger = screen.getAllByRole("button", { name: "Abrir menú de navegación" })[index];
    expect(document.activeElement).not.toBe(trigger);
    // fireEvent.click reproduces Safari pointer activation without browser focus.
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Navegación de la cuenta" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Navegación de la cuenta" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await act(async () => {});
  });
});
