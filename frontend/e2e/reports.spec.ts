import { type Page, expect, test } from "@playwright/test";
import { markFirstUseToursSeen } from "./helpers";

async function mockAuthAs(page: Page, role: string, marginReports = false) {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({
      json: {
        authenticated: true,
        user: { id: "user-1", email: "test@bakery.com", tenant_id: "tenant-1", role },
        tenant_id: "tenant-1",
        tenant_name: "Bakery",
        feature_flags: { margin_reports: marginReports },
      },
    });
  });
  await page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({
      json: {
        status: "active",
        access_status: "active",
        trial_ends_at: null,
        grace_ends_at: null,
        current_period_end: null,
        cancel_at_period_end: false,
      },
    });
  });
  await page.route("**/api/v1/settings/business-profile", async (route) => {
    await route.fulfill({
      json: {
        tenant_id: "tenant-1",
        public_name: "Bakery",
        support_email: "test@bakery.com",
        support_phone: null,
        timezone: "America/Mexico_City",
        locale: "es-MX",
        currency: "MXN",
      },
    });
  });
}

function storyPayload(overrides = {}) {
  return {
    summary: {
      start_date: "2026-05-13",
      end_date: "2026-05-19",
      timezone: "America/Mexico_City",
      gross_sales: "251.00",
      refund_total: "20.00",
      net_sales: "231.00",
      completed_orders: 7,
      average_ticket: "33.00",
      refund_count: 0,
      cancellation_count: 0,
    },
    executive_summary: "",
    sales_by_day: [
      { date: "2026-05-13", net_sales: "40.00", order_count: 1, average_ticket: "40.00", sales_share_pct: 17 },
      { date: "2026-05-17", net_sales: "88.00", order_count: 2, average_ticket: "44.00", sales_share_pct: 38 },
      { date: "2026-05-19", net_sales: "103.00", order_count: 4, average_ticket: "25.75", sales_share_pct: 45 },
    ],
    sales_by_daypart: [
      { key: "madrugada", label: "Madrugada", start_hour: 0, end_hour: 5, net_sales: "0.00", order_count: 0, average_ticket: "0.00", sales_share_pct: 0 },
      { key: "manana", label: "Mañana", start_hour: 6, end_hour: 11, net_sales: "31.00", order_count: 1, average_ticket: "31.00", sales_share_pct: 13 },
      { key: "tarde", label: "Tarde", start_hour: 12, end_hour: 17, net_sales: "40.00", order_count: 1, average_ticket: "40.00", sales_share_pct: 17 },
      { key: "noche", label: "Noche", start_hour: 18, end_hour: 23, net_sales: "160.00", order_count: 5, average_ticket: "32.00", sales_share_pct: 69 },
    ],
    peak_hour: {
      hour: 20,
      label: "20:00-21:00",
      daypart_key: "noche",
      net_sales: "90.00",
      order_count: 3,
      sales_share_pct: 39,
    },
    top_product_by_sales: {
      product_id: "product-1",
      product_name: "Dona",
      quantity_sold: 12,
      gross_sales: "120.00",
      sales_share_pct: 52,
    },
    top_product_by_units: {
      product_id: "product-1",
      product_name: "Dona",
      quantity_sold: 12,
      gross_sales: "120.00",
      sales_share_pct: 52,
    },
    product_drivers: [
      {
        product_id: "product-1",
        product_name: "Dona",
        quantity_sold: 12,
        gross_sales: "120.00",
        sales_share_pct: 52,
      },
      {
        product_id: "product-2",
        product_name: "Queso Concha",
        quantity_sold: 4,
        gross_sales: "60.00",
        sales_share_pct: 26,
      },
    ],
    margin: {
      summary: {
        net_sales: "231.00",
        cogs: "92.40",
        gross_profit: "138.60",
        gross_margin_pct: "60.00",
        sold_products: 2,
        sold_products_without_cost: 0,
        complete: true,
      },
      by_day: [],
      by_product: [
        {
          product_id: "product-1",
          product_name: "Dona",
          quantity_sold: 12,
          net_sales: "120.00",
          cogs: "48.00",
          gross_profit: "72.00",
          gross_margin_pct: "60.00",
          missing_cost: false,
        },
      ],
    },
    inventory_valuation: {
      value: "840.00",
      known_value: "840.00",
      tracked_products: 2,
      products_without_cost: 0,
      units_without_cost: 0,
      complete: true,
    },
    waste: {
      units: 3,
      movement_count: 2,
      value: "36.00",
      known_value: "36.00",
      products_without_cost: 0,
      complete: true,
      by_reason: [
        { reason_code: "caducidad", units: 2, value: "24.00", products_without_cost: 0 },
        { reason_code: "daño", units: 1, value: "12.00", products_without_cost: 0 },
      ],
    },
    operating_expenses: {
      total: "45.00",
      expense_count: 2,
      approximate_operating_profit: "93.60",
      margin_complete: true,
      by_category: [
        { category: "servicios", amount: "30.00", expense_count: 1 },
        { category: "transporte", amount: "15.00", expense_count: 1 },
      ],
    },
    dominant_payment: {
      method: "cash",
      amount: "192.00",
      payment_count: 6,
      sales_share_pct: 83,
    },
    payment_mix: [
      {
        method: "cash",
        amount: "192.00",
        payment_count: 6,
        sales_share_pct: 83,
      },
      {
        method: "manual_card",
        amount: "39.00",
        payment_count: 1,
        sales_share_pct: 17,
      },
    ],
    operational_signals: [
      {
        type: "good_signal",
        title: "Sin devoluciones ni cancelaciones",
        detail: "Buena señal operativa en este periodo.",
      },
    ],
    recommended_actions: [
      {
        type: "opportunity",
        title: "Refuerza operación en noche",
        detail: "Este bloque concentra 69% de tus ventas del periodo.",
      },
      {
        type: "opportunity",
        title: "Prepara más stock de Dona",
        detail: "Fue el producto principal del periodo con 52% de las ventas.",
      },
      {
        type: "operational_improvement",
        title: "Reduce dependencia de efectivo",
        detail: "Cash representa 83% de los cobros.",
      },
    ],
    sales_by_employee: [
      {
        user_id: "user-1",
        display_name: "posprojectsupport",
        order_count: 7,
        net_sales: "231.00",
        refund_count: 0,
      },
    ],
    refunds_by_reason: [],
    ...overrides,
  };
}

