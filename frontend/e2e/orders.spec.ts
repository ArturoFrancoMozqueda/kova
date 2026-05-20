import { type Page, expect, test } from "@playwright/test";

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

test("orders support status filters and amount sorting at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAuthAsOwner(page);

  await page.route("**/api/v1/orders?**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const status = requestUrl.searchParams.get("status");
    const items = status ? orders.filter((order) => order.status === status) : orders;
    await route.fulfill({
      json: { items, total: items.length, limit: 50, offset: 0 },
    });
  });

  await page.goto("/orders");

  await expect(page.getByRole("heading", { name: /[óo]rdenes/i })).toBeVisible();
  await page.getByRole("button", { name: /canceladas/i }).click();
  await expect(page.locator("a[href='/orders/order-2']").first()).toContainText("18.50");
  await expect(page.locator("a[href='/orders/order-3']")).not.toBeVisible();

  await page.getByRole("button", { name: /todas/i }).click();
  await page.getByLabel(/ordenar ordenes/i).selectOption("amount_asc");
  await expect(page.locator("a[href='/orders/order-2']").first()).toContainText("18.50");
  await expect(page.locator("a[href='/orders/order-1']").first()).toContainText("42.00");
  await expect(page.locator("a[href='/orders/order-3']").first()).toContainText("95.00");
});
