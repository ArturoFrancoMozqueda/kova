import { expect, test } from "@playwright/test";

test("public landing explains the single Standard Plan", async ({ page }) => {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({ json: { authenticated: false } });
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: /focused POS SaaS/i })).toBeVisible();
  await expect(page.getByText("$199", { exact: true })).toBeVisible();
  await expect(page.getByText("MXN/month", { exact: true })).toBeVisible();
  await expect(page.getByText("No Basic, Pro, Premium")).toBeVisible();
});

test("protected routes redirect unauthenticated users to login", async ({ page }) => {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({ json: { authenticated: false } });
  });

  await page.goto("/dashboard");

  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
});