async function mockReports(
  page: Page,
  payload = storyPayload(),
  options: {
    previousPayload?: ReturnType<typeof storyPayload>;
    lowStock?: unknown[];
    velocity?: unknown[];
    delayUnexpectedStartMs?: number;
  } = {},
) {
  await page.route("**/api/v1/reports/business-story**", async (route) => {
    const url = new URL(route.request().url());
    const start = url.searchParams.get("start_date") ?? url.searchParams.get("start");
    const expectedStarts = new Set([
      payload.summary.start_date,
      options.previousPayload?.summary.start_date,
    ]);
    if (options.delayUnexpectedStartMs && !expectedStarts.has(start ?? undefined)) {
      await new Promise((resolve) => setTimeout(resolve, options.delayUnexpectedStartMs));
    }
    await route.fulfill({
      json:
        options.previousPayload && start === options.previousPayload.summary.start_date
          ? options.previousPayload
          : payload,
    });
  });
  await page.route("**/api/v1/reports/sales-by-hour**", async (route) => {
    const url = new URL(route.request().url());
    const start = url.searchParams.get("start_date") ?? url.searchParams.get("start");
    await route.fulfill({
      json: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        net_sales:
          start === options.previousPayload?.summary.start_date
            ? hour === 18 ? "60.00" : "0.00"
            : hour === 20 ? "90.00" : hour === 21 ? "70.00" : "0.00",
        order_count:
          start === options.previousPayload?.summary.start_date
            ? hour === 18 ? 2 : 0
            : hour === 20 ? 3 : hour === 21 ? 2 : 0,
      })),
    });
  });
  // ReportsView reads the full stock list (not the low-stock subset).
  await page.route("**/api/v1/inventory/stock", async (route) => {
    await route.fulfill({ json: options.lowStock ?? [] });
  });
  await page.route("**/api/v1/inventory/velocity", async (route) => {
    await route.fulfill({ json: options.velocity ?? [] });
  });
}

