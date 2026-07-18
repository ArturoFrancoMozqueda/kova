import { type Page, expect, test } from "@playwright/test";
import { markFirstUseToursSeen } from "./helpers";

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
  await page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({
      json: {
        subscription: { status: "active" },
        access: { allowed: true, reason: "active", trialing: false, recovery_path: "/settings/billing" },
      },
    });
  });
  await page.route("**/api/v1/telemetry/events", async (route) => {
    await route.fulfill({ status: 204, body: "" });
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
    cost_price: null,
    track_inventory: false,
    low_stock_threshold: null,
    is_active: true,
    modifier_groups: [],
  },
];

const cafeCategories = [
  categories[0],
  { id: "cat-2", tenant_id: "tenant-1", name: "Bebidas", description: null, sort_order: 1, is_active: true },
];

const cafeProducts = [
  products[0],
  {
    id: "prod-2",
    tenant_id: "tenant-1",
    category_id: "cat-2",
    name: "Latte",
    description: "Cafe con leche",
    sku: "LAT-001",
    price_amount: "55.00",
    cost_price: "21.50",
    track_inventory: true,
    low_stock_threshold: 5,
    is_active: true,
    modifier_groups: [],
  },
  {
    id: "prod-3",
    tenant_id: "tenant-1",
    category_id: "cat-2",
    name: "Americano",
    description: "Cafe negro",
    sku: "AME-001",
    price_amount: "42.00",
    cost_price: "12.00",
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
  await markFirstUseToursSeen(page);
  await mockAuthAs(page, "owner");
  await mockCatalogApis(page);

  await page.goto("/catalog");

  await expect(page.getByRole("heading", { name: /cat[áa]logo/i })).toBeVisible();
  await expect(page.getByRole("option", { name: "Pan" })).toBeVisible();
  await expect(page.getByText("Concha")).toBeVisible();
  await expect(page.getByRole("button", { name: /nueva categor[íi]a/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /nuevo producto/i })).toBeVisible();
});

test("catalog page lets owner create a category", async ({ page }) => {
  await markFirstUseToursSeen(page);
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
  await page.getByRole("button", { name: /nueva categor[íi]a/i }).click();
  await page.getByLabel(/nombre de la categor[íi]a/i).fill("Pasteles");
  await page.getByRole("button", { name: /guardar categor[íi]a/i }).click();

  await expect(page.getByText(/categor[íi]a creada/i)).toBeVisible();
});

test("catalog page hides edit controls for cashier", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockAuthAs(page, "cashier");
  await mockCatalogApis(page);

  await page.goto("/catalog");

  await expect(page.getByRole("heading", { name: /cat[áa]logo/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /nueva categor[íi]a/i })).not.toBeVisible();
  await expect(page.getByRole("button", { name: /nuevo producto/i })).not.toBeVisible();
  await expect(page.getByRole("button", { name: /editar costos/i })).not.toBeVisible();
  await expect(page.getByText(/sin costo/i)).not.toBeVisible();
});

test("catalog imports a reviewed CSV only after owner confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await markFirstUseToursSeen(page);
  await mockAuthAs(page, "owner");
  await mockCatalogApis(page);
  const importRequests: Array<{ dryRun: boolean; body: string }> = [];
  const preview = {
    dry_run: true,
    total_rows: 1,
    valid_rows: 1,
    error_rows: 0,
    rows: [{
      row_number: 2,
      status: "valid",
      normalized: {
        name: "Rol de canela",
        sku: "ROL-1",
        price_amount: "42.00",
        cost_price: "18.00",
        category_name: "Pan dulce",
        track_inventory: true,
        initial_stock: 12,
        low_stock_threshold: 3,
      },
      errors: [],
    }],
    created_products: 0,
    created_categories: 0,
    initial_stock_movements: 0,
  };
  await page.route("**/api/v1/catalog/import?dry_run=*", async (route) => {
    const dryRun = new URL(route.request().url()).searchParams.get("dry_run") === "true";
    importRequests.push({ dryRun, body: route.request().postData() ?? "" });
    await route.fulfill({
      status: dryRun ? 200 : 201,
      json: dryRun ? preview : {
        ...preview,
        dry_run: false,
        created_products: 1,
        created_categories: 1,
        initial_stock_movements: 1,
      },
    });
  });

  await page.goto("/catalog");
  await page.getByRole("button", { name: /importar csv/i }).click();
  await page.getByLabel(/elegir archivo csv/i).setInputFiles({
    name: "catalogo.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("nombre,sku,precio\nRol de canela,ROL-1,42.00\n"),
  });

  await expect(page.getByText("Rol de canela")).toBeVisible();
  expect(importRequests).toHaveLength(1);
  expect(importRequests[0].dryRun).toBe(true);

  await page.getByRole("button", { name: /importar productos/i }).click();
  await expect(page.getByText(/1 producto importado correctamente/i)).toBeVisible();
  expect(importRequests).toHaveLength(2);
  expect(importRequests[1].dryRun).toBe(false);
  expect(importRequests[1].body).toContain("Rol de canela");
});

