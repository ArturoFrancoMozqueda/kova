import { expect, test } from "./fixtures";
import { createTenantThroughUi, integrationEnabled } from "./integration-helpers";
import { markFirstUseToursSeen } from "./helpers";

test.describe("centro de control con API y Postgres/RLS reales", () => {
  test.skip(!integrationEnabled(), "Requiere stack local desechable");
  test("consolida dos sucursales, filtra sin cambiar Caja y atribuye pendientes reales", async ({ page, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL!).hostname);
    const signupResponse = page.waitForResponse(response => response.url().endsWith("/api/v1/auth/signup") && response.request().method() === "POST");
    await createTenantThroughUi(page, "dashboard-real");
    const signup = await (await signupResponse).json();
    const session = await (await page.request.get("/api/v1/auth/session")).json();
    await markFirstUseToursSeen(page, session.tenant_id);
    const prepared = await page.evaluate(async ({ token, tenant }: { token: string; tenant: string }) => {
      const csrf = decodeURIComponent(document.cookie.split("; ").find(part => part.startsWith("csrf_token="))!.slice("csrf_token=".length));
      const post = async (path: string, body: unknown, branch = tenant, method = "POST") => {
        const response = await fetch(`/api/v1${path}`, { method, headers: {
          "Content-Type": "application/json", "X-CSRF-Token": csrf,
          "Idempotency-Key": crypto.randomUUID(), "X-Kova-Branch": branch,
        }, body: JSON.stringify(body) });
        if (!response.ok) throw new Error(`Preparación local ${path}: ${response.status}`);
        return response.json();
      };
      await post("/auth/verify", { token });
      const north = await post("/branches", { name: "Norte de control" });
      const product = await post("/catalog/products", { name: "Producto control real", price_amount: "100.00", cost_price: "40.00", track_inventory: true });
      await post(`/inventory/products/${product.id}/low-stock-threshold`, { low_stock_threshold: 2 }, tenant, "PATCH");
      const customer = await post("/customers", { name: "Cliente control real", phone: null, email: null, is_active: true });
      for (const [selected, quantity, units] of [[tenant, 1, 20], [north.id, 2, 3]] as const) {
        await post("/shifts", { opening_cash_amount: "100.00" }, selected);
        await post(`/inventory/products/${product.id}/adjustments`, { quantity_delta: units, reason: "Inventario local de prueba" }, selected);
        await post("/orders", { items: [{ product_id: product.id, quantity }], payments: [{ method: "cash", amount: `${quantity * 100}.00`, amount_tendered: `${quantity * 100}.00` }] }, selected);
      }
      await post("/service-cases", { customer_id: customer.id, title: "Revisar entrega en Norte", note: "Nota fuera del panel", due_at: "2020-01-01T12:00:00Z" }, north.id);
      await post("/customer-orders", { customer_id: customer.id, customer_name: customer.name, fulfillment_type: "pickup", source_channel: "counter", promised_at: "2020-01-01T12:00:00Z", items: [{ product_id: product.id, quantity: 1 }] }, north.id);
      return { north: north.id, tenant };
    }, { token: signup.dev_verification_token, tenant: session.tenant_id });
    await page.goto("/dashboard");
    await expect(page.getByLabel("Consultar", { exact: true })).toHaveValue("all");
    const results = page.getByRole("region", { name: "Tu día", exact: true });
    await expect(results.getByLabel("Ventas netas del periodo")).toHaveText("$300.00");
    const attention = page.getByRole("region", { name: "Necesita tu atención" });
    await expect(attention.getByRole("link", { name: /Casos de atención con plazo vencido/ })).toContainText("Norte de control");
    await expect(attention.getByRole("link", { name: /Pedidos con entrega vencida/ })).toContainText("Norte de control");
    await expect(page.getByText("Nota fuera del panel", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Sucursal activa", { exact: true })).toHaveValue(prepared.tenant);
    await page.getByLabel("Consultar", { exact: true }).selectOption(prepared.north);
    await expect(results.getByLabel("Ventas netas del periodo")).toHaveText("$200.00");
    await expect(page.getByLabel("Sucursal activa", { exact: true })).toHaveValue(prepared.tenant);
    const current = await (await page.request.get("/api/v1/reports/dashboard")).json();
    expect(current.story.summary.net_sales).toBe("100.00");
    const alert = attention.getByRole("link", { name: /Pedidos con entrega vencida/ });
    await alert.click();
    const dialog = page.getByRole("dialog", { name: "Abrir Norte de control" });
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(page.getByLabel("Sucursal activa", { exact: true })).toHaveValue(prepared.tenant);
    await alert.click();
    await dialog.getByRole("button", { name: "Cambiar sucursal y continuar", exact: true }).click();
    await expect(page).toHaveURL(/\/pedidos$/);
    await expect(page.getByLabel("Sucursal activa", { exact: true })).toHaveValue(prepared.north);
    await page.goto("/dashboard");
    await expect(results.getByLabel("Ventas netas del periodo")).toHaveText("$300.00");
    await page.screenshot({ path: testInfo.outputPath("control-center-real.png") });
  });
});