test("product cost flows through a completed sale into exact margin", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockAuthAs(page, "owner", true);
  const category = {
    id: "category-1",
    tenant_id: "tenant-1",
    name: "Pan dulce",
    description: null,
    sort_order: 0,
    is_active: true,
  };
  let product = {
    id: "product-1",
    tenant_id: "tenant-1",
    category_id: category.id,
    name: "Concha",
    description: null,
    sku: "CON-001",
    price_amount: "18.50",
    cost_price: null as string | null,
    track_inventory: false,
    low_stock_threshold: null,
    is_active: true,
    modifier_groups: [],
  };
  let capturedSale: {
    items: Array<{ product_id: string; quantity: number }>;
    payments: Array<{ method: string; amount: string }>;
  } | null = null;

  await page.route("**/api/v1/catalog/categories", (route) =>
    route.fulfill({ json: [category] }),
  );
  await page.route("**/api/v1/catalog/products", (route) =>
    route.fulfill({ json: [product] }),
  );
  await page.route("**/api/v1/catalog/products/product-1", async (route) => {
    const body = route.request().postDataJSON() as { cost_price?: string | null };
    product = { ...product, cost_price: body.cost_price ?? null };
    await route.fulfill({ json: product });
  });
  await page.route("**/api/v1/catalog/modifier-groups", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/telemetry/events", (route) =>
    route.fulfill({ status: 204, body: "" }),
  );
  await page.route("**/api/v1/inventory/stock", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/shifts/current", (route) =>
    route.fulfill({
      json: {
        id: "shift-1",
        status: "open",
        opening_cash_amount: "100.00",
        opened_at: "2026-07-18T12:00:00Z",
      },
    }),
  );
  await page.route("**/api/v1/sync/offline-sales", async (route) => {
    const body = route.request().postDataJSON() as {
      sales: Array<{
        client_uuid: string;
        order: {
          items: Array<{ product_id: string; quantity: number }>;
          payments: Array<{ method: string; amount: string }>;
        };
      }>;
    };
    capturedSale = body.sales[0].order;
    await route.fulfill({
      json: {
        results: [{
          client_uuid: body.sales[0].client_uuid,
          status: "synced",
          order_id: "order-1",
          order: {
            id: "order-1",
            tenant_id: "tenant-1",
            status: "completed",
            subtotal_amount: "18.50",
            total_amount: "18.50",
            items: [{
              id: "item-1",
              product_id: "product-1",
              product_name: "Concha",
              quantity: 1,
              unit_price_amount: "18.50",
              line_total_amount: "18.50",
              modifiers: [],
            }],
            payments: [{
              id: "payment-1",
              method: "cash",
              amount_amount: "18.50",
              amount_tendered_amount: "20.00",
              change_due_amount: "1.50",
              reference: null,
            }],
          },
          error: null,
        }],
      },
    });
  });
  await page.route("**/api/v1/orders/order-1/receipt", (route) =>
    route.fulfill({ status: 404, json: { detail: "Receipt not needed by this flow" } }),
  );

  await page.goto("/catalog");
  await expect(page.getByText("Sin costo")).toBeVisible();
  await page.getByRole("button", { name: /editar costos/i }).click();
  await page.getByLabel(/costo unitario · concha/i).fill("8.00");
  await page.getByRole("button", { name: /guardar costos/i }).click();
  await expect(page.getByText(/1 costo actualizado/i)).toBeVisible();
  expect(product.cost_price).toBe("8.00");

  await page.goto("/register");
  await page.getByRole("button", { name: "Agregar Concha" }).click();
  await page.getByLabel(/efectivo recibido/i).fill("20.00");
  await page.getByRole("button", { name: /^cobrar$/i }).click();
  await expect(
    page.getByRole("main").getByText("Venta completada.", { exact: true }),
  ).toBeVisible();
  expect(capturedSale).toMatchObject({
    items: [{ product_id: "product-1", quantity: 1 }],
    payments: [{ method: "cash", amount: "18.50" }],
  });

  await mockReports(page, storyPayload({
    summary: {
      start_date: "2026-07-18",
      end_date: "2026-07-18",
      timezone: "America/Mexico_City",
      gross_sales: "18.50",
      refund_total: "0.00",
      net_sales: "18.50",
      completed_orders: 1,
      average_ticket: "18.50",
      refund_count: 0,
      cancellation_count: 0,
    },
    margin: {
      summary: {
        net_sales: "18.50",
        cogs: "8.00",
        gross_profit: "10.50",
        gross_margin_pct: "56.76",
        sold_products: 1,
        sold_products_without_cost: 0,
        complete: true,
      },
      by_day: [],
      by_product: [{
        product_id: "product-1",
        product_name: "Concha",
        quantity_sold: 1,
        net_sales: "18.50",
        cogs: "8.00",
        gross_profit: "10.50",
        gross_margin_pct: "56.76",
        missing_cost: false,
      }],
    },
  }));

  await page.goto("/reports");
  const margin = page.getByTestId("margin-analysis");
  await expect(margin.getByText("$10.50").first()).toBeVisible();
  await expect(margin.getByText("56.76% de margen bruto")).toBeVisible();
  await expect(margin.getByText("Concha", { exact: true })).toBeVisible();
});

