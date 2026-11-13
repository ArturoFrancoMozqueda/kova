import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { copy } from "@/i18n/messages";
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
  getBillingSubscription: (...args: unknown[]) => getBillingSubscription(...args),
  reconcileCheckout: (sessionId: string) => reconcileCheckout(sessionId),
  invalidateBillingSubscription: () => invalidateBillingSubscription(),
  startCheckout: (...args: unknown[]) => startCheckout(...args),
  cancelSubscription: () => cancelSubscription(),
  startBillingPortal: vi.fn(),
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

import { ApiError } from "./api";
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

it("shows permanent courtesy access without payment actions or an expiring trial", async () => {
  const result = billing({ status: "incomplete" });
  result.access = {
    ...result.access, allowed: true, reason: "complimentary", trialing: false,
    trial_ends_at: null,
  };
  getBillingSubscription.mockResolvedValue(result);
  renderBilling();
  expect(await screen.findByText(copy.billingView.complimentaryTitle)).toBeInTheDocument();
  expect(screen.getByText(copy.billingView.complimentaryDuration)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /activar|cancelar/i })).not.toBeInTheDocument();
  expect(screen.queryByText(copy.billingView.periodVerifying)).not.toBeInTheDocument();
  expect(startCheckout).not.toHaveBeenCalled();
});

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

  // Copy change (2026-08): a stale period used to read "estamos verificando tu
  // próxima fecha de renovación", which plants doubt on the one screen where
  // someone decides whether to trust us with a card. The behaviour is unchanged
  // — a stale date is still hidden — but the fallback now states the only thing
  // we know for certain: the plan is monthly and access is on.
  it("hides a stale period date and states the monthly renewal instead", async () => {
    getBillingSubscription.mockResolvedValue(
      activeBilling({
        status: "active",
        current_period_end: "2026-06-01T00:00:00Z",
        period_freshness: "stale",
      }),
    );

    renderBilling();

    expect(await screen.findByText("Periodo de suscripción")).toBeInTheDocument();
    expect(
      screen.getByText("Se renueva cada mes mientras la suscripción siga activa."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Estamos verificando/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Próxima renovación")).not.toBeInTheDocument();
    expect(screen.queryByText(/1 jun 2026/i)).not.toBeInTheDocument();
  });

  it("suspends an unverified paid period without claiming activation or offering a duplicate payment", async () => {
    const unverified = activeBilling({ status: "active", period_freshness: "stale" });
    unverified.access = { ...unverified.access, allowed: false, reason: "verification_required" };
    getBillingSubscription.mockResolvedValue(unverified);

    renderBilling();

    expect(await screen.findByText(copy.billingView.verificationPending)).toBeVisible();
    expect(screen.queryByText(copy.billingView.subscriptionActiveTitle)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.billingView.subscriptionActiveBody)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.billingView.periodVerifying)).not.toBeInTheDocument();
    expect(screen.getAllByText(copy.billingView.verificationRequiredBody).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Activar por/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: copy.billingView.checkoutSupport })).toBeVisible();
  });
});


