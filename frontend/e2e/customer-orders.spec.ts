import { type Page, expect, test } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";

const customerOrder = {
  id: "customer-order-1",
  tenant_id: "tenant-1",
  folio: "PED-ABC12345",
  status: "confirmed",
  payment_status: "unpaid",
  fulfillment_type: "pickup",
  source_channel: "counter",
  customer_name: "Ana",
  customer_phone: null,
  delivery_address: null,
  delivery_reference: null,
  promised_at: null,
  note: null,
  subtotal_amount: "50.00",
  total_amount: "50.00",
  sale_order_id: null,
  version: 2,
  stock_conflict: false,
  items: [
    {
      id: "customer-order-item-1",
      product_id: "product-1",
      product_name: "Pastel por encargo",
      quantity: 1,
      unit_price_amount: "50.00",
      line_total_amount: "50.00",
      note: "Escribir felicidades",
      modifier_option_ids: [],
      modifiers: [],
    },
  ],
  confirmed_at: "2026-08-12T15:00:00Z",
  ready_at: null,
  fulfilled_at: null,
  cancelled_at: null,
  cancellation_reason: null,
  cancellation_note: null,
  created_at: "2026-08-12T14:55:00Z",
  updated_at: "2026-08-12T15:00:00Z",
};

async function mockShell(page: Page) {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        user: {
          id: "user-1",
          email: "owner@example.com",
          tenant_id: "tenant-1",
          role: "owner",
        },
        tenant_id: "tenant-1",
        tenant_name: "Kova Piloto",
        feature_flags: { margin_reports: false, customer_orders: true },
      },
    }),
  );
  await page.route("**/api/v1/settings/receipt", (route) =>
    route.fulfill({
      json: {
        tenant_id: "tenant-1",
        receipt_business_name: "Kova Piloto",
        footer: null,
        tax_contact_text: null,
        logo_url: null,
      },
    }),
  );
  await page.route("**/api/v1/billing/subscription", (route) =>
    route.fulfill({
      json: {
        subscription: { status: "active" },
        access: { allowed: true, reason: "active", trialing: false },
      },
    }),
  );
}

test("Pedidos is separate from Ventas and opens its operational detail", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockShell(page);
  await page.route("**/api/v1/customer-orders?**", (route) =>
    route.fulfill({
      json: {
        items: [customerOrder],
        total: 1,
        limit: 25,
        offset: 0,
        status_counts: {
          new: 0,
          confirmed: 1,
          in_progress: 0,
          ready: 0,
          fulfilled: 0,
          cancelled: 0,
        },
      },
    }),
  );
  await page.route("**/api/v1/customer-orders/customer-order-1", (route) =>
    route.fulfill({ json: customerOrder }),
  );

  await page.goto("/pedidos");
  await expect(page.getByRole("heading", { name: "Pedidos" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Ventas/i })).toBeVisible();
  await expect(page.getByText("PED-ABC12345")).toBeVisible();
  await page.getByRole("link", { name: /PED-ABC12345/ }).click();
  await expect(page.getByRole("heading", { name: "PED-ABC12345" })).toBeVisible();
  await expect(page.getByText("Escribir felicidades")).toBeVisible();
  await expect(page.getByRole("button", { name: /Cobrar en Caja/i })).toBeVisible();
});

test("Caja checkout for a customer order uses the dedicated endpoint once", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockShell(page);
  await page.route("**/api/v1/shifts/current", (route) =>
    route.fulfill({ json: { id: "shift-customer-order", tenant_id: "tenant-1", status: "open" } }),
  );
  let checkoutCalls = 0;
  await page.route("**/api/v1/customer-orders/customer-order-1", (route) =>
    route.fulfill({ json: customerOrder }),
  );
  await page.route("**/api/v1/customer-orders/customer-order-1/checkout", async (route) => {
    checkoutCalls += 1;
    const paid = { ...customerOrder, payment_status: "paid", sale_order_id: "sale-1", version: 3 };
    await route.fulfill({
      status: 201,
      json: {
        customer_order: paid,
        sale_order: {
          id: "sale-1",
          tenant_id: "tenant-1",
          status: "completed",
          subtotal_amount: "50.00",
          total_amount: "50.00",
          items: [],
          payments: [],
        },
      },
    });
  });
  await page.route("**/api/v1/orders/sale-1/receipt", (route) =>
    route.fulfill({
      json: {
        order_id: "sale-1",
        receipt_number: "VENTA-1",
        tenant_name: "Kova Piloto",
        created_at: "2026-08-12T15:10:00Z",
        status: "completed",
        items: [],
        subtotal_amount: "50.00",
        total_amount: "50.00",
        payments: [],
        total_tendered: "50.00",
        total_change: "0.00",
        refunds: [],
        void: null,
      },
    }),
  );

  await page.goto("/register?customerOrderId=customer-order-1");
  await expect(page.getByRole("heading", { name: /Caja.*PED-ABC12345/i })).toBeVisible();
  await page.getByLabel("Efectivo recibido").fill("50");
  await page.getByRole("button", { name: /Cobrar.*50/i }).click();
  await expect(page.getByRole("heading", { name: "Pedido cobrado" })).toBeVisible();
  expect(checkoutCalls).toBe(1);
});
