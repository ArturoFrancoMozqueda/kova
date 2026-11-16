import { type Page, expect, test } from "./fixtures";

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

for (const width of [390, 1440]) {
  test(`sales history reaches every page with keyboard and global ordering at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await mockAuthAsOwner(page);
    const history = Array.from({ length: 60 }, (_, index) => ({
      id: `history-${index}`, status: "completed", subtotal_amount: `${60 - index}.00`,
      total_amount: `${60 - index}.00`, created_at: new Date(2026, 0, index + 1).toISOString(),
    }));
    await page.route("**/api/v1/orders?**", async route => {
      const url = new URL(route.request().url());
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const sorted = [...history].sort((a, b) => url.searchParams.get("sort") === "amount_desc"
        ? Number(b.total_amount) - Number(a.total_amount)
        : Date.parse(b.created_at) - Date.parse(a.created_at));
      await route.fulfill({ json: { items: sorted.slice(offset, offset + 50), total: 60, limit: 50, offset } });
    });
    await page.goto("/orders");
    const pagination = page.getByRole("navigation", { name: "Páginas de ventas" });
    await expect(pagination).toContainText("1–50 de 60 ventas");
    await pagination.getByRole("button", { name: "Siguientes" }).click();
    await expect(pagination).toContainText("51–60 de 60 ventas");
    await expect(pagination).toBeFocused();
    await expect(pagination.getByRole("button", { name: "Siguientes" })).toBeDisabled();
    await page.keyboard.press("Tab");
    await expect(pagination.getByRole("button", { name: "Anteriores" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(pagination).toContainText("1–50 de 60 ventas");
    if (width < 640) await page.getByRole("button", { name: "Fechas y orden" }).click();
    await page.getByLabel("Ordenar ventas").selectOption("amount_desc");
    await expect(page.locator("main a[href^='/orders/']:visible").first()).toHaveAttribute("href", "/orders/history-0");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await pagination.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("history-pagination.png") });
  });

  test(`one mixed-payment item can be refunded with an explicit distribution at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockAuthAsOwner(page);
    const item = { id: "mixed-item", product_id: "mixed-product", product_name: "Producto mixto", quantity: 1,
      unit_price_amount: "50.00", line_total_amount: "50.00", modifiers: [] };
    const payments = [
      { method: "cash", amount_amount: "30.00", amount_tendered_amount: "30.00", change_due_amount: "0.00", reference: null },
      { method: "bank_transfer", amount_amount: "20.00", amount_tendered_amount: null, change_due_amount: "0.00", reference: null },
    ];
    const order = { id: "mixed-order", tenant_id: "tenant-1", status: "completed", subtotal_amount: "50.00", total_amount: "50.00", items: [item], payments };
    const receipt = { order_id: order.id, receipt_number: "QA-MIXTO", tenant_name: "Bakery", created_at: "2026-05-20T10:00:00Z",
      status: "completed", items: [item], subtotal_amount: "50.00", total_amount: "50.00", payments, total_tendered: "30.00", total_change: "0.00", refunds: [], void: null };
    await page.route("**/api/v1/orders/mixed-order", route => route.fulfill({ json: order }));
    await page.route("**/api/v1/orders/mixed-order/receipt", route => route.fulfill({ json: receipt }));
    await page.route("**/api/v1/orders/mixed-order/refunds", async route => {
      const payload = route.request().postDataJSON();
      expect(payload).toMatchObject({ items: [{ order_item_id: "mixed-item", quantity: 1 }], refund_payments: [
        { method: "cash", amount: "30.00" }, { method: "bank_transfer", amount: "20.00" },
      ] });
      await route.fulfill({ status: 201, json: { id: "mixed-refund", order_id: order.id,
        reason: payload.reason, refunded_amount: "50.00", items: [item], created_at: receipt.created_at,
        payments: payload.refund_payments } });
    });
    await page.goto("/orders/mixed-order");
    const refund = page.getByRole("button", { name: "Devolver", exact: true });
    await expect(refund).toBeEnabled();
    await refund.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("spinbutton", { name: /Producto mixto/ }).fill("1");
    await expect(dialog.getByText("$30.00", { exact: true })).toBeVisible();
    await expect(dialog.getByText("$20.00", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("mixed-refund.png") });
    await dialog.getByRole("button", { name: "Registrar devolución", exact: true }).click();
    await expect(dialog).toBeHidden();
  });
}

test("orders support status filters and amount sorting at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAuthAsOwner(page);

  await page.route("**/api/v1/orders?**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const status = requestUrl.searchParams.get("status");
    const sort = requestUrl.searchParams.get("sort");
    const items = [...(status ? orders.filter((order) => order.status === status) : orders)].sort((a, b) =>
      sort === "amount_asc" ? Number(a.total_amount) - Number(b.total_amount)
        : sort === "amount_desc" ? Number(b.total_amount) - Number(a.total_amount)
          : Date.parse(b.created_at) - Date.parse(a.created_at));
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
  // At phone width the custom range and sort fold behind one toggle so the
  // first sale stays above the fold.
  await expect(page.getByLabel(/ordenar ventas/i)).toBeHidden();
  const moreFilters = page.getByRole("button", { name: /fechas y orden/i });
  await moreFilters.click();
  await expect(moreFilters).toHaveAttribute("aria-expanded", "true");
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