describe("BillingView existing subscription payment recovery", () => {
  it.each(["past_due", "unpaid"])("offers recovery instead of duplicate checkout for %s", async (status) => {
    const result = billing({ status });
    result.access = { ...result.access, allowed: false, reason: status, trialing: false, trial_ends_at: null };
    getBillingSubscription.mockResolvedValue(result);
    renderBilling();
    expect(await screen.findByText(/Tu suscripción tiene un pago pendiente/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Activar por/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contactar soporte" })).toHaveAttribute("href", expect.stringMatching(/^mailto:/));
    expect(screen.queryByText("Tu suscripción está activa")).not.toBeInTheDocument();
    expect(startCheckout).not.toHaveBeenCalled();
  });

  it.each(["canceled", "incomplete"])("preserves checkout for %s subscriptions", async (status) => {
    getBillingSubscription.mockResolvedValue(billing({ status }));
    renderBilling();
    expect(await screen.findByRole("button", { name: "Activar por $299 MXN/mes" })).toBeEnabled();
    expect(screen.queryByText(/Tu suscripción tiene un pago pendiente/)).not.toBeInTheDocument();
  });
});


it("offers paid checkout after a courtesy trial expires", async () => {
  const result = billing({ status: "trialing" });
  result.access = {
    ...result.access, allowed: false, reason: "trial_expired", trialing: false,
  };
  getBillingSubscription.mockResolvedValue(result);
  renderBilling();
  expect(await screen.findByRole("button", { name: "Activar por $299 MXN/mes" })).toBeEnabled();
  expect(screen.queryByText(copy.billingView.subscriptionTrialingTitle)).not.toBeInTheDocument();
});

it("does not claim activation if checkout rejects an existing pending-payment subscription", async () => {
  getBillingSubscription.mockResolvedValueOnce(billing(null)).mockResolvedValue(billing({ status: "past_due" }));
  startCheckout.mockRejectedValue(new ApiError("Subscription already exists", 400));
  renderBilling();
  fireEvent.click(await screen.findByRole("button", { name: "Activar por $299 MXN/mes" }));
  await waitFor(() => expect(invalidateBillingSubscription).toHaveBeenCalled());
  expect(await screen.findAllByText(/Tu suscripción tiene un pago pendiente/)).toHaveLength(2);
  expect(screen.queryByText("Tu suscripción ya está activa. Actualizamos su estado.")).not.toBeInTheDocument();
});

it.each([null, "canceled", "incomplete"])("does not claim activation after checkout rejection with refreshed status %s", async (status) => {
  getBillingSubscription.mockResolvedValueOnce(billing(null)).mockResolvedValue(billing(status ? { status } : null));
  startCheckout.mockRejectedValue(new ApiError("Checkout rejected", 400));
  renderBilling();
  fireEvent.click(await screen.findByRole("button", { name: "Activar por $299 MXN/mes" }));
  expect(await screen.findByText(copy.billingView.operationError)).toBeVisible();
  expect(screen.queryByText("Tu suscripción ya está activa. Actualizamos su estado.")).not.toBeInTheDocument();
});

it("does not claim activation when subscription refresh fails after checkout rejection", async () => {
  getBillingSubscription.mockResolvedValueOnce(billing(null)).mockRejectedValue(new Error("Service unavailable"));
  startCheckout.mockRejectedValue(new ApiError("Checkout rejected", 400));
  renderBilling();
  fireEvent.click(await screen.findByRole("button", { name: "Activar por $299 MXN/mes" }));
  expect(await screen.findByText(copy.billingView.operationError)).toBeVisible();
  expect(screen.queryByText("Tu suscripción ya está activa. Actualizamos su estado.")).not.toBeInTheDocument();
});

it.each(["active", "trialing"])("confirms an existing subscription only with refreshed status %s", async (status) => {
  getBillingSubscription.mockResolvedValueOnce(billing(null)).mockResolvedValue(billing({ status }));
  startCheckout.mockRejectedValue(new ApiError("Subscription already exists", 400));
  renderBilling();
  fireEvent.click(await screen.findByRole("button", { name: "Activar por $299 MXN/mes" }));
  expect(await screen.findByText("Tu suscripción ya está activa. Actualizamos su estado.")).toBeVisible();
});


it("requires explicit tier selection and sends the selected plan", async () => {
  const result = billing(null);
  result.tiered_pricing_enabled = true;
  result.available_plans = [
    { code: "esencial", name: "Esencial", amount_minor_units: 39900, currency: "MXN", interval: "month", tax_inclusive: true, features: ["pos", "inventory", "sales_reports"], limits: { product_image_bytes: 250_000_000 } },
    { code: "gestion", name: "Gestión", amount_minor_units: 69900, currency: "MXN", interval: "month", tax_inclusive: true, features: ["pos", "advanced_reports"], limits: { product_image_bytes: 1_073_741_824 } },
  ];
  result.access = { ...result.access, plan_code: "gestion", features: ["pos", "advanced_reports"] };
  getBillingSubscription.mockResolvedValue(result); startCheckout.mockRejectedValue(new Error("offline"));
  renderBilling();
  const checkout = await screen.findByRole("button", { name: "Elige un plan para continuar" });
  expect(checkout).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: /Esencial/ }));
  expect(screen.getByText("IVA incluido en la mensualidad.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Activar por \$399/ }));
  await waitFor(() => expect(startCheckout).toHaveBeenCalledWith("esencial"));
  expect(screen.queryByText(copy.billingView.noSubscriptionBanner)).not.toBeInTheDocument();
});

it("does not offer checkout or changes when the authoritative catalog and portal are disabled", async () => {
  const result = billing(null); result.available_plans = []; result.tiered_pricing_enabled = false; result.portal_available = false;
  getBillingSubscription.mockResolvedValue(result); renderBilling();
  expect(await screen.findByText(/contratación de tu plan todavía no está disponible/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Activar por/ })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Administrar suscripción" })).not.toBeInTheDocument();
});


it.each([
  ["Ya tienes un proceso de pago para Esencial; elige ese plan para retomarlo.", "Ya tienes un proceso de pago para Esencial; elige ese plan para retomarlo."],
  ["Checkout cs_test_private_123 conflicts with tenant 00000000-0000-0000-0000-000000000001", copy.billingView.operationError],
])("keeps checkout conflicts on billing and shows only safe warning guidance: %s", async (detail, expected) => {
  getBillingSubscription.mockResolvedValue(billing(null));
  startCheckout.mockRejectedValue(new ApiError(JSON.stringify({ detail }), 409));
  const currentUrl = window.location.href;
  renderBilling();
  fireEvent.click(await screen.findByRole("button", { name: "Activar por $299 MXN/mes" }));
  const message = await screen.findByText(expected);
  expect(message.closest('[role="status"]')).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(window.location.href).toBe(currentUrl);
  expect(screen.getByRole("heading", { name: copy.billingView.title })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Activar por $299 MXN/mes" })).toBeEnabled();
  expect(startCheckout).toHaveBeenCalledOnce();
  expect(reconcileCheckout).not.toHaveBeenCalled();
  expect(document.body).not.toHaveTextContent("cs_test_private_123");
});


it("forces a fresh billing offer after returning to the page without beginning checkout", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  try {
    getBillingSubscription.mockResolvedValueOnce(billing(null)).mockResolvedValue({ ...billing(null), available_plans: [] });
    renderBilling();
    await screen.findByRole("button", { name: "Activar por $299 MXN/mes" });
    fireEvent(window, new Event("focus"));
    expect(await screen.findByText(/contratación de tu plan todavía no está disponible/)).toBeInTheDocument();
    expect(getBillingSubscription).toHaveBeenLastCalledWith({ force: true });
    expect(startCheckout).not.toHaveBeenCalled();
  } finally { visibility.mockRestore(); }
});


it("keeps checkout reconciliation running when focus and visibility return during confirmation", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  try {
    let finish!: (value: BillingSubscription) => void;
    getBillingSubscription.mockResolvedValue(billing({ status: "incomplete" }));
    reconcileCheckout.mockReturnValue(new Promise<BillingSubscription>((resolve) => { finish = resolve; }));
    renderSuccess();
    await waitFor(() => expect(reconcileCheckout).toHaveBeenCalledWith("cs_test_123"));
    fireEvent(window, new Event("focus"));
    fireEvent(document, new Event("visibilitychange"));
    expect(getBillingSubscription).toHaveBeenCalledOnce();
    expect(within(screen.getByRole("main")).getByText(copy.billingView.checkoutConfirmingTitle)).toBeInTheDocument();
    finish(billing({ status: "active" }));
    expect(await screen.findByText(copy.billingView.subscriptionActiveTitle)).toBeInTheDocument();
    expect(within(screen.getByRole("main")).queryByText(copy.billingView.checkoutConfirmingTitle)).not.toBeInTheDocument();
  } finally { visibility.mockRestore(); }
});