test("typed waste remains visible in kardex and its valued report", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockAuthAs(page, "owner", true);
  let stockOnHand = 10;
  let capturedAdjustment: {
    quantity_delta: number;
    reason: string;
    reason_code: string;
  } | null = null;
  const stock = () => [{
    product_id: "product-1",
    product_name: "Leche entera",
    sku: "LEC-1",
    track_inventory: true,
    stock_on_hand: stockOnHand,
    low_stock_threshold: 3,
    is_low_stock: stockOnHand <= 3,
  }];

  await page.route("**/api/v1/inventory/stock", (route) =>
    route.fulfill({ json: stock() }),
  );
  await page.route("**/api/v1/inventory/low-stock", (route) =>
    route.fulfill({ json: stock().filter((item) => item.is_low_stock) }),
  );
  await page.route("**/api/v1/inventory/velocity", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/inventory/products/product-1/adjustments", async (route) => {
    capturedAdjustment = route.request().postDataJSON() as typeof capturedAdjustment;
    stockOnHand += capturedAdjustment?.quantity_delta ?? 0;
    await route.fulfill({
      status: 201,
      json: {
        id: "movement-1",
        product_id: "product-1",
        movement_type: "adjustment",
        quantity_delta: capturedAdjustment?.quantity_delta,
        stock_on_hand: stockOnHand,
        reason: capturedAdjustment?.reason,
        reason_code: capturedAdjustment?.reason_code,
      },
    });
  });
  await page.route("**/api/v1/inventory/products/product-1/movements?*", (route) =>
    route.fulfill({
      json: {
        items: capturedAdjustment ? [{
          id: "movement-1",
          movement_type: "adjustment",
          quantity_delta: capturedAdjustment.quantity_delta,
          stock_on_hand_after: stockOnHand,
          reason: capturedAdjustment.reason,
          reason_code: capturedAdjustment.reason_code,
          created_by_user_id: "user-1",
          created_at: "2026-07-18T14:00:00Z",
        }] : [],
        total: capturedAdjustment ? 1 : 0,
        limit: 20,
        offset: 0,
      },
    }),
  );

  await page.goto("/inventory");
  await page.getByRole("button", { name: /ajustar/i }).click();
  await page.getByLabel(/cambio de cantidad/i).fill("-2");
  await page.getByLabel(/tipo de salida/i).selectOption("merma");
  await page.getByLabel(/^motivo$/i).fill("Envases dañados");
  await page.getByRole("button", { name: /guardar/i }).click();
  await expect(page.getByText(/stock ajustado/i)).toBeVisible();
  expect(capturedAdjustment).toEqual({
    quantity_delta: -2,
    reason: "Envases dañados",
    reason_code: "merma",
  });

  await page.getByRole("button", { name: /^historial$/i }).click();
  await expect(page.getByText("Historial de movimientos")).toBeVisible();
  await expect(page.getByText("Merma", { exact: true })).toBeVisible();
  await expect(page.getByText("-2", { exact: true })).toBeVisible();

  await mockReports(page, storyPayload({
    waste: {
      units: 2,
      movement_count: 1,
      value: "24.00",
      known_value: "24.00",
      products_without_cost: 0,
      complete: true,
      by_reason: [
        { reason_code: "merma", units: 2, value: "24.00", products_without_cost: 0 },
      ],
    },
  }));

  await page.goto("/reports");
  const waste = page.getByTestId("waste-analysis");
  await expect(waste.getByText("$24.00").first()).toBeVisible();
  await expect(waste.getByText("Merma", { exact: true })).toBeVisible();
  await expect(waste.getByText(/2 unidades en 1 movimiento/i)).toBeVisible();
});

