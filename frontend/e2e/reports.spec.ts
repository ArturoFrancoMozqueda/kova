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

async function mockReports(page: Page, payload = storyPayload()) {
  await page.route("**/api/v1/reports/business-story**", async (route) => {
    await route.fulfill({ json: payload });
  });
  await page.route("**/api/v1/reports/sales-by-hour**", async (route) => {
    await route.fulfill({
      json: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        net_sales: hour === 20 ? "90.00" : hour === 21 ? "70.00" : "0.00",
        order_count: hour === 20 ? 3 : hour === 21 ? 2 : 0,
      })),
    });
  });
}

test("reports page displays business storytelling layout", async ({ page }) => {
  await mockAuthAs(page, "owner");
  await mockReports(page);

  await page.goto("/reports");

  await expect(page.getByRole("heading", { name: /reportes/i })).toBeVisible();
  await expect(page.getByText(/resumen ejecutivo/i)).toBeVisible();
  await expect(page.getByText(/Kova gener[oó] MX\$231\.00 en ventas netas/i)).toBeVisible();
  await expect(page.locator(".data-card").filter({ hasText: /ventas netas/i }).getByText("MX$231.00")).toBeVisible();
  await expect(page.locator(".data-card").filter({ hasText: /producto top/i }).getByText("Dona", { exact: true })).toBeVisible();
  await expect(page.getByText(/ventas por d[ií]a/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /17 may: MX\$88\.00/i })).toBeVisible();
  await expect(page.getByText(/ventas por momento del d[ií]a/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Noche: MX\$160\.00/i })).toBeVisible();
  await expect(page.getByText(/Dentro del mejor bloque, tu pico fue de 20:00-21:00/i)).toBeVisible();
  await expect(page.getByText("Cash representa 83% de los cobros.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Refuerza operación en noche/i)).toBeVisible();
});

test("reports shows useful empty state without demo data", async ({ page }) => {
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
          detail: "Abre caja y registra ventas reales para activar los insights del reporte.",
        },
      ],
      sales_by_employee: [],
    }),
  );

  await page.goto("/reports");

  await expect(page.getByText(/A[uú]n no hay ventas para contar una historia/i)).toBeVisible();
  await expect(page.getByText(/Genera la primera venta del periodo/i)).toBeVisible();
  await expect(page.getByText(/demo/i)).not.toBeVisible();
});
