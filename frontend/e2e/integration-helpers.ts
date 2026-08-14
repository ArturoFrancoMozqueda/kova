import { expect, type Page } from "@playwright/test";

export function integrationEnabled(): boolean {
  return process.env.KOVA_INTEGRATION === "1";
}

export async function createTenantThroughUi(
  page: Page,
  label: string,
): Promise<{ email: string; password: string }> {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const credentials = {
    email: `audit-${label}-${suffix}@example.test`,
    password: "Kova-Test-Only-2026!",
  };

  await page.goto("/signup");
  await page.getByLabel(/nombre del negocio/i).fill(`Audit ${label} ${suffix}`);
  await page.getByLabel(/correo/i).fill(credentials.email);
  await page.getByLabel(/contrase[ñn]a/i).fill(credentials.password);
  await page.locator("#acceptedTerms").check();
  await page.getByRole("button", { name: /crear cuenta/i }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });
  await expect(page.locator("main")).toBeVisible();
  return credentials;
}

export async function logoutThroughUi(page: Page): Promise<void> {
  await page.getByRole("button", { name: /cerrar sesi[oó]n/i }).click();
  await page.waitForURL(/\/login$/, { timeout: 15_000 });
}
