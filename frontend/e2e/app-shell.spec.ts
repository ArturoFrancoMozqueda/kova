import { expect, test } from "@playwright/test";

test("app shell loads", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "POS" })).toBeVisible();
  await expect(page.getByText(/offline queue shell/i)).toBeVisible();
});
