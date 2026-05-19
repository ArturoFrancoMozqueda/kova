import { type Page, expect, test } from "@playwright/test";

const plan = {
  name: "Standard Plan",
  amount_minor_units: 19900,
  currency: "MXN",
  interval: "month",
};

const activeAccess = {
  allowed: true,
  reason: "active",
  trialing: false,
  trial_ends_at: null,
  blocked_at: null,
  recovery_path: "/settings/billing",
};

const activeSubscription = {
  id: "sub-local-1",
  tenant_id: "tenant-1",
  status: "active",
  plan_name: "Standard Plan",
  currency: "MXN",
  amount_minor_units: 19900,
  current_period_start: "2026-05-01T00:00:00Z",
  current_period_end: "2026-06-01T00:00:00Z",
  trial_ends_at: null,
  past_due_at: null,
  grace_period_ends_at: null,
  cancel_at_period_end: false,
  canceled_at: null,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
};

async function mockAuthAs(page: Page, role: string) {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({
      json: {
        authenticated: true,
        user: { id: "user-1", email: "test@bakery.com", tenant_id: "tenant-1", role },
        tenant_id: "tenant-1",
        tenant_name: "Bakery",
      },
    });
  });
}

test("billing page displays the Standard Plan and active subscription", async ({ page }) => {
  await mockAuthAs(page, "owner");
  await page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({ json: { plan, subscription: activeSubscription, access: activeAccess } });
  });

  await page.goto("/settings/billing");

  await expect(page.getByRole("heading", { name: /facturaci[óo]n/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /plan standard/i })).toBeVisible();
  await expect(page.getByText(/\$199\.00/).first()).toBeVisible();
  await expect(page.getByText(/activo/i).first()).toBeVisible();
});

test("billing page redirects to checkout and handles cancellation", async ({ page }) => {
  await mockAuthAs(page, "owner");
  await page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({ json: { plan, subscription: activeSubscription, access: activeAccess } });
  });
  await page.route("**/api/v1/billing/checkout", async (route) => {
    await route.fulfill({
      status: 201,
      json: {
        checkout_url: "https://checkout.stripe.test/session/cs_test_123",
        checkout_session_id: "cs_test_123",
      },
    });
  });
  await page.route("https://checkout.stripe.test/**", async (route) => {
    await route.fulfill({ body: "Stripe Checkout" });
  });

  await page.goto("/settings/billing");
  await page.getByRole("button", { name: /activar por/i }).click();
  await expect(page).toHaveURL("https://checkout.stripe.test/session/cs_test_123");
});

test("billing page shows past due recovery and return states", async ({ page }) => {
  await mockAuthAs(page, "owner");
  await page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({
      json: {
        plan,
        subscription: {
          ...activeSubscription,
          status: "past_due",
          past_due_at: "2026-05-10T00:00:00Z",
          grace_period_ends_at: "2026-05-17T00:00:00Z",
        },
        access: { ...activeAccess, reason: "past_due" },
      },
    });
  });

  await page.goto("/settings/billing/success");

  await expect(page.getByText(/pago completado\. actualizando el estado de la suscripci[óo]n/i).first()).toBeVisible();
  await expect(page.getByText(/pago vencido\. recupera la facturaci[óo]n para mantener acceso sin interrupciones/i)).toBeVisible();
  await expect(page.getByText(/fin del periodo de gracia/i)).toBeVisible();
});

test("billing page lets owners request subscription cancellation", async ({ page }) => {
  await mockAuthAs(page, "owner");
  await page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({ json: { plan, subscription: activeSubscription, access: activeAccess } });
  });
  await page.route("**/api/v1/billing/cancel", async (route) => {
    await route.fulfill({
      json: {
        plan,
        subscription: {
          ...activeSubscription,
          cancel_at_period_end: true,
        },
        access: activeAccess,
      },
    });
  });

  await page.goto("/settings/billing");
  await page.getByRole("button", { name: /cancelar suscripci[óo]n/i }).click();

  await expect(page.getByText(/se cancela al final del periodo/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /cancelar suscripci[óo]n/i })).toBeDisabled();
});

test("billing page hides data without billing permission", async ({ page }) => {
  await mockAuthAs(page, "cashier");

  await page.goto("/settings/billing");

  await expect(page.getByText(/facturaci[óo]n no disponible para tu rol/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Standard Plan" })).toHaveCount(0);
});