test("desktop sidebar covers the viewport after scrolling reports", async ({ page }) => {
  await page.setViewportSize({ width: 1365, height: 768 });
  await markFirstUseToursSeen(page);
  await mockAuthAs(page, "owner");
  await mockReports(page);

  await page.goto("/reports");
  await expect(page.getByText("Resumen del periodo")).toBeVisible();

  await page.evaluate(() => {
    const main = document.querySelector("main");
    const scroller = main?.parentElement;
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  });

  const sidebar = await page.locator("aside").boundingBox();
  expect(sidebar).not.toBeNull();
  expect(Math.round(sidebar?.y ?? -1)).toBe(0);
  expect(Math.round(sidebar?.height ?? 0)).toBe(768);
});

/** Reads scrollTop of every box wrapping the report content. Only
 * #contenido-principal may ever be non-zero: it is the one scroller the user
 * can scroll back. If an ancestor moves, the shell slides off screen and no
 * amount of scrolling brings it back — a reload is the only recovery. */
async function shellScrollOffsets(page: Page) {
  return page.evaluate(() => {
    const scroller = document.getElementById("contenido-principal");
    const contentColumn = scroller?.parentElement ?? null;
    const shellRoot = contentColumn?.parentElement ?? null;
    return {
      documentElement: document.documentElement.scrollTop,
      body: document.body.scrollTop,
      shellRoot: shellRoot?.scrollTop ?? -1,
      contentColumn: contentColumn?.scrollTop ?? -1,
    };
  });
}

test("reports scrolling never moves the app shell itself", async ({ page }) => {
  await page.setViewportSize({ width: 1365, height: 768 });
  await markFirstUseToursSeen(page);
  await mockAuthAs(page, "owner", true);
  await mockReports(page);

  await page.goto("/reports");
  await expect(page.getByText("Resumen del periodo")).toBeVisible();

  const anchored = { documentElement: 0, body: 0, shellRoot: 0, contentColumn: 0 };

  // Real wheel input, well past the end of the content: scroll must stay in
  // #contenido-principal and never chain out to the shell or the document.
  await page.mouse.move(800, 400);
  for (let i = 0; i < 40; i += 1) {
    await page.mouse.wheel(0, 400);
  }
  await expect.poll(() => shellScrollOffsets(page)).toEqual(anchored);

  // The products panel jumps to the full table; that must move the scroller
  // only, never an ancestor.
  await page.getByRole("button", { name: "Ver tabla completa" }).click();
  await expect.poll(() => shellScrollOffsets(page)).toEqual(anchored);
  await expect(page.locator("#reporte-productos")).toBeInViewport();

  // The sidebar still covers the viewport, footer included.
  const sidebar = await page.locator("aside").boundingBox();
  expect(Math.round(sidebar?.y ?? -1)).toBe(0);
  expect(Math.round(sidebar?.height ?? 0)).toBe(768);
  await expect(page.locator("[data-capture-account]")).toBeInViewport();

  // The containing block above is a screen-only device. If it survived into
  // print it would capture .print-receipt-root / .print-corte-root and the
  // thermal ticket would leave the page origin.
  const positionByMedia = async (media: "screen" | "print") => {
    await page.emulateMedia({ media });
    return page.evaluate(() =>
      getComputedStyle(document.getElementById("contenido-principal")!).position,
    );
  };
  expect(await positionByMedia("screen")).toBe("relative");
  expect(await positionByMedia("print")).toBe("static");
  await page.emulateMedia({ media: "screen" });
});

