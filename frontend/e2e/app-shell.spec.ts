import { expect, test } from "@playwright/test";

test("public landing explains the single Standard Plan", async ({ page }) => {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({ json: { authenticated: false } });
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: /en flujo constante/i })).toBeVisible();
  await expect(page.getByText(/199/).first()).toBeVisible();
  await expect(page.getByText(/299/)).toHaveCount(0);
  await expect(page.getByText("Un solo plan. Sin letra chica.")).toBeVisible();
});

test("protected routes redirect unauthenticated users to login", async ({ page }) => {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({ json: { authenticated: false } });
  });

  await page.goto("/dashboard");

  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("heading", { name: /iniciar sesi[óo]n/i })).toBeVisible();
});

test("returning browsers get a visible app update path", async ({ page }) => {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({ json: { authenticated: false } });
  });

  await page.goto("/");

  await page.evaluate(() => {
    const testWindow = window as Window & { __pwaApplyCount?: number };
    testWindow.__pwaApplyCount = 0;
    window.addEventListener("pos:pwa-apply-update", () => {
      testWindow.__pwaApplyCount = (testWindow.__pwaApplyCount ?? 0) + 1;
    });
    window.dispatchEvent(new CustomEvent("pos:pwa-update-available"));
  });

  await expect(page.getByRole("status")).toContainText(/nueva versi[óo]n disponible/i);
  await expect(page.getByText(/actualiza cuando la caja est[ée] libre/i)).toBeVisible();

  await page.getByRole("button", { name: /m[áa]s tarde/i }).click();
  await expect(page.getByRole("status")).toHaveCount(0);

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("pos:pwa-update-available"));
  });

  await page.getByRole("button", { name: /actualizar ahora/i }).click();

  await expect
    .poll(async () =>
      page.evaluate(() => (window as Window & { __pwaApplyCount?: number }).__pwaApplyCount ?? 0)
    )
    .toBe(1);
});
