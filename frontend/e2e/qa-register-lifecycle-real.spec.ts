import { expect, test, type Page } from "./fixtures";
import { createTenantThroughUi, integrationEnabled } from "./integration-helpers";
import { markFirstUseToursSeen } from "./helpers";
import type { Order, Receipt } from "../src/orders/types";
import type { CashMovement, Shift } from "../src/shifts/types";

type StockRow = {
  product_id: string;
  stock_on_hand: number;
  reserved_quantity: number;
  available_quantity: number;
};

async function read<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`/api/v1${path}`);
  expect(response.status(), `Lectura real ${path}`).toBe(200);
  return response.json() as Promise<T>;
}

function nextPost(page: Page, path: string) {
  return page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/v1${path}` &&
    response.request().method() === "POST"
  );
}

async function collectThroughUi(page: Page): Promise<Order> {
  const completed = nextPost(page, "/sync/offline-sales");
  const collect = page.getByRole("button", { name: "Cobrar", exact: true });
  await expect(collect).toBeEnabled();
  await expect(collect).toHaveAttribute("aria-disabled", "false");
  await collect.click();
  const response = await completed;
  expect(response.ok()).toBe(true);
  const result = await response.json() as {
    results: Array<{ status: string; order: Order }>;
  };
  expect(result.results).toHaveLength(1);
  expect(result.results[0].status).toBe("synced");
  const order = result.results[0].order;
  await expect(page.getByRole("link", { name: "Abrir orden", exact: true }))
    .toHaveAttribute("href", `/orders/${order.id}`);
  await page.getByRole("link", { name: "Abrir orden", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/orders/${order.id}$`));
  await expect(page.getByRole("heading", { name: /detalle de la venta/i })).toBeVisible();
  return order;
}

