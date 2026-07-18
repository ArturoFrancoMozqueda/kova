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

const stockItem = {
  product_id: "product-1",
  product_name: "Concha",
  sku: "CON-1",
  track_inventory: true,
  stock_on_hand: 3,
  low_stock_threshold: 5,
  is_low_stock: true,
};

const stockItems = [
  {
    product_id: "product-1",
    product_name: "Leche Entera",
    sku: "LEC-1",
    track_inventory: true,
    stock_on_hand: 2,
    low_stock_threshold: 5,
    is_low_stock: true,
  },
  {
    product_id: "product-2",
    product_name: "Cafe Grano",
    sku: "CAF-1",
    track_inventory: true,
    stock_on_hand: 12,
    low_stock_threshold: 4,
    is_low_stock: false,
  },
  {
    product_id: "product-3",
    product_name: "Vasos",
    sku: "VAS-1",
    track_inventory: true,
    stock_on_hand: 50,
    low_stock_threshold: 20,
    is_low_stock: false,
  },
];

test("inventory marks zero or negative tracked stock as sold out", async ({ page }) => {
  await mockAuthAs(page, "owner");
  const depletedStock = [
    {
      ...stockItem,
      product_name: "Agua mineral",
      stock_on_hand: -1,
      is_low_stock: true,
    },
  ];

  await page.route("**/api/v1/inventory/stock", async (route) => {
    await route.fulfill({ json: depletedStock });
  });
  await page.route("**/api/v1/inventory/low-stock", async (route) => {
    await route.fulfill({ json: depletedStock });
  });
  await page.route("**/api/v1/inventory/velocity", async (route) => {
    await route.fulfill({
      json: [
        {
          product_id: "product-1",
          product_name: "Agua mineral",
          stock_on_hand: -1,
          units_per_day_7d: "1.00",
          days_until_out: "0",
        },
      ],
    });
  });

  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "Agua mineral" })).toBeVisible();
  await expect(page.getByText("Agotado", { exact: true })).toBeVisible();
  await expect(page.getByText("Ya agotado")).toBeVisible();
  await expect(page.getByText("Bajo", { exact: true })).not.toBeVisible();
});

test("inventory page supports adjustment, stock take, and threshold UI", async ({ page }) => {
  await mockAuthAs(page, "owner");
  let stock = [stockItem];
  const adjustmentBodies: Array<Record<string, unknown>> = [];

  await page.route("**/api/v1/inventory/stock", async (route) => {
    await route.fulfill({ json: stock });
  });
  await page.route("**/api/v1/inventory/low-stock", async (route) => {
    await route.fulfill({ json: stock.filter((item) => item.is_low_stock) });
  });
  await page.route("**/api/v1/inventory/products/product-1/adjustments", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    adjustmentBodies.push(body);
    const nextStock = stock[0].stock_on_hand + Number(body.quantity_delta);
    stock = [{ ...stockItem, stock_on_hand: nextStock, is_low_stock: nextStock <= 5 }];
    await route.fulfill({
      status: 201,
      json: {
        id: "movement-1",
        product_id: "product-1",
        movement_type: "adjustment",
        quantity_delta: body.quantity_delta,
        stock_on_hand: nextStock,
        reason: body.reason,
        reason_code: body.reason_code,
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
  await expect(page.getByRole("heading", { name: /inventario/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Concha" })).toBeVisible();

  await page.getByRole("button", { name: /ajustar/i }).click();
  await page.getByLabel(/cambio de cantidad/i).fill("4");
  await page.getByLabel(/motivo/i).fill("opening_count");
  await page.getByRole("button", { name: /guardar/i }).click();
  await expect(page.getByText(/stock ajustado/i)).toBeVisible();

  await page.getByRole("button", { name: /ajustar/i }).click();
  await page.getByLabel(/cambio de cantidad/i).fill("-2");
  await page.getByLabel(/tipo de salida/i).selectOption("caducidad");
  await page.getByLabel(/^motivo$/i).fill("Caducó en vitrina");
  await page.getByRole("button", { name: /guardar/i }).click();
  await expect(page.getByText(/stock ajustado/i)).toBeVisible();
  expect(adjustmentBodies[1]).toMatchObject({
    quantity_delta: -2,
    reason: "Caducó en vitrina",
    reason_code: "caducidad",
  });

  await page.getByRole("button", { name: /^conteo$/i }).click();
  await page.getByLabel(/cantidad contada/i).fill("5");
  await page.getByLabel(/motivo/i).fill("physical_count");
  await page.getByRole("button", { name: /guardar/i }).click();
  await expect(page.getByText(/conteo registrado/i)).toBeVisible();

  await page.getByRole("button", { name: /definir umbral/i }).click();
  await page.getByRole("spinbutton", { name: /umbral/i }).fill("2");
  await page.getByRole("button", { name: /guardar/i }).click();
  await expect(page.getByText(/umbral de stock bajo actualizado/i)).toBeVisible();
});

test("inventory supports search filter and sort at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAuthAs(page, "owner");

  await page.route("**/api/v1/inventory/stock", async (route) => {
    await route.fulfill({ json: stockItems });
  });
  await page.route("**/api/v1/inventory/low-stock", async (route) => {
    await route.fulfill({ json: stockItems.filter((item) => item.is_low_stock) });
  });
  await page.route("**/api/v1/inventory/velocity", async (route) => {
    await route.fulfill({ json: [] });
  });

  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: /inventario/i })).toBeVisible();

  await page.getByLabel(/buscar inventario/i).fill("leche");
  await expect(page.getByRole("heading", { name: "Leche Entera" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cafe Grano" })).not.toBeVisible();

  await page.getByLabel(/buscar inventario/i).clear();
  await page.getByLabel(/filtrar inventario/i).selectOption("low");
  await expect(page.getByRole("heading", { name: "Leche Entera" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vasos" })).not.toBeVisible();

  await page.getByLabel(/filtrar inventario/i).selectOption("all");
  await page.getByLabel(/ordenar inventario/i).selectOption("stock_desc");
  await expect(page.locator("h3").nth(1)).toHaveText("Vasos");
  await expect(page.locator("h3").nth(2)).toHaveText("Cafe Grano");
  await expect(page.locator("h3").nth(3)).toHaveText("Leche Entera");
});
