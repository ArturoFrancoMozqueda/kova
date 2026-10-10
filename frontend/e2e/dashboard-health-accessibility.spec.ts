import axe, { type AxeResults } from "axe-core";
import { expect, test } from "./fixtures";
import { makeStory } from "../src/reports/__fixtures__/story";

for (const refundCount of [7, 0]) {
  test(`health card text meets AA contrast with ${refundCount} refund events`, async ({ page }) => {
    const story = makeStory();
    story.summary = {
      ...story.summary, completed_orders: 5, refund_count: refundCount,
      gross_sales: "72.88", refund_total: refundCount ? "72.88" : "0.00",
      net_sales: refundCount ? "0.00" : "72.88",
    };
    story.payment_mix = [
      { method: "cash", amount: "40.88", refunded_amount: "0.00", net_amount: "40.88", payment_count: 3, sales_share_pct: 56 },
      { method: "manual_card", amount: "32.00", refunded_amount: "0.00", net_amount: "32.00", payment_count: 2, sales_share_pct: 44 },
    ];
    await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: {
      authenticated: true, tenant_id: "tenant-1", tenant_name: "Mi negocio",
      user: { id: "user-1", email: "owner@example.com", tenant_id: "tenant-1", role: "owner" },
    } }));
    await page.route("**/api/v1/reports/business-story?*", (route) => route.fulfill({ json: story }));
    await page.route("**/api/v1/reports/sales-summary?*", (route) => route.fulfill({ json: {
      start_date: "2026-10-09", end_date: "2026-10-09", gross_sales: "50.00", refund_total: "0.00",
      net_sales: "50.00", order_count: 5, refund_count: 0, void_count: 0,
    } }));
    await page.route("**/api/v1/settings/business-profile", (route) => route.fulfill({ json: {
      tenant_id: "tenant-1", public_name: "Mi negocio", timezone: "America/Mexico_City", locale: "es-MX", currency: "MXN",
    } }));
    await page.goto("/dashboard");
    const card = page.locator("div.rounded-kova-lg").filter({ has: page.getByText("Lectura del periodo", { exact: true }) });
    await expect(card.getByText("44% no efectivo", { exact: true })).toBeVisible();
    await expect(card.getByText(refundCount ? "140 eventos por cada 100 órdenes" : "Saludable", { exact: true })).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(document.getAnimations().filter((animation) =>
        animation.playState === "running" && animation.effect?.getComputedTiming().endTime !== Infinity
      ).map((animation) => animation.finished.catch(() => undefined)));
    });
    await page.addScriptTag({ content: axe.source });
    const violations = await card.evaluate(async (element) => {
      const engine = (window as unknown as { axe: { run: (element: Element, options: object) => Promise<AxeResults> } }).axe;
      return (await engine.run(element, { runOnly: ["color-contrast"] })).violations;
    });
    expect(violations).toEqual([]);
  });
}
