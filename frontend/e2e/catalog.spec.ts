import { type Page, expect, test } from "@playwright/test";

async function mockAuthAs(page: Page, role: string) {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({
      json: {
        authenticated: true,
        user: { id: "user-1", email: "test@bakery.com", tenant_id: "tenant-1", role },
        tenant_id: "tenant-1",
        tenant_name: "Bakery",
      },
    });
  });
}

const categories = [
  { id: "cat-1", tenant_id: "tenant-1", name: "Pan", description: null, sort_order: 0, is_active: true },
];

const products = [
  {
    id: "prod-1",
    tenant_id: "tenant-1",
    category_id: "cat-1",
    name: "Concha",
    description: null,
    sku: "CON-001",
    price_amount: "18.50",
    track_inventory: false,
    low_stock_threshold: null,
    is_active: true,
    modifier_groups: [],
  },
];

async function mockCatalogApis(page: Page, catList = categories, prodList = products) {
  await page.route("**/api/v1/catalog/categories", async (route) => {
    await route.fulfill({ json: catList });
  });
  await page.route("**/api/v1/catalog/products", async (route) => {
    await route.fulfill({ json: prodList });
  });
  await page.route("**/api/v1/catalog/modifier-groups", async (route) => {
    await route.fulfill({ json: [] });
  });
}

test("catalog page loads categories and products for owner", async ({ page }) => {
  await mockAuthAs(page, "owner");
  await mockCatalogApis(page);

  await page.goto("/catalog");

  await expect(page.getByRole("heading", { name: "Catalog" })).toBeVisible();
  await expect(page.getByText("Pan")).toBeVisible();
  await expect(page.getByText("Concha")).toBeVisible();
  await expect(page.getByRole("button", { name: "New category" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New product" })).toBeVisible();
});

test("catalog page lets owner create a category", async ({ page }) => {
  await mockAuthAs(page, "owner");
  let categoryList = [...categories];
  await page.route("**/api/v1/catalog/categories", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: categoryList });
    } else {
      const newCat = { ...categories[0], id: "cat-2", name: "Pasteles" };
      categoryList = [...categoryList, newCat];
      await route.fulfill({ status: 201, json: newCat });
    }
  });
  await page.route("**/api/v1/catalog/products", async (route) => {
    await route.fulfill({ json: products });
  });
  await page.route("**/api/v1/catalog/modifier-groups", async (route) => {
    await route.fulfill({ json: [] });
  });

  await page.goto("/catalog");
  await page.getByRole("button", { name: "New category" }).click();
  await page.getByLabel("Category name").fill("Pasteles");
  await page.getByRole("button", { name: "Save category" }).click();

  await expect(page.getByText("Category created.")).toBeVisible();
});

test("catalog page hides edit controls for cashier", async ({ page }) => {
  await mockAuthAs(page, "cashier");
  await mockCatalogApis(page);

  await page.goto("/catalog");

  await expect(page.getByRole("heading", { name: "Catalog" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New category" })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "New product" })).not.toBeVisible();
});
