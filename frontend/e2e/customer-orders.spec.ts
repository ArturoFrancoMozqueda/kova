import { type Page, expect, test } from "./fixtures";
import { createRequire } from "node:module";
import { markFirstUseToursSeen } from "./helpers";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

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

async function mockShell(page: Page, role = "owner") {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        user: {
          id: "user-1",
          email: "owner@example.com",
          tenant_id: "tenant-1",
          role,
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

test("Pedido fields have accessible names and pass axe on desktop and mobile", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockShell(page);
  await page.route("**/api/v1/catalog/products", route => route.fulfill({ json: [{
    id: "product-1", tenant_id: "tenant-1", category_id: null, name: "Pastel por encargo",
    description: null, sku: null, price_amount: "50.00", track_inventory: false,
    low_stock_threshold: null, image_url: null, image_position_x: 50,
    image_position_y: 50, image_zoom: 1, is_active: true, modifier_groups: [],
  }] }));
  await page.route("**/api/v1/inventory/stock", route => route.fulfill({ json: [] }));
  await page.goto("/pedidos/nuevo");
  await page.getByRole("button", { name: "Agregar Pastel por encargo" }).click();
  await page.addScriptTag({ path: axePath });

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const mode of ["pickup", "delivery"]) {
      await page.getByRole("combobox", { name: "Modalidad" }).selectOption(mode);
      for (const label of ["Buscar producto o SKU", "Canal", "Nombre", "Teléfono", "Prometido para", "Nota general", "Nota de Pastel por encargo (opcional)", ...(mode === "delivery" ? ["Dirección", "Referencia"] : [])]) {
        await expect(page.getByLabel(label, { exact: true })).toBeVisible();
      }
      const violations = await page.evaluate(async () => {
        const axe = (window as typeof window & {
          axe: { run: (context: Element, options: object) => Promise<{ violations: Array<{ id: string; impact: string | null; nodes: Array<{ target: string[] }> }> }> };
        }).axe;
        const result = await axe.run(document.querySelector("main")!, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
          resultTypes: ["violations"],
        });
        return result.violations.filter(item => item.impact === "critical" || item.impact === "serious");
      });
      expect(violations, `Pedido ${mode} at ${width}px: ${JSON.stringify(violations)}`).toEqual([]);
    }
  }
});

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

test("pedido cancellation controls have accessible names", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockShell(page);
  await page.route("**/api/v1/customer-orders/customer-order-1", route => route.fulfill({ json: customerOrder }));
  await page.goto("/pedidos/customer-order-1");
  await page.getByRole("button", { name: "Cancelar pedido", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox", { name: "Motivo", exact: true })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Nota opcional", exact: true })).toBeVisible();
});

