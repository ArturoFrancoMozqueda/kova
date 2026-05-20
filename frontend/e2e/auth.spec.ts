import { expect, test } from "@playwright/test";

test("signup can verify a local dev token", async ({ page }) => {
  await page.route("**/api/v1/auth/signup", async (route) => {
    await route.fulfill({
      status: 201,
      json: {
        message: "Account created. Verify your email to log in.",
        user_id: "user-1",
        tenant_id: "tenant-1",
        dev_verification_token: "verify-token-1",
      },
    });
  });
  await page.route("**/api/v1/auth/verify", async (route) => {
    await route.fulfill({ json: { message: "Email verified." } });
  });

  await page.goto("/signup");
  await page.getByLabel(/nombre del negocio/i).fill("Bakery Demo");
  await page.getByLabel(/correo/i).fill("owner@example.com");
  await page.getByLabel(/contrase[ñn]a/i).fill("S3cur3pass!");
  await page.getByRole("button", { name: /crear cuenta/i }).click();

  await expect(page.getByText(/cuenta creada\. el token local de verificaci[óo]n est[áa] listo/i)).toBeVisible();
  await expect(page.getByLabel(/token de verificaci[óo]n/i)).toHaveValue("verify-token-1");

  await page.getByRole("button", { name: /verificar correo/i }).click();
  await expect(page.getByText(/correo verificado\. ya puedes iniciar sesi[óo]n/i)).toBeVisible();
});

test("login posts credentials and navigates owners to the dashboard", async ({ page }) => {
  await page.route("**/api/v1/auth/login", async (route) => {
    await route.fulfill({ json: { message: "Logged in." } });
  });
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({
      json: {
        authenticated: true,
        user: { id: "user-1", email: "owner@example.com", tenant_id: "tenant-1", role: "owner" },
        tenant_id: "tenant-1",
        tenant_name: "Bakery Demo",
      },
    });
  });
  await page.route("**/api/v1/catalog/products", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/v1/catalog/categories", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/v1/catalog/modifier-groups", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/v1/inventory/stock", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/v1/inventory/low-stock", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({
      json: {
        plan: { name: "Standard Plan", amount_minor_units: 29900, currency: "MXN" },
        subscription: null,
      },
    });
  });
  await page.route("**/api/v1/reports/sales-summary**", async (route) => {
    await route.fulfill({
      json: {
        start_date: "2026-05-14",
        end_date: "2026-05-14",
        gross_sales: "0.00",
        refund_total: "0.00",
        net_sales: "0.00",
        order_count: 0,
        refund_count: 0,
        void_count: 0,
      },
    });
  });
  await page.route("**/api/v1/reports/payment-breakdown**", async (route) => {
    await route.fulfill({ json: { start_date: "2026-05-14", end_date: "2026-05-14", payments: [] } });
  });
  await page.route("**/api/v1/reports/top-products**", async (route) => {
    await route.fulfill({ json: { start_date: "2026-05-14", end_date: "2026-05-14", products: [] } });
  });

  await page.goto("/login");
  await page.getByLabel(/correo/i).fill("owner@example.com");
  await page.getByLabel(/contrase[ñn]a/i).fill("S3cur3pass!");
  await page.getByRole("button", { name: /iniciar sesi[óo]n/i }).click();

  await expect(page).toHaveURL("/dashboard");
  await expect(page.getByRole("heading", { name: "Bakery Demo" })).toBeVisible();
});
