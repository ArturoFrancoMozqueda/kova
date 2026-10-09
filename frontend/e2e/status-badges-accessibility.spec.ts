import axe, { type AxeResults } from "axe-core";
import { expect, test } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";

test.use({ viewport: { width: 390, height: 844 } });

test("paid and fulfilled order badges remain readable on mobile", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: {
    authenticated: true,
    user: { id: "user-1", email: "owner@example.com", tenant_id: "tenant-1", role: "owner" },
    tenant_id: "tenant-1", tenant_name: "Prueba de accesibilidad",
    feature_flags: { margin_reports: false, customer_orders: true },
  } }));
  await page.route("**/api/v1/billing/subscription", route => route.fulfill({ json: {
    subscription: { status: "active" },
    access: { allowed: true, reason: "active", trialing: false },
  } }));
  await page.route("**/api/v1/customer-orders?**", route => route.fulfill({ json: {
    items: [{ id: "order-contrast", folio: "PED-CONTRASTE", status: "fulfilled",
      payment_status: "paid", fulfillment_type: "pickup", customer_name: "Ana",
      customer_phone: null, total_amount: "50.00", promised_at: null, stock_conflict: false }],
    total: 1, limit: 25, offset: 0,
    status_counts: { new: 0, confirmed: 0, in_progress: 0, ready: 0, fulfilled: 1, cancelled: 0 },
  } }));
  await page.goto("/pedidos");
  await expect(page.getByText("PED-CONTRASTE")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const engine = (window as unknown as { axe: { run: (context: string, options: object) => Promise<AxeResults> } }).axe;
    const result = await engine.run("main", { runOnly: { type: "rule", values: ["color-contrast"] } });
    return result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }));
  });
  expect(violations).toEqual([]);
});
