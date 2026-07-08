import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import type { BillingSubscription } from "./types";

// Mock the billing API so we can assert the reconcile call and drive state.
const getBillingSubscription = vi.fn();
const reconcileCheckout = vi.fn();
const invalidateBillingSubscription = vi.fn();
const startCheckout = vi.fn();
const cancelSubscription = vi.fn();

vi.mock("./api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  getBillingSubscription: () => getBillingSubscription(),
  reconcileCheckout: (sessionId: string) => reconcileCheckout(sessionId),
  invalidateBillingSubscription: () => invalidateBillingSubscription(),
  startCheckout: () => startCheckout(),
  cancelSubscription: () => cancelSubscription(),
}));

// Grant billing view + manage so the full view renders.
vi.mock("../auth/permissions", () => ({
  BILLING_VIEW_PERMISSION: "billing.view",
  BILLING_MANAGE_PERMISSION: "billing.manage",
  usePermission: () => true,
}));

vi.mock("@/telemetry/funnel", () => ({
  trackFunnelEvent: vi.fn(),
  trackFunnelEventOnce: vi.fn(),
}));

import BillingView from "./BillingView";

function billing(overrides: Partial<BillingSubscription["subscription"]> | null): BillingSubscription {
  const subscription =
    overrides === null
      ? null
      : {
          id: "sub-1",
          tenant_id: "tenant-1",
          status: "incomplete",
          plan_name: "Standard Plan",
          currency: "MXN",
          amount_minor_units: 29900,
          current_period_start: null,
          current_period_end: null,
          trial_ends_at: null,
          past_due_at: null,
          grace_period_ends_at: null,
          cancel_at_period_end: false,
          canceled_at: null,
          created_at: "2026-07-01T00:00:00Z",
          updated_at: "2026-07-01T00:00:00Z",
          ...overrides,
        };
  return {
    plan: { name: "Standard Plan", amount_minor_units: 29900, currency: "MXN", interval: "month" },
    subscription,
    access: {
      allowed: true,
      reason: "signup_trial",
      trialing: true,
      trial_ends_at: "2026-07-08T00:00:00Z",
      blocked_at: null,
      recovery_path: "/settings/billing",
      grace_period_ends_at: null,
    },
  };
}

function renderSuccess(search = "?session_id=cs_test_123") {
  return render(
    <MemoryRouter initialEntries={[`/settings/billing/success${search}`]}>
      <ToastProvider>
        <BillingView />
      </ToastProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("BillingView success-page reconciliation", () => {
  it("reconciles the checkout session when the subscription is not yet active", async () => {
    getBillingSubscription.mockResolvedValue(billing({ status: "incomplete" }));
    reconcileCheckout.mockResolvedValue(billing({ status: "active" }));

    renderSuccess();

    await waitFor(() => expect(reconcileCheckout).toHaveBeenCalledWith("cs_test_123"));
    // Converges to the active status without a manual refresh.
    expect(await screen.findByText("Activo")).toBeInTheDocument();
  });

  it("does not reconcile when the subscription is already active", async () => {
    getBillingSubscription.mockResolvedValue(billing({ status: "active" }));

    renderSuccess();

    expect(await screen.findByText("Activo")).toBeInTheDocument();
    expect(reconcileCheckout).not.toHaveBeenCalled();
  });

  it("does not reconcile when no session_id is present in the URL", async () => {
    getBillingSubscription.mockResolvedValue(billing({ status: "incomplete" }));

    renderSuccess("");

    // Let the load settle.
    await waitFor(() => expect(getBillingSubscription).toHaveBeenCalled());
    expect(reconcileCheckout).not.toHaveBeenCalled();
  });
});
