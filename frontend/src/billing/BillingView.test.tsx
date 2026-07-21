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
const trackCheckoutStateViewed = vi.fn();

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
  trackCheckoutStateViewed: (...args: unknown[]) => trackCheckoutStateViewed(...args),
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
          period_freshness: "unavailable" as const,
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

function activeBilling(
  overrides: Partial<NonNullable<BillingSubscription["subscription"]>>,
): BillingSubscription {
  const result = billing(overrides);
  return {
    ...result,
    access: {
      ...result.access,
      reason: "active",
      trialing: false,
      trial_ends_at: null,
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

function renderBilling() {
  return render(
    <MemoryRouter initialEntries={["/settings/billing"]}>
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
  it("keeps the return state pending until the backend confirms the subscription", async () => {
    let confirmCheckout: (value: BillingSubscription) => void = () => undefined;
    getBillingSubscription.mockResolvedValue(billing({ status: "incomplete" }));
    reconcileCheckout.mockReturnValue(
      new Promise<BillingSubscription>((resolve) => {
        confirmCheckout = resolve;
      }),
    );

    renderSuccess();

    expect(await screen.findByText("Estamos confirmando tu suscripción")).toBeInTheDocument();
    expect(screen.queryByText("Tu suscripción está activa")).not.toBeInTheDocument();

    confirmCheckout(billing({ status: "active" }));
    expect(await screen.findByText("Tu suscripción está activa")).toBeInTheDocument();
  });

  it("reconciles the checkout session when the subscription is not yet active", async () => {
    getBillingSubscription.mockResolvedValue(billing({ status: "incomplete" }));
    reconcileCheckout.mockResolvedValue(billing({ status: "active" }));

    renderSuccess();

    await waitFor(() => expect(reconcileCheckout).toHaveBeenCalledWith("cs_test_123"));
    // Converges to the active status without a manual refresh.
    expect(await screen.findByText("Activo")).toBeInTheDocument();
    expect(trackCheckoutStateViewed).toHaveBeenCalledWith("return_success_pending");
    expect(trackCheckoutStateViewed).toHaveBeenCalledWith("return_success_active");
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
    expect(await screen.findByText(/No repitas el pago/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contactar soporte" })).toHaveAttribute(
      "href",
      "mailto:posprojectsupport@gmail.com",
    );
  });

  it("does not reconcile a backend-confirmed trialing subscription", async () => {
    getBillingSubscription.mockResolvedValue(billing({ status: "trialing" }));

    renderSuccess();

    expect(await screen.findByText("Tu suscripción está en prueba")).toBeInTheDocument();
    expect(reconcileCheckout).not.toHaveBeenCalled();
  });
});

describe("BillingView plan and period trust", () => {
  it("renders the canonical monthly price from the billing plan response", async () => {
    getBillingSubscription.mockResolvedValue(billing(null));

    renderBilling();

    expect(await screen.findByText("$299 MXN/mes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activar por $299 MXN/mes" })).toBeEnabled();
    expect(screen.queryByText("$299.00")).not.toBeInTheDocument();
  });

  it("shows a renewal date only when the backend marks the period verified", async () => {
    getBillingSubscription.mockResolvedValue(
      activeBilling({
        status: "active",
        current_period_end: "2026-08-20T18:00:00Z",
        period_freshness: "verified",
      }),
    );

    renderBilling();

    expect(await screen.findByText("Próxima renovación")).toBeInTheDocument();
    expect(screen.getByText(/20 ago 2026/i)).toBeInTheDocument();
    expect(screen.queryByText(/Estamos verificando tu próxima fecha/i)).not.toBeInTheDocument();
  });

  it("hides a stale period date and explains that verification is in progress", async () => {
    getBillingSubscription.mockResolvedValue(
      activeBilling({
        status: "active",
        current_period_end: "2026-06-01T00:00:00Z",
        period_freshness: "stale",
      }),
    );

    renderBilling();

    expect(await screen.findByText("Periodo de facturación")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Estamos verificando tu próxima fecha de renovación. Tu acceso actual no cambia.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Próxima renovación")).not.toBeInTheDocument();
    expect(screen.queryByText(/1 jun 2026/i)).not.toBeInTheDocument();
  });
});
