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
  await page.getByLabel("Business name").fill("Bakery Demo");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("S3cur3pass!");
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page.getByText("Account created. Local verification token is ready.")).toBeVisible();
  await expect(page.getByLabel("Verification token")).toHaveValue("verify-token-1");

  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page.getByText("Email verified. You can log in now.")).toBeVisible();
});

test("login posts credentials and navigates to the register", async ({ page }) => {
  await page.route("**/api/v1/auth/login", async (route) => {
    await route.fulfill({ json: { message: "Logged in." } });
  });
  await page.route("**/api/v1/auth/me", async (route) => {
    await route.fulfill({
      json: {
        user: { id: "user-1", email: "owner@example.com", tenant_id: "tenant-1", role: "owner" },
        tenant_id: "tenant-1",
        tenant_name: "Bakery Demo",
      },
    });
  });

  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("S3cur3pass!");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL("/register");
  await expect(page.getByRole("heading", { name: "Register" })).toBeVisible();
});
