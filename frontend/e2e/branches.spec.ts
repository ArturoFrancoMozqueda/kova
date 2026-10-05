import { expect, test } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";

const principal = "10000000-0000-4000-8000-000000000001";
const centro = "20000000-0000-4000-8000-000000000001";

test("owner creates a branch, confirms switching and compares sales and products", async ({ page }) => {
  await markFirstUseToursSeen(page, principal);
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: {
    authenticated: true, tenant_id: principal, tenant_name: "Negocio",
    user: { id: "owner", email: "owner@example.com", tenant_id: principal, role: "owner", is_email_verified: true },
  } }));
  await page.route("**/api/v1/billing/subscription", route => route.fulfill({ json: {
    plan: { name: "Standard", amount_minor_units: 29900, currency: "MXN", interval: "month" },
    subscription: null, access: { allowed: true, reason: "active", trialing: false, trial_ends_at: null, blocked_at: null },
  } }));
  await page.route("**/api/v1/account/deletion**", route => route.fulfill({ json: { status: "none" } }));
  await page.route("**/api/v1/employees", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/employees/invitations", route => route.fulfill({ json: [] }));
  let branches = [{ id: principal, name: "Sucursal principal", address: null, created_at: "2026-10-04T00:00:00Z" }];
  await page.route("**/api/v1/branches", async route => {
    if (route.request().method() === "POST") {
      expect(route.request().headers()["idempotency-key"]).toBeTruthy();
      expect(route.request().headers()["x-kova-branch"]).toBe(principal);
      const body = route.request().postDataJSON();
      expect(body.name).toBe("Centro");
      const branch = { ...branches[0], id: centro, name: body.name };
      branches = [...branches, branch];
      await route.fulfill({ status: 201, json: branch });
    } else {
      await route.fulfill({ json: branches });
    }
  });
  await page.route("**/api/v1/reports/branches?*", async route => {
    expect(route.request().headers()["x-kova-branch"]).toBe(centro);
    const query = new URL(route.request().url()).searchParams;
    const entry = (id: string, name: string, amount: string, qty: number) => ({
      branch_id: id, branch_name: name, completed_orders: 1, gross_sales: amount,
      refunded_amount: "0.00", net_sales: amount, average_ticket: amount, share_pct: id === centro ? "66.67" : "33.33",
      products: [{ product_id: "pan", product_name: "Pan artesanal", net_quantity: qty, net_sales: amount }],
    });
    await route.fulfill({ json: {
      start_date: query.get("start_date"), end_date: query.get("end_date"), timezone: "America/Mexico_City",
      total_net_sales: "180.00", leader_branch_ids: [centro],
      branches: [entry(centro, "Centro", "120.00", 4), entry(principal, "Sucursal principal", "60.00", 2)],
    } });
  });
  await page.goto("/settings/branches");
  await page.getByLabel("Nombre de la sucursal").fill("Centro");
  await page.getByRole("button", { name: "Crear sucursal", exact: true }).click();
  await expect(page.getByRole("button", { name: "Editar Centro", exact: true })).toBeVisible();
  await page.getByLabel("Sucursal activa").selectOption(centro);
  await expect(page.getByRole("dialog")).toContainText("sucursal de origen");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.getByLabel("Sucursal activa")).toHaveValue(principal);
  await page.getByLabel("Sucursal activa").selectOption(centro);
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Cambiar sucursal", exact: true }).click(),
  ]);
  await expect(page.getByLabel("Sucursal activa")).toHaveValue(centro);
  await page.goto("/reports");
  await expect(page.getByText("Centro tiene las mayores ventas netas.", { exact: true })).toBeVisible();
  await expect(page.getByText("Total del negocio: $180.00", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Resultados de Centro" })).toContainText("4 unidades netas");
  await expect(page.getByRole("region", { name: "Resultados de Sucursal principal" })).toContainText("2 unidades netas");
});
