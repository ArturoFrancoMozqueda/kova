import { type Page, expect, test } from "@playwright/test";
import { markFirstUseToursSeen } from "./helpers";

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

async function mockReports(
  page: Page,
  payload = storyPayload(),
  options: {
    previousPayload?: ReturnType<typeof storyPayload>;
    lowStock?: unknown[];
    velocity?: unknown[];
  } = {},
) {
  await page.route("**/api/v1/reports/business-story**", async (route) => {
    const url = new URL(route.request().url());
    const start = url.searchParams.get("start");
    await route.fulfill({
      json:
        options.previousPayload && start === options.previousPayload.summary.start_date
          ? options.previousPayload
          : payload,
    });
  });
  await page.route("**/api/v1/reports/sales-by-hour**", async (route) => {
    const url = new URL(route.request().url());
    const start = url.searchParams.get("start");
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
  await page.route("**/api/v1/inventory/low-stock", async (route) => {
    await route.fulfill({ json: options.lowStock ?? [] });
  });
  await page.route("**/api/v1/inventory/velocity", async (route) => {
    await route.fulfill({ json: options.velocity ?? [] });
  });
}

test("reports page displays business storytelling layout", async ({ page }) => {
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

  await expect(page.getByRole("heading", { name: "Reportes", exact: true })).toBeVisible();
  await expect(page.getByText(/resumen ejecutivo/i)).toBeVisible();
  await expect(page.getByText(/Kova gener[oó] \$231\.00 en ventas netas/i)).toBeVisible();
  await expect(page.getByText("+28% vs. periodo anterior.")).toBeVisible();
  await expect(page.getByText(/Reabastece Dona/i)).toBeVisible();
  await expect(page.getByText(/Refuerza operación en noche/i)).toBeVisible();
  await expect(page.getByTestId("owner-brief-action")).toHaveCount(3);
  await expect(page.getByText(/ventas por d[ií]a/i)).not.toBeVisible();

  await page.getByText(/ver análisis detallado/i).click();

  await expect(page.getByText(/ventas en el tiempo/i)).toBeVisible();
  await expect(page.getByText(/qu[eé] d[ií]as vendes m[aá]s/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /17 may: \$88\.00/i })).toBeVisible();
  await expect(page.getByText(/productos e inventario/i)).toBeVisible();
  await expect(page.getByRole("cell", { name: "Dona", exact: true })).toBeVisible();
  await expect(page.getByText("Reabastecer", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /pagos y operación/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Noche: \$160\.00/i })).toBeVisible();
  await expect(page.getByText(/Hora pico del periodo: 20:00-21:00/i)).toBeVisible();
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

  const bestMoment = page.getByText("Mejor momento", { exact: true }).locator("..").last();
  await expect(bestMoment).toContainText("Tarde");

  const strongestBlock = page.getByText("Horario fuerte", { exact: true }).locator("..").last();
  await expect(strongestBlock).toContainText("Tarde");
  await expect(strongestBlock).toContainText("Hora pico del bloque ganador: 15:00-16:00");

  await expect(page.getByText(/El mejor momento fue Tarde, especialmente entre 15:00-16:00/i)).toBeVisible();
  await expect(page.getByText(/Refuerza operación en tarde/i)).toBeVisible();
  await expect(page.getByText(/Refuerza operación en noche/i)).not.toBeVisible();
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
          detail: "Abre caja y registra ventas reales para activar los insights del reporte.",
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