test("reports page displays analytics dashboard layout", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockAuthAs(page, "owner");
  await mockReports(page, storyPayload(), {
    previousPayload: storyPayload({
      summary: {
        start_date: "2026-05-06",
        end_date: "2026-05-12",
        timezone: "America/Mexico_City",
        gross_sales: "180.00",
        refund_total: "0.00",
        net_sales: "180.00",
        completed_orders: 5,
        average_ticket: "36.00",
        refund_count: 0,
        cancellation_count: 0,
      },
      sales_by_daypart: [
        { key: "madrugada", label: "Madrugada", start_hour: 0, end_hour: 5, net_sales: "0.00", order_count: 0, average_ticket: "0.00", sales_share_pct: 0 },
        { key: "manana", label: "Mañana", start_hour: 6, end_hour: 11, net_sales: "80.00", order_count: 2, average_ticket: "40.00", sales_share_pct: 44 },
        { key: "tarde", label: "Tarde", start_hour: 12, end_hour: 17, net_sales: "100.00", order_count: 3, average_ticket: "33.33", sales_share_pct: 56 },
        { key: "noche", label: "Noche", start_hour: 18, end_hour: 23, net_sales: "0.00", order_count: 0, average_ticket: "0.00", sales_share_pct: 0 },
      ],
    }),
    lowStock: [
      {
        product_id: "product-1",
        product_name: "Dona",
        sku: "DONA",
        track_inventory: true,
        stock_on_hand: 2,
        low_stock_threshold: 6,
        is_low_stock: true,
      },
    ],
  });

  await page.goto("/reports");
  await page.getByLabel(/fecha inicial/i).fill("2026-05-13");
  await page.getByLabel(/fecha final/i).fill("2026-05-19");
  await page.getByRole("button", { name: /aplicar/i }).click();

  // KPI row: the four tiles with their exact labels. The previous period
  // ($180) is below MIN_MONEY_BASE, so the headline deliberately avoids a
  // noisy percentage.
  await expect(page.getByRole("heading", { name: "Análisis", exact: true })).toBeVisible();
  await expect(page.getByText("Resumen del periodo")).toBeVisible();
  await expect(page.getByText("Ventas netas", { exact: true })).toBeVisible();
  await expect(page.getByText("Ticket promedio", { exact: true })).toBeVisible();
  await expect(page.getByText("Devoluciones", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("Comparado con el periodo anterior: 6 may – 12 may (7 días)."),
  ).toBeVisible();

  // Hero chart: the one-line headline lives as its subtitle. Previous-period
  // context stays in the report copy without adding a trend overlay.
  await expect(page.getByText("Ventas por día", { exact: true })).toBeVisible();
  await expect(page.getByText("Vendiste $231.00 con 7 órdenes en estos 7 días.")).toBeVisible();
  await expect(page.getByText("Periodo anterior", { exact: true })).toHaveCount(0);

  // The priority action reads without any interaction on the rail.
  const hero = page.getByTestId("priority-recommendation");
  await expect(hero).toBeVisible();
  await expect(hero).toContainText("Tu prioridad ahora");
  await expect(hero).toContainText("Dona necesita reabasto pronto");

  // Bento cells: every thematic block framed as a business question.
  await expect(page.getByText("¿Cuándo vendo más?")).toBeVisible();
  await expect(page.getByText("¿Qué producto mueve el negocio?")).toBeVisible();
  await expect(page.getByText("¿Cómo me están pagando?")).toBeVisible();
  await expect(page.getByText("¿Hay devoluciones o cancelaciones preocupantes?")).toBeVisible();
  await expect(page.getByText("¿Quién está vendiendo?")).toBeVisible();
  await expect(page.getByText("Bloques del día")).toBeVisible();
  await expect(page.getByText("Bloque más fuerte")).toBeVisible();
  await expect(page.getByText("Tus 3 mejores horas")).toBeVisible();

  // Full detail survives below the fold: the product/inventory table.
  await expect(page.getByRole("cell", { name: "Dona", exact: true })).toBeVisible();
  await expect(page.getByRole("table").first().getByText("Reabastecer", { exact: true })).toBeVisible();

  // The rest of the plan is collapsed by default; expanding reveals the
  // synthesized signals (0 refunds/cancellations → operations-normal row).
  await expect(page.getByText("Qué hacer ahora", { exact: true })).toBeVisible();
  await expect(page.getByText(/Pagos y devoluciones en nivel normal/)).toHaveCount(0);
  await page.getByRole("button", { name: /Ver plan completo/ }).click();
  await expect(page.getByText(/Pagos y devoluciones en nivel normal/)).toBeVisible();
});

