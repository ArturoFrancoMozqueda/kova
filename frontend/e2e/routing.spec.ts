import { expect, test } from "@playwright/test";

const authenticatedOwner = {
  authenticated: true,
  user: {
    id: "user-1",
    email: "owner@example.com",
    tenant_id: "tenant-1",
    role: "owner",
  },
  tenant_id: "tenant-1",
  tenant_name: "Testing",
};

const billingAllowed = {
  plan: { name: "Standard Plan", amount_minor_units: 29900, currency: "MXN", interval: "month" },
  subscription: null,
  access: {
    allowed: true,
    reason: "active",
    trialing: false,
    trial_ends_at: null,
    blocked_at: null,
    recovery_path: "/settings/billing",
  },
};

async function mockAuthenticated(page: import("@playwright/test").Page) {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({ json: authenticatedOwner });
  });
  await page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({ json: billingAllowed });
  });
  // Minimal mocks for dashboard so it doesn't error out after a redirect.
  await page.route("**/api/v1/catalog/products", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/catalog/categories", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/inventory/stock", (route) => route.fulfill({ json: [] }));
}

test("404 page renders for unknown routes when unauthenticated", async ({ page }) => {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({ json: { authenticated: false } });
  });

  await page.goto("/this-route-does-not-exist");

  await expect(page.getByRole("heading", { name: /esta página no existe/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /volver al panel/i })).toBeVisible();
});

test("/caja redirects to /register for authenticated users", async ({ page }) => {
  await mockAuthenticated(page);
  await page.goto("/caja");

  await expect(page).toHaveURL(/\/register$/);
});

test("/reportes redirects to /reports for authenticated users", async ({ page }) => {
  await mockAuthenticated(page);
  await page.goto("/reportes");

  await expect(page).toHaveURL(/\/reports$/);
});
