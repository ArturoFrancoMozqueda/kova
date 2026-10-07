import { expect, test } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";
import {
  createTenantThroughUi,
  integrationEnabled,
  logoutThroughUi,
} from "./integration-helpers";

test.describe("stack efímero sin mocks", () => {
  test.skip(!integrationEnabled(), "Requiere docker-compose.test.yml");

  test("abrir turno y cobrar persiste la venta y descuenta inventario real", async ({ page }) => {
    await createTenantThroughUi(page, "real-sale");
    const session = await (await page.request.get("/api/v1/auth/session")).json();
    await markFirstUseToursSeen(page, session.tenant_id);

    // Prepare stock through real public endpoints. No route interception,
    // privileged DB connection, session fabrication or mocked responses.
    const product = await page.evaluate(async () => {
      const csrf = document.cookie.split("; ")
        .find((item) => item.startsWith("csrf_token="))?.slice("csrf_token=".length);
      if (!csrf) throw new Error("real browser CSRF cookie is required");
      const post = async (url: string, body: object) => {
        const response = await fetch(url, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf),
            "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`real setup ${url}: ${response.status}`);
        return response.json();
      };
      const created = await post("/api/v1/catalog/products", {
        name: "Producto venta real", price_amount: "37.50", track_inventory: true,
      });
      await post(`/api/v1/inventory/products/${created.id}/adjustments`, {
        quantity_delta: 5, reason: "CI opening stock",
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
    await page.getByRole("button", { name: /^cobrar$/i }).click();
    await expect(page.getByRole("status")).toHaveText(/venta completada\.?/i);
    const link = page.getByRole("link", { name: /abrir orden/i });
    await expect(link).toHaveAttribute("href", /^\/orders\/[0-9a-f-]+$/);
    const orderPath = await link.getAttribute("href");
    expect(orderPath).toBeTruthy();

    // Read back after reload: the result must survive beyond component state.
    await page.reload();
    const orderResponse = await page.request.get(`/api/v1${orderPath}`);
    expect(orderResponse.ok()).toBe(true);
    const order = await orderResponse.json();
    expect(order.total_amount).toBe("37.50");
    expect(order.status).toBe("completed");
    expect(order.payments[0].change_due_amount).toBe("2.50");
    const stockResponse = await page.request.get("/api/v1/inventory/stock");
    expect(stockResponse.ok()).toBe(true);
    const stock = await stockResponse.json();
    expect(stock.find((item: { product_id: string }) => item.product_id === product.id)
      .stock_on_hand).toBe(4);
  });

  test("frontend, API, Postgres y RLS aíslan dos tenants creados por la API pública", async ({
    page,
  }) => {
    const productName = `Producto aislado ${Date.now()}`;

    await createTenantThroughUi(page, "tenant-a");
    await page.goto("/catalog");
    await expect(page.getByRole("heading", { name: "Catálogo", exact: true, level: 1 })).toBeVisible();
    await page.getByRole("button", { name: /^nuevo producto$/i }).first().click();
    await page.getByLabel(/nombre del producto/i).fill(productName);
    await page.getByLabel(/^precio/i).fill("37.50");
    await page.getByRole("button", { name: /guardar producto/i }).click();
    await expect(page.getByText(productName, { exact: true })).toBeVisible();

    await logoutThroughUi(page);
    await createTenantThroughUi(page, "tenant-b");
    await page.goto("/catalog");
    await expect(page.getByRole("heading", { name: "Catálogo", exact: true, level: 1 })).toBeVisible();
    await expect(page.getByText(productName, { exact: true })).toHaveCount(0);
  });
});
