import { expect, test } from "@playwright/test";

const OWNER_SESSION = {
  authenticated: true,
  user: { id: "user-1", email: "owner@bakery.com", tenant_id: "tenant-1", role: "owner" },
  tenant_id: "tenant-1",
  tenant_name: "Bakery",
};

const productWithModifiers = {
  id: "product-1",
  tenant_id: "tenant-1",
  category_id: null,
  name: "Café Americano",
  description: null,
  sku: null,
  price_amount: "45.00",
  track_inventory: false,
  low_stock_threshold: null,
  is_active: true,
  modifier_groups: [
    {
      id: "group-1",
      tenant_id: "tenant-1",
      name: "Size",
      is_required: true,
      min_selections: 1,
      max_selections: 1,
      sort_order: 0,
      is_active: true,
      options: [
        { id: "opt-small", group_id: "group-1", name: "Small", price_delta: "0.00", sort_order: 0, is_active: true },
        { id: "opt-large", group_id: "group-1", name: "Large", price_delta: "10.00", sort_order: 1, is_active: true },
      ],
    },
  ],
};

const productNoModifiers = {
  ...productWithModifiers,
  id: "product-2",
  name: "Concha",
  price_amount: "18.50",
  modifier_groups: [],
};

test("register shows modifier selection modal for products with modifier groups", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: OWNER_SESSION }),
  );
  await page.route("**/api/v1/catalog/products", (route) =>
    route.fulfill({ json: [productWithModifiers] }),
  );
  await page.route("**/api/v1/sync/offline-sales", (route) =>
    route.fulfill({ json: { results: [] } }),
  );

  await page.goto("/register");
  await expect(page.getByText("Café Americano")).toBeVisible();

  // Click Add on a product with modifiers — should show modal
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("heading", { name: /Customize/i })).toBeVisible();
  await expect(page.getByText("Size")).toBeVisible();
  await expect(page.getByText("Required")).toBeVisible();
  await expect(page.getByText("Small")).toBeVisible();
  await expect(page.getByText("Large")).toBeVisible();
});

test("add to cart is disabled until required modifier is selected", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: OWNER_SESSION }),
  );
  await page.route("**/api/v1/catalog/products", (route) =>
    route.fulfill({ json: [productWithModifiers] }),
  );
  await page.route("**/api/v1/sync/offline-sales", (route) =>
    route.fulfill({ json: { results: [] } }),
  );

  await page.goto("/register");
  await page.getByRole("button", { name: "Add" }).click();

  // Add to cart button disabled before selection
  await expect(page.getByRole("button", { name: "Add to cart" })).toBeDisabled();

  // Select "Large"
  await page.getByLabel("Large").check();

  // Now enabled
  await expect(page.getByRole("button", { name: "Add to cart" })).toBeEnabled();
});

test("selecting a modifier adds it to cart with effective price", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: OWNER_SESSION }),
  );
  await page.route("**/api/v1/catalog/products", (route) =>
    route.fulfill({ json: [productWithModifiers] }),
  );

  let capturedBody: unknown;
  await page.route("**/api/v1/sync/offline-sales", async (route) => {
    capturedBody = route.request().postDataJSON();
    const body = capturedBody as { sales: Array<{ client_uuid: string; order: { items: Array<{ modifier_option_ids: string[] }> } }> };
    const clientUuid = body.sales[0].client_uuid;
    await route.fulfill({
      json: {
        results: [{ client_uuid: clientUuid, status: "synced", order_id: "order-1", order: { id: "order-1", tenant_id: "tenant-1", status: "completed", subtotal_amount: "55.00", total_amount: "55.00", items: [], payments: [] }, error: null }],
      },
    });
  });

  await page.goto("/register");
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByLabel("Large").check();
  await page.getByRole("button", { name: "Add to cart" }).click();

  // Cart shows modifier and effective price
  const cart = page.getByLabel("Cart");
  await expect(cart.getByText("→ Large")).toBeVisible();
  await expect(cart.getByText("MX$55.00").first()).toBeVisible();

  // Fill tendered and complete sale
  await page.getByLabel("Cash tendered").fill("60.00");
  await page.getByRole("button", { name: "Complete sale" }).click();

  await expect(page.getByRole("status")).toHaveText("Sale completed.");

  // Verify modifier_option_ids were sent
  const body = capturedBody as { sales: Array<{ order: { items: Array<{ modifier_option_ids: string[] }> } }> };
  expect(body.sales[0].order.items[0].modifier_option_ids).toContain("opt-large");
});

test("products without modifier groups are added directly to cart", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: OWNER_SESSION }),
  );
  await page.route("**/api/v1/catalog/products", (route) =>
    route.fulfill({ json: [productNoModifiers] }),
  );
  await page.route("**/api/v1/sync/offline-sales", (route) =>
    route.fulfill({ json: { results: [] } }),
  );

  await page.goto("/register");
  await page.getByRole("button", { name: "Add" }).click();

  // No modifier modal should appear
  await expect(page.getByRole("heading", { name: /Customize/i })).not.toBeVisible();
  // Product goes directly to cart
  const cart = page.getByLabel("Cart");
  await expect(cart.getByText("Concha")).toBeVisible();
  await expect(cart.getByText("MX$18.50").first()).toBeVisible();
});
