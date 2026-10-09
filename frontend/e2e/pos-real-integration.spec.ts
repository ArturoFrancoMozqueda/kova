import { expect, test } from "./fixtures";
import { createTenantThroughUi, integrationEnabled } from "./integration-helpers";
import { markFirstUseToursSeen } from "./helpers";

test.describe("caja efímera con API, Postgres y RLS reales", () => {
  test.skip(!integrationEnabled(), "Requiere el stack efímero de integración");

  test("Enter al editar no registra venta; Enter en Cobrar persiste una sola venta", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await createTenantThroughUi(page, "pos-keyboard");
    const session = await (await page.request.get("/api/v1/auth/session")).json();
    await markFirstUseToursSeen(page, session.tenant_id);
    const product = await page.evaluate(async () => {
      const csrf = document.cookie.split("; ").find(item => item.startsWith("csrf_token="))
        ?.slice("csrf_token=".length);
      if (!csrf) throw new Error("Se requiere la sesión CSRF real de integración");
      const post = async (url: string, body: object) => {
        const response = await fetch(url, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf),
            "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`Preparación real ${url}: ${response.status}`);
        return response.json();
      };
      const created = await post("/api/v1/catalog/products", {
        name: "Producto teclado real", price_amount: "37.50", track_inventory: true,
      });
      await post(`/api/v1/inventory/products/${created.id}/adjustments`, {
        quantity_delta: 5, reason: "Stock efímero de prueba",
      });
      return created as { id: string; name: string };
    });
    await page.goto("/shifts");
    await page.getByRole("button", { name: /^abrir turno$/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/efectivo inicial/i).fill("100.00");
    await dialog.getByRole("button", { name: /^abrir turno$/i }).click();
    await expect(dialog).toBeHidden();
    await page.goto("/register");
    await page.getByRole("button", { name: `Agregar ${product.name}` }).click();
    await page.getByLabel(/efectivo recibido/i).fill("40.00");
    await page.getByText("Cliente, descuento e impuesto", { exact: true }).click();
    await page.getByLabel("Descuento de la venta (MXN)", { exact: true }).press("Enter");
    const collect = page.getByRole("button", { name: /^cobrar$/i });
    await expect(collect).toBeEnabled();
    expect((await (await page.request.get("/api/v1/orders")).json()).total).toBe(0);
    const beforeStock = await (await page.request.get("/api/v1/inventory/stock")).json();
    expect(beforeStock.find((item: { product_id: string }) => item.product_id === product.id)
      .stock_on_hand).toBe(5);
    await collect.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: /venta completada\.?/i }))
      .toHaveText(/venta completada\.?/i);
    await page.reload();
    const orders = await (await page.request.get("/api/v1/orders")).json();
    expect(orders.total).toBe(1);
    expect(orders.items[0].total_amount).toBe("37.50");
    const detail = await (await page.request.get(`/api/v1/orders/${orders.items[0].id}`)).json();
    expect(detail.payments[0].change_due_amount).toBe("2.50");
    const stock = await (await page.request.get("/api/v1/inventory/stock")).json();
    expect(stock.find((item: { product_id: string }) => item.product_id === product.id)
      .stock_on_hand).toBe(4);
  });
});
