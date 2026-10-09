import { expect, test, type Page } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";

const CASHIER_SESSION = {
  authenticated: true,
  user: { id: "user-1", email: "cashier@bakery.com", tenant_id: "tenant-1", role: "cashier" },
  tenant_id: "tenant-1",
  tenant_name: "Bakery",
};

const OPEN_SHIFT = {
  id: "shift-1",
  tenant_id: "tenant-1",
  status: "open",
  opening_cash_amount: "100.00",
  expected_cash_amount: "100.00",
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

function makeSyncResponse(clientUuid: string, orderId: string, total: string) {
  return {
    results: [
      {
        client_uuid: clientUuid,
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

async function expectRegisterReady(page: Page) {
  // The redesigned register starts with the visible catalog card instead of a
  // standalone "Caja" page heading. Waiting on this heading still proves the
  // lazy route and its catalog data finished loading before the sale begins.
  await expect(page.getByRole("heading", { name: /^catálogo$/i })).toBeVisible();
}

for (const completionKey of ["Enter", "Space", "Control+Enter"]) {
  test(`editing sale fields never charges implicitly; ${completionKey} explicitly completes it`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await markFirstUseToursSeen(page);
    await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: CASHIER_SESSION }));
    await page.route("**/api/v1/catalog/products", (route) => route.fulfill({ json: CATALOG }));
    await page.route("**/api/v1/catalog/categories", (route) => route.fulfill({ json: [] }));
    await page.route("**/api/v1/shifts/current", (route) => route.fulfill({ json: OPEN_SHIFT }));
    let submittedSales = 0;
    await page.route("**/api/v1/sync/offline-sales", async (route) => {
      submittedSales += 1;
      const body = route.request().postDataJSON() as { sales: Array<{ client_uuid: string }> };
      await route.fulfill({ json: makeSyncResponse(body.sales[0].client_uuid, "10000000-0000-4000-8000-000000000099", "18.50") });
    });
    await page.goto("/register");
    await expectRegisterReady(page);
    await page.getByRole("button", { name: "Agregar Concha" }).click();
    await page.getByLabel(/efectivo recibido/i).fill("20.00");
    await page.getByText("Cliente, descuento e impuesto", { exact: true }).click();
    const collect = page.getByRole("button", { name: /^cobrar$/i });
    await expect(collect).toBeEnabled();
    for (const name of ["Buscar cliente", "Descuento de la venta (MXN)", "Impuesto adicional al precio (%)", "Efectivo recibido"]) {
      await page.getByLabel(name, { exact: true }).press("Enter");
      await expect(collect).toBeEnabled();
      await expect(page.getByRole("button", { name: "Agregar Concha" })).toBeEnabled();
      expect(submittedSales).toBe(0);
    }
    if (completionKey === "Control+Enter") {
      await collect.focus();
      await page.keyboard.press(completionKey);
    } else {
      await collect.press(completionKey);
    }
    await expect(page.getByRole("status")).toHaveText(/venta completada\.?/i);
    expect(submittedSales).toBe(1);
  });
}

for (const width of [390, 1100, 1440]) {
  test(`sale confirmation and receipt remain accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await markFirstUseToursSeen(page);
    await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: CASHIER_SESSION }));
    await page.route("**/api/v1/catalog/products", (route) => route.fulfill({ json: CATALOG }));
    await page.route("**/api/v1/catalog/categories", (route) => route.fulfill({ json: [] }));
    await page.route("**/api/v1/shifts/current", (route) => route.fulfill({ json: OPEN_SHIFT }));
    // Keep the local receipt available to verify the same confirmation layout
    // when the sale is safely saved but cannot sync yet.
    await page.route("**/api/v1/sync/offline-sales", (route) => route.abort());
    await page.goto("/register");
    await expectRegisterReady(page);
    await page.getByRole("button", { name: "Agregar Concha" }).click();
    await page.getByLabel(/efectivo recibido/i).fill("20.00");
    await page.getByRole("button", { name: /^cobrar$/i }).click();

    await expect(page.getByRole("button", { name: /nueva venta/i }).filter({ visible: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /imprimir recibo/i }).filter({ visible: true })).toHaveCount(1);
    if (width < 1280) {
      const confirmation = page.getByRole("dialog", { name: /venta guardada en este dispositivo/i });
      await expect(confirmation).toBeVisible();
      await expect(confirmation.getByRole("button", { name: /nueva venta/i })).toBeFocused();
      await expect(confirmation).toContainText("Concha");
      await page.keyboard.press("Escape");
      await expect(confirmation).toBeHidden();
    } else {
      await page.getByRole("button", { name: /nueva venta/i }).filter({ visible: true }).click();
    }
    await expect(page.getByRole("button", { name: "Agregar Concha" })).toBeEnabled();
  });
}

test("cashier completes a cash sale from the register", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: CASHIER_SESSION }),
  );
  await page.route("**/api/v1/catalog/products", (route) =>
    route.fulfill({ json: CATALOG }),
  );
  await page.route("**/api/v1/catalog/categories", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/shifts/current", (route) =>
    route.fulfill({ json: OPEN_SHIFT }),
  );

  await page.route("**/api/v1/sync/offline-sales", async (route) => {
    expect(route.request().method()).toBe("POST");
    const body = route.request().postDataJSON() as {
      sales: Array<{ client_uuid: string; order: unknown; shift_id?: string }>;
    };
    expect(body.sales).toHaveLength(1);
    // The ring-time shift id must travel with the sale so its cash counts
    // toward the drawer's expected cash.
    expect(body.sales[0].shift_id).toBe("shift-1");
    expect(body.sales[0].order).toMatchObject({
      items: [{ product_id: "product-1", quantity: 1 }],
      payments: [{ method: "cash", amount: "18.50", amount_tendered: "20.00" }],
    });
    await route.fulfill({
      json: makeSyncResponse(body.sales[0].client_uuid, "10000000-0000-4000-8000-000000000001", "18.50"),
    });
  });

  await page.goto("/register");
  await expectRegisterReady(page);
  await expect(page.getByText("Concha")).toBeVisible();
  await expect(page.getByText(/primero agrega productos al carrito/i)).toBeVisible();
  await expect(page.getByText(/opciones avanzadas/i)).toBeHidden();

  await page.getByRole("button", { name: "Agregar Concha" }).click();
  await expect(page.getByText(/opciones avanzadas/i)).toBeVisible();
  await page.getByLabel(/efectivo recibido/i).fill("20.00");
  await expect(page.getByText(/\$1\.50/).first()).toBeVisible();

  await page.getByRole("button", { name: /^cobrar$/i }).click();

  await expect(page.getByRole("status")).toHaveText(/venta completada\.?/i);
  await expect(page.getByRole("link", { name: /abrir orden/i })).toHaveAttribute(
    "href",
    "/orders/10000000-0000-4000-8000-000000000001",
  );
});

test("cashier completes a split cash and bank transfer sale", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: CASHIER_SESSION }),
  );
  await page.route("**/api/v1/catalog/products", (route) =>
    route.fulfill({ json: CATALOG }),
  );
  await page.route("**/api/v1/catalog/categories", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/shifts/current", (route) =>
    route.fulfill({ json: OPEN_SHIFT }),
  );

  await page.route("**/api/v1/sync/offline-sales", async (route) => {
    expect(route.request().method()).toBe("POST");
    const body = route.request().postDataJSON() as {
      sales: Array<{ client_uuid: string; order: unknown; shift_id?: string }>;
    };
    expect(body.sales[0].shift_id).toBe("shift-1");
    expect(body.sales[0].order).toMatchObject({
      items: [{ product_id: "product-1", quantity: 1 }],
      payments: [
        { method: "cash", amount: "10.00", amount_tendered: "10.00" },
        { method: "bank_transfer", amount: "8.50", reference: "SPEI-001" },
      ],
    });
    await route.fulfill({
      json: makeSyncResponse(body.sales[0].client_uuid, "10000000-0000-4000-8000-000000000002", "18.50"),
    });
  });

  await page.goto("/register");
  await expectRegisterReady(page);
  await page.getByRole("button", { name: "Agregar Concha" }).click();
  await page.getByText(/opciones avanzadas/i).click();
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
    "/orders/10000000-0000-4000-8000-000000000002",
  );
});

test("sale is queued when sync endpoint is unavailable (offline)", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: CASHIER_SESSION }),
  );
  await page.route("**/api/v1/catalog/products", (route) =>
    route.fulfill({ json: CATALOG }),
  );
  await page.route("**/api/v1/catalog/categories", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/shifts/current", (route) =>
    route.fulfill({ json: { id: "shift-offline", tenant_id: "tenant-1", status: "open" } }),
  );
  await page.route("**/api/v1/sync/offline-sales", (route) => route.abort());

  await page.goto("/register");
  await expectRegisterReady(page);
  await page.getByRole("button", { name: "Agregar Concha" }).click();
  await page.getByLabel(/efectivo recibido/i).fill("20.00");
  await page.getByRole("button", { name: /^cobrar$/i }).click();

  await expect(page.getByRole("status")).toContainText(/en cola/i);

  const printableReceipt = page.locator(".print-receipt-root");
  await expect(printableReceipt).toHaveCount(1);
  await expect(printableReceipt).toBeHidden();

  await page.emulateMedia({ media: "print" });
  await expect(printableReceipt).toBeVisible();
  await expect(printableReceipt).toContainText("Concha");
});

test("cash is blocked without an open shift but a transfer sale completes", async ({
  page,
}) => {
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: CASHIER_SESSION }),
  );
  await page.route("**/api/v1/catalog/products", (route) =>
    route.fulfill({ json: CATALOG }),
  );
  await page.route("**/api/v1/catalog/categories", (route) =>
    route.fulfill({ json: [] }),
  );
  // No open shift on this device.
  await page.route("**/api/v1/shifts/current", (route) => route.fulfill({ json: null }));

  await page.route("**/api/v1/sync/offline-sales", async (route) => {
    const body = route.request().postDataJSON() as {
      sales: Array<{
        client_uuid: string;
        order: { payments: Array<{ method: string }> };
        shift_id?: string;
      }>;
    };
    // A blocked-cash sale must never reach the wire; only the transfer does.
    expect(body.sales[0].order.payments[0].method).toBe("bank_transfer");
    expect(body.sales[0].shift_id).toBeUndefined();
    await route.fulfill({
      json: makeSyncResponse(body.sales[0].client_uuid, "10000000-0000-4000-8000-000000000003", "18.50"),
    });
  });

  await page.goto("/register");
  await expectRegisterReady(page);
  await expect(
    page.getByText(/los cobros en efectivo están bloqueados/i),
  ).toBeVisible();

  await page.getByRole("button", { name: "Agregar Concha" }).click();

  // Cash method is disabled; selecting it surfaces the reason and does not
  // switch the method.
  const cashRadio = page.getByRole("radio", { name: /^efectivo$/i });
  await expect(cashRadio).toHaveAttribute("aria-disabled", "true");

  // Transfer is still allowed and completes the sale.
  await page.getByRole("radio", { name: /transferencia/i }).click();
  await page.getByRole("button", { name: /^cobrar$/i }).click();
  await expect(page.getByRole("status")).toHaveText(/venta completada\.?/i);
});

test("out-of-stock product cannot be added to the cart", async ({ page }) => {
  await markFirstUseToursSeen(page);
  const tracked = {
    ...CATALOG[0],
    id: "product-out",
    name: "OutOfStockItem",
    track_inventory: true,
    low_stock_threshold: 5,
  };
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: CASHIER_SESSION }),
  );
  await page.route("**/api/v1/catalog/products", (route) =>
    route.fulfill({ json: [tracked] }),
  );
  await page.route("**/api/v1/catalog/categories", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/inventory/stock", (route) =>
    route.fulfill({
      json: [
        {
          product_id: "product-out",
          product_name: "OutOfStockItem",
          sku: "OUT-001",
          track_inventory: true,
          stock_on_hand: 0,
          reserved_quantity: 0,
          available_quantity: 0,
          low_stock_threshold: 5,
          is_low_stock: true,
        },
      ],
    }),
  );

  await page.goto("/register");
  await expectRegisterReady(page);
  const card = page.getByRole("button", {
    name: /OutOfStockItem.*sin stock/i,
  });
  await expect(card).toHaveAttribute("aria-disabled", "true");
  await card.click({ force: true });
  await expect(page.getByRole("status")).toContainText(/no tiene stock/i);
});