test.describe("QA: ciclo financiero de Caja con API, PostgreSQL y RLS reales", () => {
  test.skip(!integrationEnabled(), "Requiere KOVA_INTEGRATION=1 y el stack local desechable");

  for (const width of [390, 1440]) {
    test(`movimientos, pago dividido, devolución, anulación y corte cuadran a ${width}px`, async ({ page, baseURL }, testInfo) => {
      test.setTimeout(240_000);
      // Never run financial QA against a hosted business. Each case signs up
      // a fresh local tenant; there are no page.route() mocks or privileged DB
      // writes. API writes below prepare only the product and opening stock.
      expect(baseURL).toBeTruthy();
      expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL!).hostname);
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await createTenantThroughUi(page, `qa-register-lifecycle-${width}`);
      const session = await read<{ tenant_id: string }>(page, "/auth/session");
      await markFirstUseToursSeen(page, session.tenant_id);

      const product = await test.step("API setup: producto de $25 y diez unidades aisladas", async () => {
        return page.evaluate(async () => {
          const csrf = document.cookie.split("; ")
            .find((entry) => entry.startsWith("csrf_token="))?.slice("csrf_token=".length);
          if (!csrf) throw new Error("El setup local requiere la sesión CSRF real.");
          const post = async (path: string, body: object) => {
            const response = await fetch(`/api/v1${path}`, {
              method: "POST", credentials: "include",
              headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": decodeURIComponent(csrf),
                "Idempotency-Key": crypto.randomUUID(),
              },
              body: JSON.stringify(body),
            });
            if (!response.ok) throw new Error(`Setup local ${path}: ${response.status}`);
            return response.json();
          };
          const created = await post("/catalog/products", {
            name: "Producto QA corte real", price_amount: "25.00",
            cost_price: "10.00", track_inventory: true,
          });
          await post(`/inventory/products/${created.id}/adjustments`, {
            quantity_delta: 10, reason: "Existencias del tenant efímero de QA",
          });
          return { id: created.id as string, name: created.name as string };
        });
      });

      const assertStock = async (quantity: number) => {
        const stocks = await read<StockRow[]>(page, "/inventory/stock");
        expect(stocks.find((row) => row.product_id === product.id)).toMatchObject({
          stock_on_hand: quantity, reserved_quantity: 0, available_quantity: quantity,
        });
      };
      const assertCash = async (amount: string) => {
        expect(await read<Shift | null>(page, "/shifts/current"))
          .toMatchObject({ status: "open", expected_cash_amount: amount });
      };
      const prepareCart = async (quantity: number) => {
        await page.goto("/register");
        const add = page.getByRole("button", { name: `Agregar ${product.name}`, exact: true });
        await add.click();
        if (width < 1280 && quantity > 1) {
          // The first line deliberately opens the mobile sheet. Collapse it
          // as a cashier would before returning to the product catalog.
          await expect(page.getByRole("dialog", { name: "Resumen de venta", exact: true })).toBeVisible();
          await page.getByRole("button", { name: "Ocultar resumen de venta", exact: true }).click();
        }
        for (let unit = 1; unit < quantity; unit++) await add.click();
        if (width < 1280 && quantity > 1) {
          await page.getByRole("button", { name: "Mostrar resumen de venta", exact: true }).click();
        }
        if (width < 1280) await expect(page.getByRole("dialog", { name: "Resumen de venta", exact: true })).toBeVisible();
      };

      const shift = await test.step("UI: abrir turno con fondo de $100", async () => {
        expect(await read<Shift | null>(page, "/shifts/current")).toBeNull();
        await page.goto("/shifts");
        await page.getByRole("button", { name: "Abrir turno", exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Efectivo inicial (opcional)", { exact: true }).fill("100.00");
        const opened = nextPost(page, "/shifts");
        await dialog.getByRole("button", { name: "Abrir turno", exact: true }).click();
        expect((await opened).status()).toBe(201);
        await expect(dialog).toBeHidden();
        const current = await read<Shift>(page, "/shifts/current");
        expect(current).toMatchObject({ status: "open", opening_cash_amount: "100.00", expected_cash_amount: "100.00" });
        await assertStock(10);
        return current;
      });

      await test.step("UI: entrada de $50 y salida de $20 dejan $130", async () => {
        for (const movement of [
          { type: "cash_in", amount: "50.00", reason: "Entrada QA para comprobar el corte" },
          { type: "cash_out", amount: "20.00", reason: "Salida QA para comprobar el corte" },
        ]) {
          await page.getByRole("button", { name: "Registrar movimiento", exact: true }).click();
          const dialog = page.getByRole("dialog");
          await dialog.getByLabel("Tipo", { exact: true }).selectOption(movement.type);
          await dialog.getByLabel("Monto", { exact: true }).fill(movement.amount);
          await dialog.getByLabel("Motivo", { exact: true }).fill(movement.reason);
          const recorded = nextPost(page, `/shifts/${shift.id}/cash-movements`);
          await dialog.getByRole("button", { name: "Registrar", exact: true }).click();
          const response = await recorded;
          expect(response.status()).toBe(201);
          expect(await response.json()).toMatchObject(movement);
          await expect(dialog).toBeHidden();
          await expect(page.getByText(movement.reason, { exact: true })).toBeVisible();
        }
        await assertCash("130.00");
      });

      const splitOrder = await test.step("UI: venta de $75, efectivo $50 y transferencia $25", async () => {
        await prepareCart(3);
        await page.getByRole("checkbox", { name: /Pago dividido/ }).check();
        await page.getByLabel("Monto", { exact: true }).fill("50.00");
        await page.getByLabel("Efectivo recibido", { exact: true }).fill("60.00");
        await page.getByRole("button", { name: "Agregar pago", exact: true }).click();
        await expect(page.getByLabel("Monto", { exact: true })).toHaveCount(2);
        await page.getByLabel("Monto", { exact: true }).nth(1).fill("25.00");
        // Keep the financial oracle independent of the separate accessible-
        // name regression below; these are the real rendered method controls.
        const methods = page.locator("select").filter({ has: page.locator('option[value="manual_card"]') });
        await expect(methods).toHaveCount(2);
        await expect(methods.nth(0)).toHaveValue("cash");
        await expect(methods.nth(1)).toHaveValue("bank_transfer");
        await page.getByLabel("Referencia", { exact: true }).fill("QA-TRANSFERENCIA-LOCAL");
        const order = await collectThroughUi(page);
        expect(order).toMatchObject({ status: "completed", subtotal_amount: "75.00", total_amount: "75.00" });
        expect(order.items).toMatchObject([{ product_id: product.id, quantity: 3, unit_price_amount: "25.00" }]);
        expect(order.payments).toEqual(expect.arrayContaining([
          expect.objectContaining({ method: "cash", amount_amount: "50.00", amount_tendered_amount: "60.00", change_due_amount: "10.00" }),
          expect.objectContaining({ method: "bank_transfer", amount_amount: "25.00", change_due_amount: "0.00", reference: "QA-TRANSFERENCIA-LOCAL" }),
        ]));
        expect(order.payments).toHaveLength(2);
        const persisted = await read<Order>(page, `/orders/${order.id}`);
        expect(persisted.payments).toEqual(order.payments);
        const receipt = await read<Receipt>(page, `/orders/${order.id}/receipt`);
        expect(receipt).toMatchObject({ total_amount: "75.00", total_tendered: "60.00", total_change: "10.00" });
        await assertStock(7);
        // Neither the $25 transfer nor the $10 change is new cash revenue.
        await assertCash("180.00");
        return order;
      });

      await test.step("UI: devolver una unidad en efectivo deja stock ocho y caja $155", async () => {
        await page.getByRole("button", { name: "Devolver", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Devolver productos", exact: true });
        await dialog.getByLabel("Dinero devuelto por", { exact: true }).selectOption("cash");
        await dialog.getByLabel(`${product.name} Cantidad`, { exact: true }).fill("1");
        const refunded = nextPost(page, `/orders/${splitOrder.id}/refunds`);
        await dialog.getByRole("button", { name: "Registrar devolución", exact: true }).click();
        const response = await refunded;
        expect(response.status()).toBe(201);
        expect(await response.json()).toMatchObject({ refunded_amount: "25.00", items: [{ quantity: 1 }] });
        await expect(dialog).toBeHidden();
        await expect(page.getByText("Devuelta parcial", { exact: true })).toBeVisible();
        const refunds = await read<Array<{ refunded_amount: string }>>(page, `/orders/${splitOrder.id}/refunds`);
        expect(refunds).toHaveLength(1);
        expect(refunds[0].refunded_amount).toBe("25.00");
        await assertStock(8);
        await assertCash("155.00");
      });

      const voidedOrder = await test.step("UI: segunda venta de $50 y anulación restituyen stock/caja", async () => {
        await prepareCart(2);
        await page.getByRole("radio", { name: "Efectivo", exact: true }).click();
        await page.getByLabel("Efectivo recibido", { exact: true }).fill("60.00");
        const order = await collectThroughUi(page);
        expect(order).toMatchObject({ total_amount: "50.00", payments: [{ method: "cash", amount_amount: "50.00", change_due_amount: "10.00" }] });
        await assertStock(6);
        await assertCash("205.00");
        await page.getByRole("button", { name: "Cancelar", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Cancelar orden", exact: true });
        await dialog.getByLabel("Motivo", { exact: true }).selectOption("operator_error");
        await dialog.getByRole("checkbox", { name: "Entiendo que esto revierte el inventario de la orden.", exact: true }).check();
        const voided = nextPost(page, `/orders/${order.id}/void`);
        await dialog.getByRole("button", { name: "Cancelar orden", exact: true }).click();
        expect((await voided).status()).toBe(201);
        await expect(dialog).toBeHidden();
        expect(await read<Order>(page, `/orders/${order.id}`)).toMatchObject({ status: "voided", total_amount: "50.00" });
        expect(await read<Receipt>(page, `/orders/${order.id}/receipt`)).toMatchObject({ status: "voided", void: { reason: "operator_error" } });
        await assertStock(8);
        await assertCash("155.00");
        return order;
      });

      await test.step("API reads: dos ventas y un solo reembolso con ledger de efectivo exacto", async () => {
        const orders = await read<{ total: number; items: Array<{ id: string; status: string }> }>(page, "/orders");
        expect(orders.total).toBe(2);
        expect(orders.items).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: splitOrder.id, status: "completed" }),
          expect.objectContaining({ id: voidedOrder.id, status: "voided" }),
        ]));
        const movements = await read<CashMovement[]>(page, `/shifts/${shift.id}/cash-movements`);
        expect(movements).toHaveLength(4);
        expect(movements).toEqual(expect.arrayContaining([
          expect.objectContaining({ type: "opening_balance", amount: "100.00" }),
          expect.objectContaining({ type: "cash_in", amount: "50.00" }),
          expect.objectContaining({ type: "cash_out", amount: "20.00" }),
          expect.objectContaining({ type: "refund_payout", amount: "25.00" }),
        ]));
      });

      await test.step("UI: cerrar contando $155 y revisar corte sin diferencia", async () => {
        await page.goto("/shifts");
        await page.getByRole("button", { name: "Cerrar turno", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Cerrar turno", exact: true });
        await dialog.getByLabel("Efectivo real en caja", { exact: true }).fill("155.00");
        // Blind count: expected cash is revealed on the review step.
        await dialog.getByRole("button", { name: "Revisar corte", exact: true }).click();
        const closed = nextPost(page, `/shifts/${shift.id}/close`);
        await dialog.getByRole("button", { name: "Cerrar turno", exact: true }).click();
        const response = await closed;
        expect(response.status()).toBe(201);
        expect(await response.json()).toMatchObject({
          id: shift.id, status: "closed", expected_cash_amount: "155.00",
          actual_cash_amount: "155.00", reconciliation_status: "balanced", variance_amount: "0.00",
        });
        await expect(dialog).toBeHidden();
        expect(await read<Shift | null>(page, "/shifts/current")).toBeNull();
        expect(await read<Shift>(page, `/shifts/${shift.id}`)).toMatchObject({
          status: "closed", expected_cash_amount: "155.00", actual_cash_amount: "155.00",
          reconciliation_status: "balanced", variance_amount: "0.00",
        });
        await page.reload();
        await page.getByRole("button", { name: "Ver corte", exact: true }).click();
        const corte = page.getByRole("dialog", { name: "Ver corte", exact: true });
        await expect(corte).toContainText("Caja cuadrada");
        for (const [label, amount] of [
          ["Fondo de apertura", "$100.00"], ["Ventas en efectivo", "$50.00"],
          ["Entradas de efectivo", "+$50.00"], ["Salidas de efectivo", "-$20.00"],
          ["Reembolsos en efectivo", "-$25.00"], ["Efectivo esperado", "$155.00"],
          ["Efectivo contado", "$155.00"], ["Diferencia", "$0.00"],
        ]) {
          await expect(corte.getByText(label, { exact: true }).locator("..")).toContainText(amount);
        }
        await corte.screenshot({ path: testInfo.outputPath(`register-corte-real-${width}.png`), animations: "disabled" });
        await assertStock(8);
      });

      await testInfo.attach("qa-register-lifecycle-coverage", {
        contentType: "application/json",
        body: JSON.stringify({
          viewport_width: width,
          ui_actions: ["signup", "open shift", "cash in", "cash out", "split sale", "cash refund", "cash sale", "void", "close shift", "view corte"],
          api_setup: ["create isolated product", "stock adjustment +10"],
          api_assertions: ["orders/payments/receipts", "stock", "cash movements", "current/closed shift"],
          final_expected_cash: "155.00", final_counted_cash: "155.00", variance: "0.00", final_stock: 8,
        }, null, 2),
      });
    });
  }

  test("accesibilidad: cada método del pago dividido tiene un nombre identificable", async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    expect(baseURL).toBeTruthy();
    expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL!).hostname);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await createTenantThroughUi(page, "qa-split-accessibility");
    const session = await read<{ tenant_id: string }>(page, "/auth/session");
    await markFirstUseToursSeen(page, session.tenant_id);

    // Master data only. Opening the shift and showing both payment controls
    // remain UI actions, and this test never submits a financial transaction.
    const productName = await page.evaluate(async () => {
      const csrf = document.cookie.split("; ")
        .find((entry) => entry.startsWith("csrf_token="))?.slice("csrf_token=".length);
      if (!csrf) throw new Error("El setup local requiere la sesión CSRF real.");
      const response = await fetch("/api/v1/catalog/products", {
        method: "POST", credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": decodeURIComponent(csrf),
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ name: "Producto QA accesibilidad de pagos", price_amount: "25.00", track_inventory: false }),
      });
      if (!response.ok) throw new Error(`Setup local de catálogo: ${response.status}`);
      return (await response.json()).name as string;
    });
    await page.goto("/shifts");
    await page.getByRole("button", { name: "Abrir turno", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Abrir turno", exact: true });
    await dialog.getByLabel("Efectivo inicial (opcional)", { exact: true }).fill("0.00");
    await dialog.getByRole("button", { name: "Abrir turno", exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.goto("/register");
    await page.getByRole("button", { name: `Agregar ${productName}`, exact: true }).click();
    await page.getByRole("checkbox", { name: /Pago dividido/ }).check();
    await page.getByRole("button", { name: "Agregar pago", exact: true }).click();
    const methods = page.locator("select").filter({ has: page.locator('option[value="manual_card"]') });
    await expect(methods).toHaveCount(2);
    // Unnamed selects failed on the published baseline. Preserve this oracle
    // so a screen-reader user can distinguish the numbered method controls.
    await expect.soft(methods.nth(0)).toHaveAccessibleName("Método de pago 1");
    await expect.soft(methods.nth(1)).toHaveAccessibleName("Método de pago 2");
    expect((await read<{ total: number }>(page, "/orders")).total).toBe(0);
  });
});
