import { expect, test, type Page } from "./fixtures";

const blocked = { allowed: false, reason: "unpaid", valid_until: null };

async function mockSession(page: Page, role: string, allowed = false) {
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: {
    authenticated: true,
    user: { id: "user-1", email: "owner@example.test", tenant_id: "tenant-1", role },
    tenant_id: "tenant-1", tenant_name: "Negocio de prueba", feature_flags: {},
    commercial_access: allowed
      ? { allowed: true, reason: "active", valid_until: new Date(Date.now() + 60_000).toISOString() }
      : blocked,
  } }));
  await page.route("**/api/v1/billing/subscription", route => route.fulfill({ json: {
    plan: { name: "Standard Plan", amount_minor_units: 29900, currency: "MXN", interval: "month" },
    subscription: null,
    access: { ...blocked, trialing: false, trial_ends_at: null, blocked_at: new Date().toISOString(), recovery_path: "/settings/billing", grace_period_ends_at: null },
  } }));
}

test("blocked owner recovers payment on mobile without mounting business modules", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSession(page, "owner");
  const businessRequests: string[] = [];
  page.on("request", request => {
    if (/\/api\/v1\/(reports|catalog|orders|shifts)\//.test(request.url())) businessRequests.push(request.url());
  });
  await page.goto("/reports");
  await expect(page).toHaveURL(/\/settings\/billing$/);
  await expect(page.getByRole("link", { name: "Exportar o eliminar los datos de mi negocio" })).toBeVisible();
  expect(businessRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("blocked employee sees owner instructions and can close the session", async ({ page }) => {
  await mockSession(page, "cashier");
  await page.goto("/register");
  await expect(page.getByRole("alert")).toContainText("persona dueña del negocio");
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  await expect(page.getByRole("button", { name: /cobrar/i })).toHaveCount(0);
});

test("a business API 402 closes an already authenticated register", async ({ page }) => {
  await mockSession(page, "owner", true);
  await page.route("**/api/v1/catalog/products*", route => route.fulfill({ status: 402, json: { detail: "payment_required" } }));
  await page.goto("/register");
  await expect(page).toHaveURL(/\/settings\/billing$/);
  await expect(page.getByRole("link", { name: "Exportar o eliminar los datos de mi negocio" })).toBeVisible();
  await expect(page.getByRole("button", { name: /cobrar/i })).toHaveCount(0);
});