test("margin report is tenant-flagged and shows only exact profit", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockAuthAs(page, "owner", true);
  await mockReports(page);

  await page.goto("/reports");

  const panel = page.getByTestId("margin-analysis");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("$138.60")).toBeVisible();
  await expect(panel.getByText("60.00% de margen bruto")).toBeVisible();
  await expect(panel.getByText("$840.00")).toBeVisible();
  const waste = page.getByTestId("waste-analysis");
  await expect(waste).toBeVisible();
  await expect(waste.getByText("$36.00")).toBeVisible();
  await expect(waste.getByText("Caducidad")).toBeVisible();
  const operating = page.getByTestId("operating-expense-analysis");
  await expect(operating).toBeVisible();
  await expect(operating.getByText("$93.60")).toBeVisible();
  await expect(operating.getByText("$45.00")).toBeVisible();
});

test("reports keeps the latest applied range when an earlier request finishes last", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockAuthAs(page, "owner");
  await mockReports(page, storyPayload(), {
    previousPayload: storyPayload({
      summary: {
        start_date: "2026-05-06",
        end_date: "2026-05-12",
        timezone: "America/Mexico_City",
        gross_sales: "180.00",
        refund_total: "0.00",
        net_sales: "180.00",
        completed_orders: 5,
        average_ticket: "36.00",
        refund_count: 0,
        cancellation_count: 0,
      },
    }),
    delayUnexpectedStartMs: 400,
  });

  await page.goto("/reports");
  await page.getByLabel(/fecha inicial/i).fill("2026-05-13");
  await page.getByLabel(/fecha final/i).fill("2026-05-19");
  await page.getByRole("button", { name: /aplicar/i }).click();

  const expectedCaption = page.getByText(
    "Comparado con el periodo anterior: 6 may – 12 may (7 días).",
  );
  await expect(expectedCaption).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(expectedCaption).toBeVisible();
  await expect(
    page.getByText("Comparado con el periodo anterior: 13 may – 19 may (7 días)."),
  ).toHaveCount(0);
});

test("reports aligns best moment and strongest block when afternoon leads sales", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockAuthAs(page, "owner");
  await mockReports(page, storyPayload({
    summary: {
      start_date: "2026-05-13",
      end_date: "2026-05-19",
      timezone: "America/Mexico_City",
      gross_sales: "200.00",
      refund_total: "0.00",
      net_sales: "200.00",
      completed_orders: 5,
      average_ticket: "40.00",
      refund_count: 0,
      cancellation_count: 0,
    },
    sales_by_daypart: [
      { key: "madrugada", label: "Madrugada", start_hour: 0, end_hour: 5, net_sales: "0.00", order_count: 0, average_ticket: "0.00", sales_share_pct: 0 },
      { key: "manana", label: "Mañana", start_hour: 6, end_hour: 11, net_sales: "80.00", order_count: 2, average_ticket: "40.00", sales_share_pct: 40 },
      { key: "tarde", label: "Tarde", start_hour: 12, end_hour: 17, net_sales: "120.00", order_count: 3, average_ticket: "40.00", sales_share_pct: 60 },
      { key: "noche", label: "Noche", start_hour: 18, end_hour: 23, net_sales: "0.00", order_count: 0, average_ticket: "0.00", sales_share_pct: 0 },
    ],
    peak_hour: {
      hour: 15,
      label: "15:00-16:00",
      daypart_key: "tarde",
      net_sales: "70.00",
      order_count: 3,
      sales_share_pct: 35,
    },
    recommended_actions: [
      {
        type: "opportunity",
        title: "Refuerza operación en tarde",
        detail: "Este bloque concentra 60% de tus ventas del periodo.",
      },
    ],
  }), {
    previousPayload: storyPayload({
      summary: {
        start_date: "2026-05-06",
        end_date: "2026-05-12",
        timezone: "America/Mexico_City",
        gross_sales: "100.00",
        refund_total: "0.00",
        net_sales: "100.00",
        completed_orders: 3,
        average_ticket: "33.33",
        refund_count: 0,
        cancellation_count: 0,
      },
      sales_by_daypart: [
        { key: "madrugada", label: "Madrugada", start_hour: 0, end_hour: 5, net_sales: "0.00", order_count: 0, average_ticket: "0.00", sales_share_pct: 0 },
        { key: "manana", label: "Mañana", start_hour: 6, end_hour: 11, net_sales: "70.00", order_count: 2, average_ticket: "35.00", sales_share_pct: 70 },
        { key: "tarde", label: "Tarde", start_hour: 12, end_hour: 17, net_sales: "30.00", order_count: 1, average_ticket: "30.00", sales_share_pct: 30 },
        { key: "noche", label: "Noche", start_hour: 18, end_hour: 23, net_sales: "0.00", order_count: 0, average_ticket: "0.00", sales_share_pct: 0 },
      ],
      peak_hour: {
        hour: 9,
        label: "09:00-10:00",
        daypart_key: "manana",
        net_sales: "40.00",
        order_count: 2,
        sales_share_pct: 40,
      },
    }),
  });

  await page.goto("/reports");

  // The strongest-block badge must sit on the block that actually leads sales.
  await expect(page.getByText("Bloques del día")).toBeVisible();
  const strongestBlock = page.getByText("Bloque más fuerte", { exact: true }).locator("..");
  await expect(strongestBlock).toContainText("Tarde");

  // Peak-hour facts follow the same afternoon story.
  await expect(page.getByText("Hora pico", { exact: true }).locator("..")).toContainText("15:00-16:00");
});