test("pedido cancellation preserves context after a failed request", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockShell(page);
  let serverVersion = 2;
  await page.route("**/api/v1/customer-orders/customer-order-1", route =>
    route.fulfill({ json: { ...customerOrder, version: serverVersion } }));
  let attempts = 0;
  await page.route("**/api/v1/customer-orders/customer-order-1/cancel", route => {
    attempts += 1;
    expect(route.request().postDataJSON()).toMatchObject({
      version: attempts === 1 ? 2 : 3, reason: "customer_request", note: "No entregar",
    });
    serverVersion = 3;
    return route.fulfill(attempts === 1 ? {
      status: 409, json: { detail: { message: "El pedido cambió. Vuelve a intentarlo." } },
    } : { json: { ...customerOrder, status: "cancelled", version: 4 } });
  });
  await page.goto("/pedidos/customer-order-1");
  await page.getByRole("button", { name: "Cancelar pedido", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("input").fill("No entregar");
  await dialog.getByRole("button", { name: "Cancelar pedido", exact: true }).click();
  await expect(page.getByRole("heading", { name: customerOrder.folio, exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("El pedido cambió. Vuelve a intentarlo.");
  await expect(dialog.getByRole("textbox", { name: "Nota opcional", exact: true })).toHaveValue("No entregar");
  await dialog.getByRole("button", { name: "Actualizar pedido", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Nota opcional", exact: true })).toHaveValue("No entregar");
  await dialog.getByRole("button", { name: "Cancelar pedido", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: customerOrder.folio, exact: true }).filter({ visible: true })).toBeVisible();
  expect(attempts).toBe(2);
});

test("cached pedido stays read only when the connection is online but its API fails", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockShell(page);
  let failed = false;
  await page.route("**/api/v1/customer-orders/customer-order-1", route =>
    route.fulfill(failed ? { status: 503 } : { json: customerOrder }));
  await page.goto("/pedidos/customer-order-1");
  await expect(page.getByRole("button", { name: "Cobrar en Caja", exact: true })).toBeVisible();
  failed = true;
  await page.reload();
  await expect(page.getByText(/Solo lectura · actualizado/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Cobrar en Caja", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Cancelar pedido", exact: true })).toBeHidden();
  await expect(page.getByRole("link", { name: "Editar", exact: true })).toBeHidden();
});

test("cancellation dialog cannot write after refreshing falls back to cached detail", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockShell(page);
  let failed = false;
  await page.route("**/api/v1/customer-orders/customer-order-1", route =>
    route.fulfill(failed ? { status: 503 } : { json: customerOrder }));
  let cancellationRequests = 0;
  await page.route("**/api/v1/customer-orders/customer-order-1/cancel", route => {
    cancellationRequests += 1;
    return route.fulfill({ status: 409, json: { detail: { message: "Actualiza el pedido." } } });
  });
  await page.goto("/pedidos/customer-order-1");
  await page.getByRole("button", { name: "Cancelar pedido", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Cancelar pedido", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Actualiza el pedido.");
  failed = true;
  await dialog.getByRole("button", { name: "Actualizar pedido", exact: true }).click();
  await expect(page.getByText(/Solo lectura · actualizado/)).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Cancelar pedido", exact: true })).toBeHidden();
  expect(cancellationRequests).toBe(1);
});

for (const refreshedState of ["paid", "cancelled", "refunded", "voided"] as const) {
  test(`refresh in cancellation respects the latest ${refreshedState} state`, async ({ page }) => {
    await markFirstUseToursSeen(page);
    await mockShell(page);
    let current: typeof customerOrder = customerOrder;
    await page.route("**/api/v1/customer-orders/customer-order-1", route => route.fulfill({ json: current }));
    await page.route("**/api/v1/customer-orders/customer-order-1/cancel", route => route.fulfill({
      status: 409, json: { detail: { message: "Actualiza el pedido." } },
    }));
    await page.goto("/pedidos/customer-order-1");
    await page.getByRole("button", { name: "Cancelar pedido", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Cancelar pedido", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Actualiza el pedido.");
    current = { ...customerOrder, version: 3,
      ...(refreshedState === "cancelled" ? { status: "cancelled" } : { payment_status: refreshedState }) };
    await dialog.getByRole("button", { name: "Actualizar pedido", exact: true }).click();
    const cancel = dialog.getByRole("button", { name: "Cancelar pedido", exact: true });
    if (refreshedState === "refunded" || refreshedState === "voided") {
      await expect(cancel).toBeEnabled();
    } else {
      await expect(cancel).toBeDisabled();
    }
  });
}

for (const role of ["manager", "cashier"]) {
  for (const payment_status of ["refunded", "voided"]) {
    test(`${role} cancellation of ${payment_status} pedido respects financial reversal permissions`, async ({ page }) => {
      await markFirstUseToursSeen(page);
      await mockShell(page, role);
      await page.route("**/api/v1/customer-orders/customer-order-1", route =>
        route.fulfill({ json: { ...customerOrder, payment_status } }));
      await page.goto("/pedidos/customer-order-1");
      const cancel = page.getByRole("button", { name: "Cancelar pedido", exact: true });
      if (role === "manager") await expect(cancel).toBeEnabled();
      else await expect(cancel).toBeDisabled();
    });
  }
}

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
