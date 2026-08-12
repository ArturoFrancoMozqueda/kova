import { type Page, expect, test } from "@playwright/test";

async function mockAuthAsOwner(page: Page) {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({
      json: {
        authenticated: true,
        user: { id: "user-1", email: "owner@bakery.com", tenant_id: "tenant-1", role: "owner" },
        tenant_id: "tenant-1",
        tenant_name: "Bakery",
      },
    });
  });
}

const orders = [
  {
    id: "order-1",
    status: "completed",
    subtotal_amount: "42.00",
    total_amount: "42.00",
    created_at: "2026-05-20T10:00:00Z",
  },
  {
    id: "order-2",
    status: "voided",
    subtotal_amount: "18.50",
    total_amount: "18.50",
    created_at: "2026-05-20T11:00:00Z",
  },
  {
    id: "order-3",
    status: "completed",
    subtotal_amount: "95.00",
    total_amount: "95.00",
    created_at: "2026-05-20T12:00:00Z",
  },
];

test("orders support status filters and amount sorting at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAuthAsOwner(page);

  await page.route("**/api/v1/orders?**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const status = requestUrl.searchParams.get("status");
    const items = status ? orders.filter((order) => order.status === status) : orders;
    await route.fulfill({
      json: { items, total: items.length, limit: 50, offset: 0 },
    });
  });

  await page.goto("/orders");

  await expect(page.getByRole("heading", { name: /ventas/i })).toBeVisible();
  await page.getByRole("button", { name: /canceladas/i }).click();
  await expect(page.locator("a[href='/orders/order-2']").first()).toContainText("18.50");
  await expect(page.locator("a[href='/orders/order-3']")).not.toBeVisible();

  await page.getByRole("button", { name: /todas/i }).click();
  await page.getByLabel(/ordenar ventas/i).selectOption("amount_asc");
  await expect(page.locator("a[href='/orders/order-2']").first()).toContainText("18.50");
  await expect(page.locator("a[href='/orders/order-1']").first()).toContainText("42.00");
  await expect(page.locator("a[href='/orders/order-3']").first()).toContainText("95.00");
});

test("refund exceeding available qty shows specific error toast", async ({ page }) => {
  await mockAuthAsOwner(page);

  const orderDetail = {
    id: "order-r1",
    tenant_id: "tenant-1",
    status: "completed",
    subtotal_amount: "50.00",
    total_amount: "50.00",
    items: [
      {
        id: "item-r1",
        product_id: "product-r1",
        product_name: "Concha",
        quantity: 1,
        unit_price_amount: "50.00",
        line_total_amount: "50.00",
        modifiers: [],
      },
    ],
    payments: [],
  };
  const receipt = {
    order_id: "order-r1",
    receipt_number: "ABC123",
    tenant_name: "Bakery",
    created_at: "2026-05-20T10:00:00Z",
    status: "completed",
    items: [
      {
        product_name: "Concha",
        quantity: 1,
        unit_price_amount: "50.00",
        line_total_amount: "50.00",
        modifiers: [],
      },
    ],
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

  await page.route("**/api/v1/orders/order-r1/receipt", (route) =>
    route.fulfill({ json: receipt }),
  );
  await page.route("**/api/v1/orders/order-r1", (route) =>
    route.fulfill({ json: orderDetail }),
  );
  await page.route("**/api/v1/orders/order-r1/refunds", (route) =>
    route.fulfill({
      status: 422,
      json: {
        detail: {
          code: "REFUND_QTY_EXCEEDS_AVAILABLE",
          available: 1,
          requested: 2,
          message: "La cantidad excede lo disponible para devolución (máx. 1).",
        },
      },
    }),
  );

  await page.goto("/orders/order-r1");
  const printableReceipt = page.locator(".print-receipt-root");
  await expect(printableReceipt).toBeVisible();

  await page.emulateMedia({ media: "print" });
  await expect(printableReceipt).toBeVisible();
  await expect(printableReceipt).toContainText("Concha");
  await page.emulateMedia({ media: "screen" });

  await page.getByRole("button", { name: /devolver/i }).click();
  // Force qty > available by typing into the qty input.
  await page.getByLabel(/Concha Cantidad/i).fill("2");
  await page.getByRole("button", { name: /registrar devoluci[oó]n/i }).click();

  // Error toasts are now announced assertively (role="alert") — PLAN-UX-01.
  await expect(page.getByRole("alert")).toContainText(/excede lo disponible/i);
});