test("reports shows useful empty state without demo data", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockAuthAs(page, "owner");
  await mockReports(
    page,
    storyPayload({
      summary: {
        start_date: "2026-05-19",
        end_date: "2026-05-19",
        timezone: "America/Mexico_City",
        gross_sales: "0.00",
        refund_total: "0.00",
        net_sales: "0.00",
        completed_orders: 0,
        average_ticket: "0.00",
        refund_count: 0,
        cancellation_count: 0,
      },
      sales_by_day: [],
      sales_by_daypart: [
        { key: "madrugada", label: "Madrugada", start_hour: 0, end_hour: 5, net_sales: "0.00", order_count: 0, average_ticket: "0.00", sales_share_pct: 0 },
        { key: "manana", label: "Mañana", start_hour: 6, end_hour: 11, net_sales: "0.00", order_count: 0, average_ticket: "0.00", sales_share_pct: 0 },
        { key: "tarde", label: "Tarde", start_hour: 12, end_hour: 17, net_sales: "0.00", order_count: 0, average_ticket: "0.00", sales_share_pct: 0 },
        { key: "noche", label: "Noche", start_hour: 18, end_hour: 23, net_sales: "0.00", order_count: 0, average_ticket: "0.00", sales_share_pct: 0 },
      ],
      peak_hour: null,
      top_product_by_sales: null,
      top_product_by_units: null,
      product_drivers: [],
      dominant_payment: null,
      payment_mix: [],
      operational_signals: [],
      recommended_actions: [
        {
          type: "opportunity",
          title: "Genera la primera venta del periodo",
          detail: "Abre caja y registra ventas reales para activar los insights del análisis.",
        },
      ],
      sales_by_employee: [],
    }),
  );

  await page.goto("/reports");

  await expect(page.getByText(/A[uú]n no hay ventas para contar una historia/i)).toBeVisible();
  await expect(page.getByText(/Abrir caja y vender/i)).toBeVisible();
  await expect(page.getByText(/demo/i)).not.toBeVisible();
});

test("no onboarding tour covers the first read of reports", async ({ page }) => {
  // Deliberately NOT calling markFirstUseToursSeen: even on a first visit,
  // nothing may overlay the period summary.
  await mockAuthAs(page, "owner");
  await mockReports(page);

  await page.goto("/reports");

  await expect(page.getByText("Resumen del periodo")).toBeVisible();
  await expect(page.locator("#first-use-tour-title")).toHaveCount(0);
});