describe("BillingView visual progress and plan cards", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("draws the remaining signup trial days against the trial length", async () => {
    vi.useFakeTimers({ now: new Date("2026-07-05T00:00:00Z"), toFake: ["Date"] });
    getBillingSubscription.mockResolvedValue(billing(null));
    renderBilling();
    const meter = await screen.findByRole("meter", { name: "Días de prueba restantes: 3 de 7 días" });
    expect(meter).toHaveAttribute("aria-valuenow", "3");
    expect(meter).toHaveAttribute("aria-valuemax", "7");
  });

  it("draws the verified billing period from its real start and end", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-11T12:00:00Z"), toFake: ["Date"] });
    getBillingSubscription.mockResolvedValue(activeBilling({ status: "active",
      current_period_start: "2026-11-01T00:00:00Z", current_period_end: "2026-12-01T00:00:00Z", period_freshness: "verified",
    }));
    renderBilling();
    expect(await screen.findByRole("meter", { name: "Avance del periodo actual: 10 de 30 días" })).toBeInTheDocument();
  });

  it("omits the period meter while the period is not verified", async () => {
    getBillingSubscription.mockResolvedValue(activeBilling({ status: "active",
      current_period_start: "2026-11-01T00:00:00Z", current_period_end: "2026-12-01T00:00:00Z", period_freshness: "stale",
    }));
    renderBilling();
    await screen.findByText(copy.billingView.subscriptionActiveTitle);
    expect(screen.queryByRole("meter", { name: /Avance del periodo/ })).not.toBeInTheDocument();
  });

  it("shows server plans as cards with their features and keyboard selection", async () => {
    const result = billing(null);
    result.tiered_pricing_enabled = true;
    result.available_plans = [
      { code: "esencial", name: "Esencial", amount_minor_units: 39900, currency: "MXN", interval: "month", tax_inclusive: true, features: ["pos", "inventory"], limits: { product_image_bytes: 250_000_000 } },
      { code: "gestion", name: "Gestión", amount_minor_units: 69900, currency: "MXN", interval: "month", tax_inclusive: true, features: ["pos", "purchasing"], limits: { product_image_bytes: 1_073_741_824 } },
    ];
    getBillingSubscription.mockResolvedValue(result);
    renderBilling();
    const group = await screen.findByRole("radiogroup", { name: "Plan a contratar" });
    const essential = within(group).getByRole("radio", { name: "Esencial · $399 MXN/mes" });
    const gestion = within(group).getByRole("radio", { name: "Gestión · $699 MXN/mes" });
    expect(essential).toHaveAccessibleDescription(/Catálogo y existencias/);
    expect(gestion).toHaveAccessibleDescription(/Compras y proveedores/);
    expect(essential).toHaveAttribute("tabindex", "0");
    expect(gestion).toHaveAttribute("tabindex", "-1");
    essential.focus();
    fireEvent.keyDown(essential, { key: "ArrowRight" });
    expect(gestion).toHaveAttribute("aria-checked", "true");
    expect(gestion).toHaveFocus();
    expect(screen.getByRole("button", { name: /Activar por \$699/ })).toBeEnabled();
  });
});
