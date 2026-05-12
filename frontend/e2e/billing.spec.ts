import { type Page, expect, test } from "@playwright/test";

const plan = {
  name: "Standard Plan",
  amount_minor_units: 19900,
  currency: "MXN",
  interval: "month",
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
  await page.route("**/api/v1/auth/me", async (route) => {
    await route.fulfill({
      json: {
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
    await route.fulfill({ json: { plan, subscription: activeSubscription } });
  });

  await page.goto("/settings/billing");

  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Standard Plan" })).toBeVisible();
  await expect(page.getByText("MX$199.00")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active" })).toBeVisible();
});

test("billing page redirects to checkout and handles cancellation", async ({ page }) => {
  await mockAuthAs(page, "owner");
  await page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({ json: { plan, subscription: activeSubscription } });
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
  await page.getByRole("button", { name: "Start checkout" }).click();
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
      },
    });
  });

  await page.goto("/settings/billing/success");

  await expect(page.getByText("Checkout completed. Subscription status is refreshing.")).toBeVisible();
  await expect(page.getByText("Payment is past due. Recover billing to keep uninterrupted access.")).toBeVisible();
  await expect(page.getByText(/Grace period ends/)).toBeVisible();
});

test("billing page lets owners request subscription cancellation", async ({ page }) => {
  await mockAuthAs(page, "owner");
  await page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({ json: { plan, subscription: activeSubscription } });
  });
  await page.route("**/api/v1/billing/cancel", async (route) => {
    await route.fulfill({
      json: {
        plan,
        subscription: {
          ...activeSubscription,
          cancel_at_period_end: true,
        },
      },
    });
  });

  await page.goto("/settings/billing");
  await page.getByRole("button", { name: "Cancel subscription" }).click();

  await expect(page.getByText("Cancels at period end")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel subscription" })).toBeDisabled();
});

test("billing page hides data without billing permission", async ({ page }) => {
  await mockAuthAs(page, "cashier");

  await page.goto("/settings/billing");

  await expect(page.getByText("Billing unavailable for your role.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Standard Plan" })).toHaveCount(0);
});