test("catalog supports product search category filtering and sorting at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await markFirstUseToursSeen(page);
  await mockAuthAs(page, "owner");
  await mockCatalogApis(page, cafeCategories, cafeProducts);

  await page.goto("/catalog");

  await page.getByLabel(/buscar productos/i).fill("lat");
  await expect(page.getByText("Latte")).toBeVisible();
  await expect(page.getByText("Concha")).not.toBeVisible();

  await page.getByLabel(/buscar productos/i).clear();
  await page.getByRole("option", { name: "Bebidas" }).click();
  await expect(page.getByText("Latte")).toBeVisible();
  await expect(page.getByText("Americano")).toBeVisible();
  await expect(page.getByText("Concha")).not.toBeVisible();

  await page.getByLabel(/ordenar productos/i).selectOption("price_desc");
  await expect(page.locator("h3").filter({ hasText: /Latte|Americano/ }).first()).toHaveText("Latte");
});

test("catalog product create edit and inventory activation work at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await markFirstUseToursSeen(page);
  await mockAuthAs(page, "owner");

  let productList = [...products];
  await page.route("**/api/v1/catalog/categories", async (route) => {
    await route.fulfill({ json: categories });
  });
  await page.route("**/api/v1/catalog/products", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: productList });
      return;
    }

    const body = JSON.parse(route.request().postData() ?? "{}");
    const created = {
      ...products[0],
      id: "prod-created",
      ...body,
      tenant_id: "tenant-1",
      is_active: true,
      modifier_groups: [],
    };
    productList = [...productList, created];
    await route.fulfill({ status: 201, json: created });
  });
  await page.route("**/api/v1/catalog/products/prod-created", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    const updated = { ...productList.find((item) => item.id === "prod-created")!, ...body };
    productList = productList.map((item) => (item.id === "prod-created" ? updated : item));
    await route.fulfill({ json: updated });
  });
  await page.route("**/api/v1/catalog/products/prod-created/modifier-groups", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/v1/catalog/modifier-groups", async (route) => {
    await route.fulfill({ json: [] });
  });

  await page.goto("/catalog?inventory=activate");

  await expect(page.getByRole("heading", { name: /nuevo producto/i })).toBeVisible();
  await expect(page.getByLabel(/controlar inventario/i)).toBeChecked();
  await page.getByLabel(/nombre del producto/i).fill("QA Kova Audit Latte");
  await page.getByLabel(/precio/i).fill("54");
  await page.getByLabel(/costo unitario/i).fill("22.40");
  await page.getByLabel(/sku/i).fill("QA-LATTE");
  await page.getByRole("button", { name: /guardar producto/i }).click();
  await expect(page.getByText(/producto creado/i)).toBeVisible();
  await expect(page.getByText("QA Kova Audit Latte")).toBeVisible();
  await expect(page.getByText("Costo $22.40")).toBeVisible();

  await page.getByText("QA Kova Audit Latte").click();
  await page.getByLabel(/precio/i).fill("58");
  await page.getByRole("button", { name: /guardar producto/i }).click();
  await expect(page.getByText(/producto actualizado/i)).toBeVisible();
  await expect(page.getByText("$58.00")).toBeVisible();
});

