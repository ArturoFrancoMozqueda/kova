import axe from "axe-core";
import { expect, test, type Page } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";
import { makeStory } from "../src/reports/__fixtures__/story";
import { summaryFromStory } from "../src/dashboard/storyAdapters";
import { makeControl, northId, principalId } from "../src/dashboard/__fixtures__/control";

async function workspace(page: Page, unavailable = false) {
  await markFirstUseToursSeen(page, principalId);
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: {
    authenticated: true, tenant_id: principalId, tenant_name: "Negocio de control",
    user: { id: "user-control", tenant_id: principalId, role: "owner", email: "owner@example.invalid" },
    feature_flags: { customer_orders: true, margin_reports: true },
  } }));
  await page.route("**/api/v1/branches", route => route.fulfill({ json: makeControl().branches }));
  await page.route("**/api/v1/reports/dashboard?*", route => {
    const scope = new URL(route.request().url()).searchParams.get("branch_id");
    const control = makeControl();
    const story = makeStory();
    if (scope !== "all") {
      const branch = control.branches.find(branch => branch.id === scope)!;
      control.scope = { ...control.scope, kind: "branch", branch_id: branch.id, label: branch.name };
      control.branch_sales = control.branch_sales.filter(row => row.branch_id === scope);
      control.alerts = control.alerts.filter(alert => alert.branch_id === scope);
      control.alert_groups_total = control.alerts.length;
      control.priority_counts = { now: control.alerts.filter(alert => alert.priority === "now").length, today: control.alerts.filter(alert => alert.priority === "today").length, followup: 0 };
      story.summary.net_sales = scope === northId ? "4000.00" : "6000.00";
      story.summary.completed_orders = scope === northId ? 40 : 60;
    }
    if (unavailable) {
      control.areas = control.areas.map(area => area.key === "products" ? { ...area, status: "unavailable", metrics: [] } : area);
      control.branch_sales.forEach(branch => { branch.low_stock_count = null; });
      control.alerts = control.alerts.filter(alert => alert.key !== "out_of_stock");
      control.alert_groups_total = control.alerts.length;
    }
    return route.fulfill({ json: {
      story, hourly: [], previous_summary: summaryFromStory(story), timezone: "America/Mexico_City",
      active_catalog_count: 20, tracked_inventory_count: 10, low_stock_items: [], active_employee_count: 2,
      closed_shift_count: 4, billing: null,
      onboarding: { tenant_id: principalId, steps: [], completed_count: 0, total_count: 0 }, control_center: control,
    } });
  });
}

for (const width of [320, 390, 768, 1440, 1920]) {
  test(`supervision shows actionable business status and preserves Caja at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await workspace(page);
    const queries: string[] = [];
    page.on("request", request => {
      if (request.url().includes("/reports/dashboard?")) queries.push(new URL(request.url()).searchParams.get("branch_id")!);
    });
    await page.goto("/dashboard");
    await expect(page.getByLabel("Consultar", { exact: true })).toHaveValue("all");
    await expect(page.getByLabel("Sucursal activa", { exact: true })).toHaveValue(principalId);
    const attention = page.getByRole("region", { name: "Necesita tu atención" });
    await expect(attention.getByRole("link", { name: /Pedidos con entrega vencida/ })).toContainText("Norte");
    const areas = page.getByRole("region", { name: "Cada área, a la vista" });
    await expect(areas.getByText("Citas programadas para hoy", { exact: true })).toBeVisible();
    await expect(areas.getByText("Sin datos suficientes", { exact: true })).toBeVisible();
    for (const details of await areas.locator("details").all()) await details.locator("summary").click();
    await expect(areas.getByText("Compras con recepción parcial", { exact: true })).toBeVisible();
    await expect(areas.getByText("Preparación fiscal de producción", { exact: true })).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => document.fonts.ready);
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      const engine = (window as unknown as { axe: typeof axe }).axe;
      return (await engine.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations;
    });
    expect(violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("link", { name: "Explorar mi negocio" }).click();
    await page.screenshot({ path: testInfo.outputPath(`supervision-areas-${width}.png`) });
    await page.getByLabel("Consultar", { exact: true }).selectOption(northId);
    await expect(page.getByRole("region", { name: "Tu día", exact: true }).getByLabel("Ventas netas del periodo")).toHaveText("$4,000.00");
    await expect(page.getByLabel("Sucursal activa", { exact: true })).toHaveValue(principalId);
    await page.getByRole("radio", { name: "7 días", exact: true }).click();
    await expect(page.getByLabel("Consultar", { exact: true })).toHaveValue(northId);
    await expect(page.getByRole("region", { name: "Tu día", exact: true }).getByLabel("Ventas netas del periodo")).toHaveText("$4,000.00");
    expect(queries).toContain(northId);
    const foreignAlert = page.getByRole("region", { name: "Necesita tu atención" }).getByRole("link", { name: /Pedidos con entrega vencida/ });
    await foreignAlert.click();
    const dialog = page.getByRole("dialog", { name: "Abrir Norte" });
    await expect(dialog).toContainText("se vaciará el carrito");
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByLabel("Sucursal activa", { exact: true })).toHaveValue(principalId);
    await page.getByLabel("Consultar", { exact: true }).selectOption("all");
    await expect(page.getByRole("heading", { name: "Hay asuntos por atender" })).toBeVisible();
    await page.getByRole("heading", { name: "Centro de control", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`supervision-overview-${width}.png`) });
  });
}

test("a source failure is visible and never displayed as zero stock alerts", async ({ page }) => {
  await workspace(page, true);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Lectura parcial" })).toBeVisible();
  await expect(page.getByText("Algunas áreas no pudieron actualizarse.", { exact: false })).toBeVisible();
  const products = page.getByRole("article", { name: "Productos e inventario" });
  await expect(products).toContainText("No pudimos consultar esta área.");
  await expect(products.getByText("Stock bajo", { exact: true })).toHaveCount(0);
});
