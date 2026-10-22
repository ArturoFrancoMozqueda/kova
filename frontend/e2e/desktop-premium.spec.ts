import { createRequire } from "node:module";
import { expect, test, type Page } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";
import { makeStory } from "../src/reports/__fixtures__/story";
import { summaryFromStory } from "../src/dashboard/storyAdapters";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const products = Array.from({ length: 12 }, (_, index) => ({
  id: `product-${index}`, tenant_id: "tenant-1", category_id: "category-1",
  name: `Producto ${String(index + 1).padStart(2, "0")}`, description: null,
  sku: `SKU-${index}`, price_amount: "25.00", cost_price: "10.00", track_inventory: false,
  low_stock_threshold: null, is_active: true, modifier_groups: [], image_url: null,
}));
const stock = products.map((product, index) => ({
  product_id: product.id, product_name: product.name, sku: product.sku,
  track_inventory: true, stock_on_hand: index === 0 ? 2 : 30,
  reserved_quantity: 0, available_quantity: index === 0 ? 2 : 30,
  low_stock_threshold: 5, is_low_stock: index === 0,
}));

async function mockWorkspace(page: Page) {
  await markFirstUseToursSeen(page);
  await page.addInitScript(() => localStorage.setItem("kova-onboarding-celebrated:Negocio de prueba", "1"));
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: {
    authenticated: true, tenant_id: "tenant-1", tenant_name: "Negocio de prueba",
    user: { id: "user-1", email: "owner@example.invalid", tenant_id: "tenant-1", role: "owner" },
  } }));
  await page.route("**/api/v1/billing/subscription", route => route.fulfill({ json: {
    subscription: { status: "active" },
    access: { allowed: true, reason: "active", trialing: false, recovery_path: "/settings/billing" },
  } }));
  await page.route("**/api/v1/catalog/products", route => route.fulfill({ json: products }));
  await page.route("**/api/v1/catalog/categories", route => route.fulfill({ json: [
    { id: "category-1", tenant_id: "tenant-1", name: "Bebidas", is_active: true, sort_order: 0, description: null },
  ] }));
  await page.route("**/api/v1/catalog/modifier-groups", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/inventory/stock", route => route.fulfill({ json: stock }));
  await page.route("**/api/v1/inventory/low-stock", route => route.fulfill({ json: [stock[0]] }));
  await page.route("**/api/v1/inventory/velocity", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/customers**", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/shifts/current", route => route.fulfill({ json: {
    id: "shift-1", tenant_id: "tenant-1", status: "open", opening_cash_amount: "100.00", expected_cash_amount: "100.00",
  } }));
  await page.route("**/api/v1/reports/dashboard?*", route => {
    const story = makeStory();
    const period = new URL(route.request().url()).searchParams.get("period");
    story.summary.net_sales = period === "week" ? "7000.00" : "1000.00";
    story.summary.gross_sales = story.summary.net_sales;
    story.summary.refund_total = "0.00";
    story.summary.refund_count = 0;
    story.summary.completed_orders = period === "week" ? 70 : 10;
    return route.fulfill({ json: {
      story, hourly: [], previous_summary: { ...summaryFromStory(story), net_sales: "800.00" },
      timezone: "America/Mexico_City", active_catalog_count: 12, tracked_inventory_count: 12,
      low_stock_items: [stock[0]], active_employee_count: 1, closed_shift_count: 50, billing: null,
      onboarding: { tenant_id: "tenant-1", completed_count: 0, total_count: 0, steps: [] },
    } });
  });
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator("main").evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
}

async function expectAccessible(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations()
      .filter(animation => animation.effect?.getComputedTiming().endTime !== Infinity)
      .map(animation => animation.finished.catch(() => undefined)));
  });
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => {
    const axe = (window as typeof window & { axe: { run: (context: Document, options: object) => Promise<{ violations: unknown[] }> } }).axe;
    return (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations;
  });
  expect(violations).toEqual([]);
}

