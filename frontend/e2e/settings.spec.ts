import { type Page, expect, test } from "@playwright/test";

async function mockAuthAsOwner(page: Page) {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({
      json: {
        authenticated: true,
        user: { id: "user-1", email: "owner@bakery.com", tenant_id: "tenant-1", role: "owner" },
        tenant_id: "tenant-1",
        tenant_name: "Bakery",
      },
    });
  });
}

test("settings receipt logo upload updates the preview", async ({ page }) => {
  await mockAuthAsOwner(page);
  let logoUrl: string | null = null;

  await page.route("**/api/v1/settings/business-profile", async (route) => {
    await route.fulfill({
      json: {
        tenant_id: "tenant-1",
        public_name: "Bakery",
        support_email: null,
        support_phone: null,
        timezone: "America/Mexico_City",
        locale: "es-MX",
        currency: "MXN",
      },
    });
  });
  await page.route("**/api/v1/settings/receipt", async (route) => {
    await route.fulfill({
      json: {
        tenant_id: "tenant-1",
        receipt_business_name: "Bakery",
        footer: null,
        tax_contact_text: null,
        logo_url: logoUrl,
      },
    });
  });
  await page.route("**/api/v1/employees", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/v1/employees/invitations", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({
      json: {
        subscription: null,
        access: { status: "trial_active", reason: "trial_active" },
      },
    });
  });
  await page.route("**/api/v1/settings/receipt/logo", async (route) => {
    logoUrl = "/api/v1/settings/receipt/logo/tenant-1?v=123";
    await route.fulfill({ json: { logo_url: logoUrl } });
  });
  await page.route("**/api/v1/settings/receipt/logo/tenant-1?v=123", async (route) => {
    await route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  });

  await page.goto("/settings/receipt");
  await page.setInputFiles("#receipt-logo-file", {
    name: "logo.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64",
    ),
  });

  await expect(page.locator('img[alt="Logo del recibo"]').first()).toBeVisible();
  await expect(page.getByText(/logo del recibo actualizado/i)).toBeVisible();
});
