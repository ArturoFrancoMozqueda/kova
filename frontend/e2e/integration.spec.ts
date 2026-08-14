import { expect, test } from "./fixtures";
import {
  createTenantThroughUi,
  integrationEnabled,
  logoutThroughUi,
} from "./integration-helpers";

test.describe("stack efímero sin mocks", () => {
  test.skip(!integrationEnabled(), "Requiere docker-compose.test.yml");

  test("frontend, API, Postgres y RLS aíslan dos tenants creados por la API pública", async ({
    page,
  }) => {
    const productName = `Producto aislado ${Date.now()}`;

    await createTenantThroughUi(page, "tenant-a");
    await page.goto("/catalog");
    await expect(page.getByRole("heading", { name: /cat[aá]logo/i })).toBeVisible();
    await page.getByRole("button", { name: /nuevo producto/i }).click();
    await page.getByLabel(/nombre del producto/i).fill(productName);
    await page.getByLabel(/^precio/i).fill("37.50");
    await page.getByRole("button", { name: /guardar producto/i }).click();
    await expect(page.getByText(productName, { exact: true })).toBeVisible();

    await logoutThroughUi(page);
    await createTenantThroughUi(page, "tenant-b");
    await page.goto("/catalog");
    await expect(page.getByRole("heading", { name: /cat[aá]logo/i })).toBeVisible();
    await expect(page.getByText(productName, { exact: true })).toHaveCount(0);
  });
});
