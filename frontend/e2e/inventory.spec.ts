import { type Page, expect, test } from "@playwright/test";

async function mockAuthAs(page: Page, role: string) {
  await page.route("**/api/v1/auth/me", async (route) => {
    await route.fulfill({
      json: {
        user: { id: "user-1", email: "test@bakery.com", tenant_id: "tenant-1", role },
        tenant_id: "tenant-1",
        tenant_name: "Bakery",
      },
    });
  });
}

const stockItem = {
  product_id: "product-1",
  product_name: "Concha",
  sku: "CON-1",
  track_inventory: true,
  stock_on_hand: 3,
  low_stock_threshold: 5,
  is_low_stock: true,
};

test("inventory page supports adjustment, stock take, and threshold UI", async ({ page }) => {
  await mockAuthAs(page, "owner");
  let stock = [stockItem];

  await page.route("**/api/v1/inventory/stock", async (route) => {
    await route.fulfill({ json: stock });
  });
  await page.route("**/api/v1/inventory/low-stock", async (route) => {
    await route.fulfill({ json: stock.filter((item) => item.is_low_stock) });
  });
  await page.route("**/api/v1/inventory/products/product-1/adjustments", async (route) => {
    stock = [{ ...stockItem, stock_on_hand: 7, is_low_stock: false }];
    await route.fulfill({
      status: 201,
      json: {
        id: "movement-1",
        product_id: "product-1",
        movement_type: "adjustment",
        quantity_delta: 4,
        stock_on_hand: 7,
        reason: "opening_count",
      },
    });
  });
  await page.route("**/api/v1/inventory/products/product-1/stock-take", async (route) => {
    stock = [{ ...stockItem, stock_on_hand: 5, is_low_stock: true }];
    await route.fulfill({
      status: 201,
      json: {
        id: "movement-2",
        product_id: "product-1",
        movement_type: "stock_take",
        quantity_delta: -2,
        stock_on_hand: 5,
        reason: "physical_count",
      },
    });
  });
  await page.route("**/api/v1/inventory/products/product-1/low-stock-threshold", async (route) => {
    stock = [{ ...stockItem, low_stock_threshold: 2, is_low_stock: false }];
    await route.fulfill({ status: 200, json: stock[0] });
  });

  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Concha" })).toBeVisible();

  await page.getByRole("button", { name: "Adjust" }).click();
  await page.getByLabel("Quantity change").fill("4");
  await page.getByLabel("Reason").fill("opening_count");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Stock adjusted.")).toBeVisible();

  await page.getByRole("button", { name: "Stock take" }).click();
  await page.getByLabel("Counted quantity").fill("5");
  await page.getByLabel("Reason").fill("physical_count");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Stock take recorded.")).toBeVisible();

  await page.getByRole("button", { name: "Set threshold" }).click();
  await page.getByRole("spinbutton", { name: "Threshold" }).fill("2");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Low-stock threshold updated.")).toBeVisible();
});
