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

const order = {
  id: "demo",
  tenant_id: "tenant-1",
  status: "completed",
  subtotal_amount: "50.00",
  total_amount: "50.00",
  items: [
    {
      id: "item-1",
      product_id: "product-1",
      product_name: "Concha",
      quantity: 1,
      unit_price_amount: "25.00",
      line_total_amount: "25.00",
    },
    {
      id: "item-2",
      product_id: "product-2",
      product_name: "Roll",
      quantity: 1,
      unit_price_amount: "25.00",
      line_total_amount: "25.00",
    },
  ],
  payments: [],
};

const receipt = {
  order_id: "demo",
  receipt_number: "DEMO123",
  tenant_name: "Bakery",
  created_at: "2026-05-08T00:00:00Z",
  status: "completed",
  items: [],
  subtotal_amount: "50.00",
  total_amount: "50.00",
  payments: [
    {
      method: "cash",
      amount_amount: "50.00",
      amount_tendered_amount: "50.00",
      change_due_amount: "0.00",
      reference: null,
    },
  ],
  total_tendered: "50.00",
  total_change: "0.00",
  refunds: [],
  void: null,
};

test("refund and void modals post to the order APIs", async ({ page }) => {
  await mockAuthAs(page, "owner");
  let refundCreated = false;

  await page.route("**/api/v1/orders/demo", async (route) => {
    await route.fulfill({ json: order });
  });
  await page.route("**/api/v1/orders/demo/receipt", async (route) => {
    await route.fulfill({
      json: refundCreated
        ? {
            ...receipt,
            refunds: [
              {
                id: "refund-1",
                reason: "customer_return",
                refunded_amount: "25.00",
                created_at: "2026-05-08T01:00:00Z",
                items: [
                  {
                    order_item_id: "item-1",
                    quantity: 1,
                    unit_price_amount: "25.00",
                    line_total_amount: "25.00",
                  },
                ],
              },
            ],
          }
        : receipt,
    });
  });
  await page.route("**/api/v1/orders/demo/refunds", async (route) => {
    refundCreated = true;
    await route.fulfill({
      status: 201,
      json: {
        id: "refund-1",
        order_id: "demo",
        reason: "customer_return",
        refunded_amount: "25.00",
        items: [],
        created_at: "2026-05-08T01:00:00Z",
      },
    });
  });
  await page.route("**/api/v1/orders/demo/void", async (route) => {
    await route.fulfill({
      status: 201,
      json: {
        id: "void-1",
        order_id: "demo",
        reason: "operator_error",
        created_at: "2026-05-08T01:00:00Z",
      },
    });
  });

  await page.goto("/orders/demo");
  await expect(page.getByRole("heading", { name: /detalle de la orden/i })).toBeVisible();

  await page.getByRole("button", { name: /^devolver$/i }).click();
  await page.getByLabel("Concha Cantidad").fill("1");
  await page.getByRole("button", { name: /registrar devoluci[óo]n/i }).click();
  await expect(page.getByText(/devoluci[óo]n registrada/i)).toBeVisible();
  await expect(page.getByText(/devoluci[oó]n de cliente/i)).toBeVisible();

  refundCreated = false;
  await page.goto("/orders/demo");
  await page.getByRole("button", { name: /^cancelar$/i }).click();
  await page.getByLabel(/revierte el inventario de la orden/i).check();
  await page.getByRole("button", { name: /cancelar orden/i }).click();
  await expect(page.getByText(/orden cancelada/i)).toBeVisible();
});
