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

test("reports page displays summary, payments, and top products", async ({ page }) => {
  await mockAuthAs(page, "owner");
  await page.route("**/api/v1/reports/sales-summary**", async (route) => {
    await route.fulfill({
      json: {
        start_date: "2026-05-08",
        end_date: "2026-05-08",
        gross_sales: "150.00",
        refund_total: "25.00",
        net_sales: "125.00",
        order_count: 3,
        refund_count: 1,
        void_count: 1,
      },
    });
  });
  await page.route("**/api/v1/reports/payment-breakdown**", async (route) => {
    await route.fulfill({
      json: {
        start_date: "2026-05-08",
        end_date: "2026-05-08",
        payments: [
          { method: "cash", amount: "100.00", payment_count: 2 },
          { method: "bank_transfer", amount: "50.00", payment_count: 1 },
        ],
      },
    });
  });
  await page.route("**/api/v1/reports/top-products**", async (route) => {
    await route.fulfill({
      json: {
        start_date: "2026-05-08",
        end_date: "2026-05-08",
        products: [
          {
            product_id: "product-1",
            product_name: "Concha",
            quantity_sold: 5,
            gross_sales: "125.00",
          },
        ],
      },
    });
  });
  await page.route("**/api/v1/reports/sales-by-hour**", async (route) => {
    await route.fulfill({
      json: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        net_sales: hour === 13 ? "90.00" : hour === 10 ? "35.00" : "0.00",
        order_count: hour === 13 ? 2 : hour === 10 ? 1 : 0,
      })),
    });
  });
  await page.route("**/api/v1/reports/sales-by-employee**", async (route) => {
    await route.fulfill({
      json: [
        {
          user_id: "user-1",
          display_name: "Ana",
          order_count: 2,
          net_sales: "90.00",
          refund_count: 0,
        },
      ],
    });
  });
  await page.route("**/api/v1/reports/refunds-by-reason**", async (route) => {
    await route.fulfill({
      json: [{ reason: "customer_return", refund_count: 1, refunded_amount: "25.00" }],
    });
  });

  await page.goto("/reports");

  await expect(page.getByRole("heading", { name: /reportes/i })).toBeVisible();
  await expect(page.getByText(/qu[eé] pas[oó] en este periodo/i)).toBeVisible();
  await expect(page.locator(".data-card").filter({ hasText: /ventas brutas/i }).getByText("MX$150.00")).toBeVisible();
  await expect(page.locator(".data-card").filter({ hasText: /ventas netas/i }).getByText("MX$125.00")).toBeVisible();
  await expect(page.getByRole("button", { name: /bank transfer: MX\$50\.00/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Concha: MX\$125\.00/i })).toBeVisible();

  const peakHour = page.getByRole("button", { name: /13:00-14:00.*MX\$90\.00/i }).first();
  await peakHour.click();
  await expect(page.getByText("Órdenes: 2")).toBeVisible();
  await peakHour.click();
  await expect(page.getByText(/selecciona un punto/i).first()).toBeVisible();
});

test("reports keeps primary data visible when storytelling endpoints are unavailable", async ({ page }) => {
  await mockAuthAs(page, "owner");
  await page.route("**/api/v1/reports/sales-summary**", async (route) => {
    await route.fulfill({
      json: {
        start_date: "2026-05-08",
        end_date: "2026-05-08",
        gross_sales: "150.00",
        refund_total: "25.00",
        net_sales: "125.00",
        order_count: 3,
        refund_count: 1,
        void_count: 1,
      },
    });
  });
  await page.route("**/api/v1/reports/payment-breakdown**", async (route) => {
    await route.fulfill({
      json: {
        start_date: "2026-05-08",
        end_date: "2026-05-08",
        payments: [{ method: "bank_transfer", amount: "50.00", payment_count: 1 }],
      },
    });
  });
  await page.route("**/api/v1/reports/top-products**", async (route) => {
    await route.fulfill({
      json: {
        start_date: "2026-05-08",
        end_date: "2026-05-08",
        products: [
          {
            product_id: "product-1",
            product_name: "Concha",
            quantity_sold: 5,
            gross_sales: "125.00",
          },
        ],
      },
    });
  });
  await page.route("**/api/v1/reports/sales-by-hour**", async (route) => {
    await route.fulfill({ status: 404, body: "not found" });
  });
  await page.route("**/api/v1/reports/sales-by-employee**", async (route) => {
    await route.fulfill({ status: 404, body: "not found" });
  });
  await page.route("**/api/v1/reports/refunds-by-reason**", async (route) => {
    await route.fulfill({ status: 404, body: "not found" });
  });

  await page.goto("/reports");

  await expect(page.locator(".data-card").filter({ hasText: /ventas netas/i }).getByText("MX$125.00")).toBeVisible();
  await expect(page.getByRole("button", { name: /bank transfer: MX\$50\.00/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Concha: MX\$125\.00/i })).toBeVisible();
  await expect(page.getByText(/sin ventas por hora/i)).toBeVisible();
});