test("catalog lets owner update known and unknown costs from the compact editor", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockAuthAs(page, "owner");

  let productList = [
    { ...products[0], cost_price: null },
    { ...cafeProducts[1], cost_price: "21.50" },
  ];
  const updates: Array<{ id: string; cost_price: string | null }> = [];
  await page.route("**/api/v1/catalog/categories", async (route) => {
    await route.fulfill({ json: cafeCategories });
  });
  await page.route("**/api/v1/catalog/products", async (route) => {
    await route.fulfill({ json: productList });
  });
  await page.route("**/api/v1/catalog/products/*", async (route) => {
    const id = route.request().url().split("/").at(-1)!;
    const body = JSON.parse(route.request().postData() ?? "{}");
    updates.push({ id, cost_price: body.cost_price ?? null });
    productList = productList.map((product) => (product.id === id ? { ...product, ...body } : product));
    await route.fulfill({ json: productList.find((product) => product.id === id) });
  });
  await page.route("**/api/v1/catalog/modifier-groups", async (route) => {
    await route.fulfill({ json: [] });
  });

  await page.goto("/catalog");
  await expect(page.getByText("Sin costo")).toBeVisible();
  await page.getByRole("button", { name: /editar costos/i }).click();
  await page.getByLabel(/costo unitario · concha/i).fill("8.25");
  await page.getByLabel(/costo unitario · latte/i).fill("");
  await page.getByRole("button", { name: /guardar costos/i }).click();

  await expect(page.getByText(/2 costos actualizados/i)).toBeVisible();
  expect(updates).toEqual([
    { id: "prod-1", cost_price: "8.25" },
    { id: "prod-2", cost_price: null },
  ]);
});

test("catalog product create shows billing recovery when access is blocked", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockAuthAs(page, "owner");
  await page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({
      json: {
        subscription: null,
        access: {
          allowed: false,
          reason: "trial_expired",
          trialing: false,
          trial_ends_at: "2026-05-01T00:00:00Z",
          blocked_at: "2026-05-21T20:15:03Z",
          recovery_path: "/settings/billing",
        },
      },
    });
  });
  await page.route("**/api/v1/catalog/categories", async (route) => {
    await route.fulfill({ json: categories });
  });
  await page.route("**/api/v1/catalog/products", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: products });
      return;
    }
    await route.fulfill({
      status: 402,
      json: {
        detail: {
          message: "Billing access is required to continue using this POS feature",
          reason: "trial_expired",
          recovery_path: "/settings/billing",
        },
      },
    });
  });
  await page.route("**/api/v1/catalog/modifier-groups", async (route) => {
    await route.fulfill({ json: [] });
  });

  await page.goto("/catalog");
  await page.getByRole("button", { name: /nuevo producto/i }).click();
  await page.getByLabel(/nombre del producto/i).fill("Galleta New York");
  await page.getByLabel(/precio/i).fill("45");
  await page.getByRole("button", { name: /guardar producto/i }).click();

  await expect(page.getByText(/activa el plan para guardar cambios en el cat[áa]logo/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /ver facturaci[óo]n/i })).toBeVisible();
  await expect(page.getByText(/algo sali[óo] mal/i)).not.toBeVisible();
});

test("owner explicitly loads the abarrotes preset without invented costs", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await markFirstUseToursSeen(page);
  await mockAuthAs(page, "owner");
  let categoryList: typeof categories = [];
  let productList: typeof products = [];
  let appliedPreset: string | null = null;

  await page.route("**/api/v1/catalog/categories", async (route) => {
    await route.fulfill({ json: categoryList });
  });
  await page.route("**/api/v1/catalog/products", async (route) => {
    await route.fulfill({ json: productList });
  });
  await page.route("**/api/v1/catalog/modifier-groups", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/v1/onboarding/apply-preset", async (route) => {
    appliedPreset = JSON.parse(route.request().postData() ?? "{}").preset;
    categoryList = categories;
    productList = [{
      ...products[0],
      name: "Arroz 1 kg",
      sku: "AB-DES-001",
      price_amount: "38.00",
      cost_price: null,
      track_inventory: true,
      low_stock_threshold: 6,
    }];
    await route.fulfill({
      json: {
        preset: "abarrotes",
        categories_created: 4,
        products_created: 16,
        skipped: false,
      },
    });
  });

  await page.goto("/catalog");
  await expect(page.getByText(/costos quedan vacíos/i)).toBeVisible();
  await expect(page.getByText(/sin costos inventados/i)).toBeVisible();
  if (process.env.KOVA_QA_SCREENSHOT) {
    await page.waitForTimeout(500);
    await page.screenshot({ path: process.env.KOVA_QA_SCREENSHOT });
  }
  await page.getByRole("button", { name: "Abarrotes" }).click();

  expect(appliedPreset).toBe("abarrotes");
  await expect(page.getByText("Arroz 1 kg")).toBeVisible();
  await expect(page.getByText(/16 productos creados.*captura tus costos reales/i)).toBeVisible();
  await expect(page.getByText("Sin costo")).toBeVisible();
});
