import { expect, test } from "@playwright/test";

test("app shell redirects unauthenticated users to login", async ({ page }) => {
  await page.route("**/api/v1/auth/me", async (route) => {
    await route.fulfill({ status: 401, body: "Unauthorized" });
  });

  await page.goto("/");

  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
});
