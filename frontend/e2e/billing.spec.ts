import { type Page, expect, test } from "@playwright/test";

const plan = {
  name: "Standard Plan",
  amount_minor_units: 29900,
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
  amount_minor_units: 29900,
  current_period_start: "2026-05-01T00:00:00Z",
  current_period_end: "2026-06-01T00:00:00Z",
  period_freshness: "stale",
  trial_ends_at: null,
  past_due_at: null,
  grace_period_ends_at: null,
  cancel_at_period_end: false,
  canceled_at: null,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
};

const expiredAccess = {
  ...activeAccess,
  allowed: false,
  reason: "trial_expired",
  blocked_at: "2026-05-08T00:00:00Z",
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

  await expect(page.getByRole("heading", { name: /suscripci[óo]n/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /standard plan/i })).toBeVisible();
  await expect(page.getByText("$299 MXN/mes")).toBeVisible();
  await expect(page.getByText(/activo/i).first()).toBeVisible();
  await expect(page.getByText(/tu suscripci[oó]n est[aá] activa/i)).toBeVisible();
  await expect(page.getByText(/checkout no necesario/i)).toBeVisible();
  await expect(page.getByText(/estamos verificando tu pr[óo]xima fecha de renovaci[óo]n/i)).toBeVisible();
  await expect(page.getByText(/^pr[óo]xima renovaci[óo]n$/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /activar por/i })).toHaveCount(0);
});

test("billing page displays a renewal date only for a verified period", async ({ page }) => {
  await mockAuthAs(page, "owner");
  await page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({
      json: {
        plan,
        subscription: {
          ...activeSubscription,
          current_period_end: "2026-08-20T18:00:00Z",
          period_freshness: "verified",
        },
        access: activeAccess,
      },
    });
  });

  await page.goto("/settings/billing");

  await expect(page.getByText(/^pr[óo]xima renovaci[óo]n$/i)).toBeVisible();
  await expect(page.getByText(/20 ago 2026/i)).toBeVisible();
  await expect(page.getByText(/estamos verificando tu pr[óo]xima fecha/i)).toHaveCount(0);
});

test("billing page redirects to checkout and handles cancellation", async ({ page }) => {
  await mockAuthAs(page, "owner");
  await page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({ json: { plan, subscription: null, access: expiredAccess } });
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

test("billing page hides checkout for a Stripe trialing subscription", async ({ page }) => {
  await mockAuthAs(page, "owner");
  await page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({
      json: {
        plan,
        subscription: {
          ...activeSubscription,
          status: "trialing",
          trial_ends_at: "2026-05-25T00:00:00Z",
        },
        access: { ...activeAccess, reason: "active", trialing: true },
      },
    });
  });

  await page.goto("/settings/billing");

  await expect(page.getByText(/tu suscripci[óo]n est[áa] en prueba/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /activar por/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /cancelar suscripci[óo]n/i })).toBeEnabled();
});

test("billing page recovers when checkout reports an already active subscription", async ({ page }) => {
  await mockAuthAs(page, "owner");
  let checkoutAttempted = false;
  await page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({
      json: checkoutAttempted
        ? { plan, subscription: activeSubscription, access: activeAccess }
        : { plan, subscription: null, access: expiredAccess },
    });
  });
  await page.route("**/api/v1/billing/checkout", async (route) => {
    checkoutAttempted = true;
    await route.fulfill({
      status: 400,
      body: JSON.stringify({ detail: "Tenant already has an active subscription" }),
      contentType: "application/json",
    });
  });

  await page.goto("/settings/billing");
  await page.getByRole("button", { name: /activar por/i }).click();

  await expect(page.getByText(/tu suscripci[óo]n ya est[áa] activa/i)).toBeVisible();
  await expect(page.getByText(/checkout no necesario/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /activar por/i })).toHaveCount(0);
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

  await expect(page.getByText(/estamos confirmando tu suscripci[óo]n/i).first()).toBeVisible();
  await expect(page.getByText(/no repitas el pago/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /contactar soporte/i })).toHaveAttribute(
    "href",
    "mailto:posprojectsupport@gmail.com",
  );
  await expect(page.getByText(/pago vencido\. recupera la suscripci[óo]n para mantener acceso sin interrupciones/i)).toBeVisible();
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

  const cancelDialog = page.getByRole("dialog");
  await expect(cancelDialog).toBeVisible();
  await cancelDialog.getByRole("button", { name: /^cancelar suscripci[óo]n$/i }).click();

  await expect(page.getByText(/se cancela al final del periodo/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /cancelar suscripci[óo]n/i })).toBeDisabled();
});

test("billing page hides data without billing permission", async ({ page }) => {
  await mockAuthAs(page, "cashier");

  await page.goto("/settings/billing");

  await expect(page.getByText(/suscripci[óo]n no disponible para tu rol/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Standard Plan" })).toHaveCount(0);
});
