import { expect, test } from "@playwright/test";

test("app shell loads", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "POS" })).toBeVisible();
  await expect(page.getByText(/operations workspace/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /inventory/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /reports/i })).toBeVisible();
});
