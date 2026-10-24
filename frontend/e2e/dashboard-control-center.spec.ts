import axe from "axe-core";
import { expect, test, type Page } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";
import { makeStory } from "../src/reports/__fixtures__/story";
import { summaryFromStory } from "../src/dashboard/storyAdapters";

async function workspace(page: Page, { role = "owner", features = true, status = "ready" } = {}) {
  await markFirstUseToursSeen(page);
  await page.addInitScript(() => localStorage.setItem("kova-onboarding-celebrated:Negocio de prueba", "1"));
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: {
    authenticated: true, tenant_id: "tenant-1", tenant_name: "Negocio de prueba",
    user: { id: "user-1", email: "owner@example.invalid", tenant_id: "tenant-1", role },
    feature_flags: { customer_orders: features, margin_reports: features },
  } }));
  await page.route("**/api/v1/reports/dashboard?*", async route => {
    if (status === "error") return route.fulfill({ status: 503 });
    const story = makeStory();
    story.summary.completed_orders = new URL(route.request().url()).searchParams.get("period") === "week" ? 70 : 10;
    return route.fulfill({ json: {
      story, hourly: [], previous_summary: summaryFromStory(story), timezone: "America/Mexico_City",
      active_catalog_count: 12, tracked_inventory_count: 7,
      low_stock_items: [{ product_id: "p1", product_name: "Latte mediano", sku: null, track_inventory: true,
        stock_on_hand: 2, reserved_quantity: 0, available_quantity: 2, low_stock_threshold: 5, is_low_stock: true }],
      active_employee_count: 1, closed_shift_count: 50, billing: null,
      onboarding: { tenant_id: "tenant-1", completed_count: 0, total_count: 0, steps: [] },
    } });
  });
}

for (const width of [320, 390, 768, 1440, 1920]) {
  test(`owner control center is usable and accessible at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await workspace(page);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "Centro de control" })).toBeVisible();
    const control = page.getByRole("region", { name: "Cada área, a la vista" });
    await expect(control.getByText("10 órdenes completadas", { exact: true })).toBeVisible();
    await expect(control.getByText("1 producto por reponer", { exact: true })).toBeVisible();
    await expect(control.getByRole("heading", { level: 3 })).toHaveCount(6);
    for (const path of ["/register", "/orders", "/pedidos", "/quotes", "/shifts", "/inventory", "/catalog", "/replenishment", "/purchasing", "/customers", "/crm", "/commercial-requests", "/followups", "/loyalty", "/settings/public-catalog", "/operations-queue", "/appointments", "/service-cases", "/inbox", "/reports", "/expenses", "/reconciliation", "/settings", "/automations", "/settings/channels", "/settings/integrations", "/settings/billing"]) {
      await expect(control.locator(`a[href="${path}"]`)).toBeVisible();
    }
    await expect(control.locator('a[href="/assistant"]')).toHaveCount(0);
    await page.getByRole("radio", { name: "7 días", exact: true }).click();
    await expect(control.getByText("70 órdenes completadas", { exact: true })).toBeVisible();
    await expect(control.getByText("1 producto por reponer", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => document.fonts.ready);
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      const engine = (window as unknown as { axe: typeof axe }).axe;
      return (await engine.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations;
    });
    expect(violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`control-center-${width}.png`), fullPage: true });
    await page.getByRole("link", { name: "Explorar mi negocio" }).click();
    const controlHeading = control.getByRole("heading", { name: "Cada área, a la vista" });
    expect((await controlHeading.boundingBox())!.y).toBeLessThan(160);
    await page.screenshot({ path: testInfo.outputPath(`business-areas-${width}.png`) });
    const inventory = control.locator('a[href="/inventory"]');
    await inventory.focus();
    await expect(inventory).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/inventory$/);
  });
}

test("area navigation respects feature, billing and role gates from the shell", async ({ page }) => {
  await workspace(page, { role: "manager", features: false });
  await page.goto("/dashboard");
  const control = page.getByRole("region", { name: "Cada área, a la vista" });
  await expect(control).toBeVisible();
  for (const path of ["/expenses", "/pedidos", "/settings/billing", "/assistant"]) {
    await expect(control.locator(`a[href="${path}"]`)).toHaveCount(0);
  }
  await expect(control.locator('a[href="/customers"]')).toBeVisible();
});

test("report failure keeps area navigation usable without zero or healthy claims", async ({ page }) => {
  await workspace(page, { status: "error" });
  await page.goto("/dashboard");
  await expect(page.getByText("No se pudo cargar el panel", { exact: true })).toBeVisible();
  const control = page.getByRole("region", { name: "Cada área, a la vista" });
  await expect(control.getByText("Consulta tus existencias", { exact: true })).toBeVisible();
  await expect(control.getByText("Consulta pendientes y citas", { exact: true })).toBeVisible();
  await expect(control.getByText(/0 productos|0 órdenes|Sin pendientes|Saludable/)).toHaveCount(0);
});
