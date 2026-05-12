import { type Page, expect, test } from "@playwright/test";

async function mockAuthAs(page: Page, role: string) {
  await page.route("**/api/v1/auth/me", async (route) => {
    await route.fulfill({
      json: {
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

  await page.goto("/reports");

  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(page.locator(".data-card").filter({ hasText: "Gross sales" }).getByText("MX$150.00")).toBeVisible();
  await expect(page.locator(".data-card").filter({ hasText: "Net sales" }).getByText("MX$125.00")).toBeVisible();
  await expect(page.getByText(/bank transfer/i)).toBeVisible();
  await expect(page.getByText("Concha")).toBeVisible();
});
