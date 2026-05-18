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
  const report = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const offenders = Array.from(document.querySelectorAll("body *"))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
        return {
          tag: el.tagName.toLowerCase(),
          className: typeof el.className === "string" ? el.className : "",
          text,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((item) => item.width > 0 && (item.left < -1 || item.right > viewportWidth + 1))
      .sort((a, b) => Math.max(b.right - viewportWidth, -b.left) - Math.max(a.right - viewportWidth, -a.left))
      .slice(0, 8);

    return {
      viewportWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      hasOverflow: document.documentElement.scrollWidth > viewportWidth,
      offenders,
    };
  });

  expect(report.hasOverflow, JSON.stringify(report, null, 2)).toBe(false);
}

test("public landing fits common phone and tablet widths", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: { authenticated: false } }));

  for (const viewport of [
    { width: 320, height: 844 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("link", { name: /crear cuenta/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    if (viewport.width < 768) {
      await expect(page.getByRole("link", { name: "Producto" })).toBeHidden();
      await expect(page.getByRole("link", { name: "Precio" })).toBeHidden();
    }
  }
});

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
  await page.route("**/api/v1/reports/sales-by-hour**", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/reports/sales-by-employee**", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/reports/refunds-by-reason**", (route) =>
    route.fulfill({ json: [] }),
  );

  for (const path of ["/register", "/dashboard", "/reports", "/settings/billing"]) {
    await page.goto(path);
    await expectNoHorizontalOverflow(page);
  }
});

test("catalog fits at 390px with category and product visible", async ({ page }) => {
  await mockCommon(page);
  await page.route("**/api/v1/catalog/categories", (route) =>
    route.fulfill({
      json: [{ id: "cat-1", tenant_id: "tenant-1", name: "Pan", description: null, sort_order: 0, is_active: true }],
    }),
  );
  await page.route("**/api/v1/catalog/modifier-groups", (route) => route.fulfill({ json: [] }));

  await page.goto("/catalog");
  await expect(page.getByRole("heading", { name: /cat[áa]logo/i })).toBeVisible();
  await expect(page.getByText("Concha")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("inventory fits at 390px with empty state", async ({ page }) => {
  await mockCommon(page);
  await page.route("**/api/v1/inventory/movements**", (route) => route.fulfill({ json: [] }));

  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: /inventario/i })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("shifts fits at 390px with no open shift", async ({ page }) => {
  await mockCommon(page);
  await page.route(/\/api\/v1\/shifts(\?|$)/, (route) => route.fulfill({ json: [] }));

  await page.goto("/shifts");
  await expect(page.getByRole("heading", { name: /turnos/i })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
