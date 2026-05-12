import { expect, test } from "@playwright/test";

test("cashier completes a cash sale from the register", async ({ page }) => {
  await page.route("**/api/v1/auth/me", async (route) => {
    await route.fulfill({
      json: {
        user: {
          id: "user-1",
          email: "cashier@bakery.com",
          tenant_id: "tenant-1",
          role: "cashier",
        },
        tenant_id: "tenant-1",
        tenant_name: "Bakery",
      },
    });
  });

  await page.route("**/api/v1/catalog/products", async (route) => {
    await route.fulfill({
      json: [
        {
          id: "product-1",
          tenant_id: "tenant-1",
          category_id: null,
          name: "Concha",
          description: null,
          sku: "CON-001",
          price_amount: "18.50",
          track_inventory: false,
          low_stock_threshold: null,
          is_active: true,
        },
      ],
    });
  });

  await page.route("**/api/v1/orders", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({
      items: [{ product_id: "product-1", quantity: 1 }],
      payments: [
        {
          method: "cash",
          amount: "18.50",
          amount_tendered: "20.00",
          reference: null,
        },
      ],
    });
    await route.fulfill({
      status: 201,
      json: {
        id: "order-1",
        tenant_id: "tenant-1",
        status: "completed",
        subtotal_amount: "18.50",
        total_amount: "18.50",
        items: [],
        payments: [],
      },
    });
  });

  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Register" })).toBeVisible();
  await expect(page.getByText("Concha")).toBeVisible();

  await page.getByRole("button", { name: "Add" }).click();
  await page.getByLabel("Cash tendered").fill("20.00");
  await expect(page.getByText("MX$1.50")).toBeVisible();

  await page.getByRole("button", { name: "Complete sale" }).click();

  await expect(page.getByRole("status")).toHaveText("Sale completed.");
  await expect(page.getByRole("link", { name: "Open order" })).toHaveAttribute(
    "href",
    "/orders/order-1",
  );
});

test("cashier completes a split cash and bank transfer sale", async ({ page }) => {
  await page.route("**/api/v1/auth/me", async (route) => {
    await route.fulfill({
      json: {
        user: {
          id: "user-1",
          email: "cashier@bakery.com",
          tenant_id: "tenant-1",
          role: "cashier",
        },
        tenant_id: "tenant-1",
        tenant_name: "Bakery",
      },
    });
  });

  await page.route("**/api/v1/catalog/products", async (route) => {
    await route.fulfill({
      json: [
        {
          id: "product-1",
          tenant_id: "tenant-1",
          category_id: null,
          name: "Concha",
          description: null,
          sku: "CON-001",
          price_amount: "18.50",
          track_inventory: false,
          low_stock_threshold: null,
          is_active: true,
        },
      ],
    });
  });

  await page.route("**/api/v1/orders", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({
      items: [{ product_id: "product-1", quantity: 1 }],
      payments: [
        {
          method: "cash",
          amount: "10.00",
          amount_tendered: "10.00",
          reference: null,
        },
        {
          method: "bank_transfer",
          amount: "8.50",
          amount_tendered: null,
          reference: "SPEI-001",
        },
      ],
    });
    await route.fulfill({
      status: 201,
      json: {
        id: "order-split",
        tenant_id: "tenant-1",
        status: "completed",
        subtotal_amount: "18.50",
        total_amount: "18.50",
        items: [],
        payments: [],
      },
    });
  });

  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Register" })).toBeVisible();
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByLabel("Split payment").check();
  await page.getByLabel("Amount").first().fill("10.00");
  await page.getByLabel("Cash tendered").fill("10.00");
  await page.getByRole("button", { name: "Add payment" }).click();
  await expect(page.getByText("Payment total")).toBeVisible();
  await page.getByLabel("Reference").fill("SPEI-001");

  await page.getByRole("button", { name: "Complete sale" }).click();

  await expect(page.getByRole("status")).toHaveText("Sale completed.");
  await expect(page.getByRole("link", { name: "Open order" })).toHaveAttribute(
    "href",
    "/orders/order-split",
  );
});
