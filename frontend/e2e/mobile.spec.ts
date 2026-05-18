import { expect, test } from "@playwright/test";

const OWNER_SESSION = {
  authenticated: true,
  user: { id: "user-1", email: "owner@bakery.com", tenant_id: "tenant-1", role: "owner" },
  tenant_id: "tenant-1",
  tenant_name: "Bakery",
};

const PRODUCT = {
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
};

async function mockCommon(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: OWNER_SESSION }));
  await page.route("**/api/v1/catalog/products", (route) => route.fulfill({ json: [PRODUCT] }));
  await page.route("**/api/v1/catalog/categories", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/inventory/stock", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/inventory/low-stock", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/shifts/current", (route) => route.fulfill({ json: null }));
  await page.route("**/api/v1/billing/subscription", (route) =>
    route.fulfill({
      json: {
        plan: { name: "Standard Plan", amount_minor_units: 19900, currency: "MXN", interval: "month" },
        subscription: null,
        access: {
          allowed: true,
          reason: "signup_trial",
          trialing: true,
          trial_ends_at: "2026-05-25T00:00:00Z",
          blocked_at: null,
          recovery_path: "/settings/billing",
        },
      },
    }),
  );
  await page.route("**/api/v1/onboarding/state", (route) =>
    route.fulfill({
      json: {
        tenant_id: "tenant-1",
        completed_count: 1,
        total_count: 7,
        steps: [
          { key: "business_profile", label: "Business profile", completed: false, action_path: "/settings/business-profile" },
          { key: "first_product", label: "Create product", completed: true, action_path: "/catalog?new=product" },
          { key: "open_shift", label: "Open shift", completed: false, action_path: "/shifts" },
        ],
      },
    }),
  );
}

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
}

test("orders render as cards at 390px without horizontal overflow", async ({ page }) => {
  await mockCommon(page);
  await page.route("**/api/v1/orders?**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "order-1",
            tenant_id: "tenant-1",
            status: "completed",
            total_amount: "18.50",
            created_at: "2026-05-18T10:00:00Z",
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      },
    }),
  );
  await page.goto("/orders");
  await expect(page.getByRole("link", { name: /MX\$18\.50/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("register dashboard and billing fit at 390px", async ({ page }) => {
  await mockCommon(page);
  await page.route("**/api/v1/reports/sales-summary**", (route) =>
    route.fulfill({
      json: {
        gross_sales: "0.00",
        refund_total: "0.00",
        net_sales: "0.00",
        order_count: 0,
        refund_count: 0,
        void_count: 0,
      },
    }),
  );
  await page.route("**/api/v1/reports/payment-breakdown**", (route) =>
    route.fulfill({ json: { payments: [] } }),
  );
  await page.route("**/api/v1/reports/top-products**", (route) =>
    route.fulfill({ json: { products: [] } }),
  );

  for (const path of ["/register", "/dashboard", "/settings/billing"]) {
    await page.goto(path);
    await expectNoHorizontalOverflow(page);
  }
});
