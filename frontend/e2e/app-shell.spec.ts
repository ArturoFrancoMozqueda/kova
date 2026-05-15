import { expect, test } from "@playwright/test";

test("public landing explains the single Standard Plan", async ({ page }) => {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({ json: { authenticated: false } });
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: /bajo control/i })).toBeVisible();
  await expect(page.getByText("$199", { exact: true })).toBeVisible();
  await expect(page.getByText("MXN", { exact: true })).toBeVisible();
  await expect(page.getByText("Un solo plan. Sin letra chica.")).toBeVisible();
});

test("protected routes redirect unauthenticated users to login", async ({ page }) => {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({ json: { authenticated: false } });
  });

  await page.goto("/dashboard");

  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
});