for (const width of [1366, 1440, 1920]) {
  test(`results and priorities lead the desktop at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await mockWorkspace(page);
    await page.goto("/dashboard");
    const results = page.getByRole("region", { name: "Tu día", exact: true });
    await expect(results.getByText("$1,000.00", { exact: true })).toBeVisible();
    expect((await results.boundingBox())!.y).toBeLessThan(220);
    expect((await page.getByRole("heading", { name: "Qué hacer ahora" }).boundingBox())!.y).toBeLessThan(550);
    await expect(page.getByRole("link", { name: /Abrir inventario/ }))
      .toHaveAttribute("href", "/inventory?product=product-0&filter=low");
    await expect(page.getByRole("link", { name: /Ver catálogo/ }))
      .toHaveAttribute("href", "/catalog?search=Latte+mediano");
    await expectNoOverflow(page);
    await expectAccessible(page);
    await page.screenshot({ path: testInfo.outputPath(`panel-${width}.png`) });
    await page.getByRole("radio", { name: "7 días", exact: true }).click();
    await expect(results.getByText("$7,000.00", { exact: true })).toBeVisible();
    const recap = page.getByRole("region", { name: "Tu operación en Kova" });
    await expect(recap).toContainText("Hasta los últimos 50 turnos cerrados, sin filtro de periodo.");
    await expect(recap.getByText("50", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: /Abrir inventario/ }).click();
    await expect(page).toHaveURL(/inventory\?product=product-0&filter=low/);
    await expect(page.getByRole("heading", { name: "Producto 01", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Producto 02", exact: true })).toHaveCount(0);
  });
}

test("inventory rows stay compact and secondary actions restore keyboard focus", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockWorkspace(page);
  await page.goto("/inventory");
  const product = page.getByRole("heading", { name: "Producto 01", exact: true });
  await expect(product).toBeVisible();
  const row = product.locator("xpath=../../../../..");
  // The quantity, minimum and actions share the product's row.
  const adjust = row.getByRole("button", { name: "Ajustar", exact: true });
  expect((await row.boundingBox())!.height).toBeLessThan(76);
  expect(Math.abs((await product.boundingBox())!.y - (await adjust.boundingBox())!.y)).toBeLessThan(30);
  const more = page.getByRole("button", { name: "Más acciones de Producto 01" });
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Conteo", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  await more.click();
  await page.getByRole("button", { name: "Conteo", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(more).toBeFocused();
  await expectNoOverflow(page);
  await expectAccessible(page);
  await expect(row).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("inventory-1366.png") });
});

test("a long desktop cart keeps the total and explicit charge reachable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockWorkspace(page);
  await page.goto("/register");
  for (const product of products) await page.getByRole("button", { name: `Agregar ${product.name}`, exact: true }).click();
  const charge = page.getByRole("button", { name: /^Cobrar/ });
  await expect(charge).toContainText("$300.00");
  await expect(charge).toBeInViewport({ ratio: 1 });
  const total = page.getByText("Total", { exact: true }).locator("..").getByText("$300.00", { exact: true });
  await expect(total).toBeInViewport({ ratio: 1 });
  await page.getByLabel("Efectivo recibido", { exact: true }).click();
  await page.getByLabel("Efectivo recibido", { exact: true }).fill("400");
  await page.getByLabel("Efectivo recibido", { exact: true }).press("Enter");
  await expect(charge).toBeEnabled();
  await expect(charge).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectNoOverflow(page);
  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath("checkout-1366.png") });
});

test("catalog filters and creation stay available in the compact category strip", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockWorkspace(page);
  await page.goto("/catalog");
  const categories = page.getByRole("region", { name: "Categorías", exact: true });
  await expect(categories).toBeVisible();
  expect((await categories.boundingBox())!.height).toBeLessThan(100);
  await categories.getByRole("button", { name: "Bebidas", exact: true }).click();
  await expect(categories.getByRole("button", { name: "Bebidas", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Buscar productos", { exact: true }).fill("Producto 01");
  await expect(page.getByText("Producto 01", { exact: true })).toBeVisible();
  await expect(page.getByText("Producto 02", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Nuevo producto", exact: true })).toBeVisible();
  await expectNoOverflow(page);
  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath("catalog-1366.png") });
});

for (const width of [320, 390, 1100]) {
  test(`workspace layouts retain readable content at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await mockWorkspace(page);
    for (const path of ["dashboard", "inventory", "catalog", "register"]) {
      await page.goto(`/${path}`);
      if (path === "dashboard") {
        await expect(page.getByRole("region", { name: "Tu día", exact: true })).toContainText("$1,000.00");
      } else if (path === "register") {
        await expect(page.getByRole("button", { name: "Agregar Producto 01", exact: true })).toBeVisible();
      } else {
        await expect(page.getByText("Producto 01", { exact: true }).first()).toBeVisible();
      }
      await expectNoOverflow(page);
      await expectAccessible(page);
      await page.screenshot({ path: testInfo.outputPath(`${path}-${width}.png`) });
    }
  });
}
