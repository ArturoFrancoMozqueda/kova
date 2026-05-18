import { expect, test } from "@playwright/test";

const CASHIER_SESSION = {
  authenticated: true,
  user: { id: "user-1", email: "cashier@bakery.com", tenant_id: "tenant-1", role: "cashier" },
  tenant_id: "tenant-1",
  tenant_name: "Bakery",
};

const CATALOG = [
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
    modifier_groups: [],
  },
];

function makeSyncResponse(orderId: string, total: string) {
  return {
    results: [
      {
        client_uuid: "00000000-0000-4000-8000-000000000001",
        status: "synced",
        order_id: orderId,
        order: {
          id: orderId,
          tenant_id: "tenant-1",
          status: "completed",
          subtotal_amount: total,
          total_amount: total,
          items: [],
          payments: [],
        },
        error: null,
      },
    ],
  };
}

test("cashier completes a cash sale from the register", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: CASHIER_SESSION }),
  );
  await page.route("**/api/v1/catalog/products", (route) =>
    route.fulfill({ json: CATALOG }),
  );
  await page.route("**/api/v1/catalog/categories", (route) =>
    route.fulfill({ json: [] }),
  );

  await page.route("**/api/v1/sync/offline-sales", async (route) => {
    expect(route.request().method()).toBe("POST");
    const body = route.request().postDataJSON() as {
      sales: Array<{ client_uuid: string; order: unknown }>;
    };
    expect(body.sales).toHaveLength(1);
    expect(body.sales[0].order).toMatchObject({
      items: [{ product_id: "product-1", quantity: 1 }],
      payments: [{ method: "cash", amount: "18.50", amount_tendered: "20.00" }],
    });
    await route.fulfill({ json: makeSyncResponse("order-1", "18.50") });
  });

  await page.goto("/register");
  await expect(page.getByRole("heading", { name: /^caja$/i })).toBeVisible();
  await expect(page.getByText("Concha")).toBeVisible();

  await page.getByRole("button", { name: "Agregar Concha" }).click();
  await page.getByLabel(/efectivo recibido/i).fill("20.00");
  await expect(page.getByText("MX$1.50")).toBeVisible();

  await page.getByRole("button", { name: /^cobrar$/i }).click();

  await expect(page.getByRole("status")).toHaveText(/venta completada\.?/i);
  await expect(page.getByRole("link", { name: /abrir orden/i })).toHaveAttribute(
    "href",
    "/orders/order-1",
  );
});

test("cashier completes a split cash and bank transfer sale", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: CASHIER_SESSION }),
  );
  await page.route("**/api/v1/catalog/products", (route) =>
    route.fulfill({ json: CATALOG }),
  );
  await page.route("**/api/v1/catalog/categories", (route) =>
    route.fulfill({ json: [] }),
  );

  await page.route("**/api/v1/sync/offline-sales", async (route) => {
    expect(route.request().method()).toBe("POST");
    const body = route.request().postDataJSON() as {
      sales: Array<{ client_uuid: string; order: unknown }>;
    };
    expect(body.sales[0].order).toMatchObject({
      items: [{ product_id: "product-1", quantity: 1 }],
      payments: [
        { method: "cash", amount: "10.00", amount_tendered: "10.00" },
        { method: "bank_transfer", amount: "8.50", reference: "SPEI-001" },
      ],
    });
    await route.fulfill({ json: makeSyncResponse("order-split", "18.50") });
  });

  await page.goto("/register");
  await expect(page.getByRole("heading", { name: /^caja$/i })).toBeVisible();
  await page.getByRole("button", { name: "Agregar Concha" }).click();
  await page.getByLabel(/pago dividido/i).check();
  await page.getByLabel(/^monto$/i).first().fill("10.00");
  await page.getByLabel(/efectivo recibido/i).fill("10.00");
  await page.getByRole("button", { name: /agregar pago/i }).click();
  await expect(page.getByText(/total pagado/i)).toBeVisible();
  await page.getByLabel(/referencia/i).fill("SPEI-001");

  await page.getByRole("button", { name: /^cobrar$/i }).click();

  await expect(page.getByRole("status")).toHaveText(/venta completada\.?/i);
  await expect(page.getByRole("link", { name: /abrir orden/i })).toHaveAttribute(
    "href",
    "/orders/order-split",
  );
});

test("sale is queued when sync endpoint is unavailable (offline)", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: CASHIER_SESSION }),
  );
  await page.route("**/api/v1/catalog/products", (route) =>
    route.fulfill({ json: CATALOG }),
  );
  await page.route("**/api/v1/catalog/categories", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/sync/offline-sales", (route) => route.abort());

  await page.goto("/register");
  await page.getByRole("button", { name: "Agregar Concha" }).click();
  await page.getByLabel(/efectivo recibido/i).fill("20.00");
  await page.getByRole("button", { name: /^cobrar$/i }).click();

  await expect(page.getByRole("status")).toContainText(/en cola/i);
});
