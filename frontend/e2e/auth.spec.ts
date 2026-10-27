import { expect, test } from "./fixtures";

// Behaviour change (2026-08): signup no longer parks the new owner on a
// check-your-email screen — a third of every account ever created never
// confirmed and therefore never got in. The account now signs straight in, and
// verification is enforced at the paid boundary instead. See
// docs/audits/DIAGNOSTICO-CRECIMIENTO-2026-08-09.md.
async function mockSignupReceived(page: import("@playwright/test").Page) {
  await page.route("**/api/v1/auth/signup", async (route) => {
    await route.fulfill({
      status: 201,
      json: {
        message: "Solicitud recibida. Puedes intentar iniciar sesión o revisar tu correo para continuar.",
        reason: "signup_received",
        user_id: null,
        tenant_id: null,
        dev_verification_token: null,
      },
    });
  });
}

async function fillSignupForm(page: import("@playwright/test").Page, email = "owner@example.com") {
  await page.getByLabel(/nombre del negocio/i).fill("Bakery Demo");
  await page.getByLabel(/correo/i).fill(email);
  await page.getByLabel(/contrase[ñn]a/i).fill("S3cur3pass!");
  await page.locator("#acceptedTerms").check();
  await page.getByRole("button", { name: /crear cuenta/i }).click();
}

test("signup signs the new owner in instead of waiting on their inbox", async ({ page }) => {
  await mockSignupReceived(page);
  await page.route("**/api/v1/auth/login", async (route) => {
    await route.fulfill({ json: { message: "Logged in." } });
  });

  await page.goto("/signup");
  const loginRequest = page.waitForRequest(
    (request) =>
      request.url().includes("/api/v1/auth/login") && request.method() === "POST",
  );
  await fillSignupForm(page);

  await expect(await loginRequest).toBeTruthy();
});

test("signup keeps a neutral recovery screen when auto-login is rate limited", async ({ page }) => {
  await mockSignupReceived(page);
  await page.route("**/api/v1/auth/login", async (route) => {
    await route.fulfill({ status: 429, body: "Too many requests" });
  });
  await page.goto("/signup");
  await fillSignupForm(page);
  await expect(page.getByRole("status").filter({ hasText: /Solicitud recibida/i })).toBeVisible();
  await expect(page.getByLabel(/token de verificaci[óo]n/i)).toHaveCount(0);
  await page.getByRole("link", { name: /¿Olvidaste tu contraseña/i }).click();
  await expect(page).toHaveURL("/forgot-password");
  await expect(page.getByRole("heading", { name: /Recupera tu acceso/i })).toBeVisible();
});

for (const account of ["new", "verified", "pending"]) {
  test(`signup acknowledgement stays neutral for ${account} account when password login fails`, async ({ page }) => {
    // The backend integration suite verifies all real account states produce
    // this same public response. The browser must never infer a state from it.
    await mockSignupReceived(page);
    await page.route("**/api/v1/auth/login", async (route) => {
      await route.fulfill({ status: 401, json: { detail: "Invalid credentials" } });
    });
    await page.goto("/signup");
    await fillSignupForm(page, `${account}@example.com`);
    await expect(page.getByRole("status").filter({ hasText: /Solicitud recibida/i })).toBeVisible();
    await expect(page.getByText(/Este correo ya tiene una cuenta|Ya tenías una cuenta sin verificar/i)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Volver a iniciar sesión/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /¿Olvidaste tu contraseña/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Reenviar en/i })).toBeDisabled();
  });
}

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
  await expect(page.getByRole("heading", { name: "Centro de control", exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByText(/Bakery Demo/)).toBeVisible();
});
