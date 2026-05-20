import { expect, test } from "@playwright/test";

test("public landing explains the single Standard Plan", async ({ page }) => {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({ json: { authenticated: false } });
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: /en flujo constante/i })).toBeVisible();
  await expect(page.getByText(/299/).first()).toBeVisible();
  await expect(page.getByText(/199/)).toHaveCount(0);
  await expect(page.getByText("Un solo plan. Sin letra chica.")).toBeVisible();
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
