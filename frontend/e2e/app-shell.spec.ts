import { expect, test } from "@playwright/test";
import { markFirstUseToursSeen } from "./helpers";

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

test("skip link is first in tab order and moves focus to the content area", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({ json: authenticatedOwner });
  });
  await page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({ json: billingAllowed });
  });
  await page.route("**/api/v1/catalog/products", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/catalog/categories", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/inventory/stock", (route) => route.fulfill({ json: [] }));

  await page.goto("/dashboard");
  await expect(page.getByRole("navigation").first()).toBeVisible();

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Saltar al contenido" });
  await expect(skipLink).toBeFocused();

  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.id))
    .toBe("contenido-principal");
});

test("public landing explains the single Standard Plan", async ({ page }) => {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({ json: { authenticated: false } });
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: /cobra una vez.*entiende todo/i })).toBeVisible();
  await expect(page.getByText(/299/).first()).toBeVisible();
  await expect(page.getByText(/199/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /un solo plan/i })).toBeVisible();
});

test("protected routes redirect unauthenticated users to login", async ({ page }) => {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({ json: { authenticated: false } });
  });

  await page.goto("/dashboard");

  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("heading", { name: /iniciar sesi.n/i })).toBeVisible();
});

test("public landing suppresses app update prompts", async ({ page }) => {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({ json: { authenticated: false } });
  });

  await page.goto("/");

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("pos:pwa-update-available"));
  });

  await expect(page.getByRole("status")).toHaveCount(0);
});
