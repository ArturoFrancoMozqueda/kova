import { expect, test } from "./fixtures";

const AUTHED_SESSION = {
  authenticated: true,
  user: {
    id: "00000000-0000-0000-0000-000000000001",
    email: "owner@example.test",
    tenant_id: "00000000-0000-0000-0000-000000000002",
    role: "owner",
  },
  tenant_id: "00000000-0000-0000-0000-000000000002",
  tenant_name: "Example Bakery",
};

const STANDARD_PLAN = {
  name: "Standard Plan",
  amount_minor_units: 29900,
  currency: "MXN",
  interval: "month",
};

const BILLING_RECOVERY = "/settings/billing";

function mockAuthed(page: import("@playwright/test").Page) {
  return page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({ json: AUTHED_SESSION });
  });
}

function mockBilling(
  page: import("@playwright/test").Page,
  access: Record<string, unknown>,
  subscription: Record<string, unknown> | null = null,
) {
  return page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({ json: { plan: STANDARD_PLAN, subscription, access } });
  });
}

function mockEmptyApis(page: import("@playwright/test").Page) {
  return page.route("**/api/v1/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/auth/session") || url.includes("/billing/subscription")) {
      await route.fallback();
      return;
    }
    await route.fulfill({ json: {} });
  });
}

test("active subscription hides the billing banner on the dashboard", async ({ page }) => {
  await mockAuthed(page);
  await mockBilling(
    page,
    {
      allowed: true,
      reason: "active",
      trialing: false,
      trial_ends_at: null,
      blocked_at: null,
      recovery_path: BILLING_RECOVERY,
    },
    { status: "active" },
  );
  await mockEmptyApis(page);

  await page.goto("/dashboard");

  await expect(page.getByTestId("billing-banner")).toHaveCount(0);
});

test("blocked tenant sees billing banner with recovery link on the register", async ({ page }) => {
  await mockAuthed(page);
  await mockBilling(page, {
    allowed: false,
    reason: "trial_expired",
    trialing: false,
    trial_ends_at: "2026-01-01T00:00:00Z",
    blocked_at: "2026-05-01T00:00:00Z",
    recovery_path: BILLING_RECOVERY,
  });
  await mockEmptyApis(page);

  await page.goto("/register");

  const banner = page.getByTestId("billing-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute("data-billing-reason", "trial_expired");
  await expect(banner).toHaveAttribute("role", "alert");
  await expect(banner.getByRole("link", { name: /administrar suscripci[óo]n/i })).toHaveAttribute(
    "href",
    BILLING_RECOVERY,
  );
});

test("trial banner appears on the dashboard while access is still allowed", async ({ page }) => {
  await mockAuthed(page);
  await mockBilling(page, {
    allowed: true,
    reason: "signup_trial",
    trialing: true,
    trial_ends_at: "2026-06-01T00:00:00Z",
    blocked_at: null,
    recovery_path: BILLING_RECOVERY,
  });
  await mockEmptyApis(page);

  await page.goto("/dashboard");

  const banner = page.getByTestId("billing-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute("data-billing-reason", "signup_trial");
  await expect(banner).toHaveAttribute("role", "status");

  await banner.getByRole("button", { name: "Descartar" }).click();
  await expect(banner).toHaveAttribute("aria-hidden", "true");
  await expect(banner).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("billing-banner")).toHaveCount(0);
});
