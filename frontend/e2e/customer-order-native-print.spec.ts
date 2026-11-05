import { expect, test, type Page } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";

// Browser/print integration with explicit synthetic API responses. This suite
// exercises the actual checkout component, click callback, native window.print
// and installed beforeprint binder; it is not API/Postgres or hardware acceptance.
async function mockCheckout(page: Page, paperWidth: 58 | 80, itemCount: number) {
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: {
    authenticated: true, tenant_id: "tenant-print-qa", tenant_name: "Negocio QA impresión",
    user: { id: "owner-print-qa", email: "owner@example.invalid", tenant_id: "tenant-print-qa", role: "owner", email_verified: true },
    feature_flags: { customer_orders: true },
  } }));
  await page.route("**/api/v1/billing/subscription", route => route.fulfill({ json: {
    subscription: { status: "active" }, access: { allowed: true, reason: "active", trialing: false },
  } }));
  await page.route("**/api/v1/shifts/current", route => route.fulfill({ json: {
    id: "shift-print-qa", tenant_id: "tenant-print-qa", status: "open",
  } }));
  await page.route("**/api/v1/settings/receipt", route => route.fulfill({ json: {
    tenant_id: "tenant-print-qa", receipt_business_name: "Negocio QA impresión", paper_width_mm: paperWidth,
    footer: null, tax_contact_text: null, logo_url: null,
  } }));
  const items = Array.from({ length: itemCount }, (_, i) => ({
    id: `line-print-${i}`, product_id: `product-print-${i}`,
    product_name: `Producto ${i + 1} café con descripción larga de impresión QA`,
    quantity: 1, unit_price_amount: "25.00", line_total_amount: "25.00", modifiers: [], modifier_option_ids: [], note: null,
  }));
  const total = (itemCount * 25).toFixed(2);
  const order = {
    id: "customer-print-qa", tenant_id: "tenant-print-qa", folio: "PED-PRINTQA", status: "confirmed",
    payment_status: "unpaid", fulfillment_type: "pickup", source_channel: "counter", customer_name: "Cliente QA",
    customer_phone: null, delivery_address: null, delivery_reference: null, promised_at: null, note: null,
    subtotal_amount: total, total_amount: total, sale_order_id: null, version: 2, stock_conflict: false, items,
    confirmed_at: "2026-11-04T12:00:00Z", ready_at: null, fulfilled_at: null, cancelled_at: null,
    cancellation_reason: null, cancellation_note: null,
    created_at: "2026-11-04T12:00:00Z", updated_at: "2026-11-04T12:00:00Z",
  };
  const payments = [{ method: "cash", amount_amount: total, amount_tendered_amount: total, change_due_amount: "0.00" }];
  const sale = { id: "sale-print-qa", tenant_id: order.tenant_id, status: "completed", items, payments, subtotal_amount: total, total_amount: total };
  let checkoutCalls = 0;
  await page.route("**/api/v1/customer-orders/customer-print-qa", route => route.fulfill({ json: order }));
  await page.route("**/api/v1/customer-orders/customer-print-qa/checkout", route => {
    checkoutCalls += 1;
    return route.fulfill({ status: 201, json: {
      customer_order: { ...order, payment_status: "paid", sale_order_id: sale.id, version: 3 }, sale_order: sale,
    } });
  });
  await page.route("**/api/v1/orders/sale-print-qa/receipt", route => route.fulfill({ json: {
    ...sale, order_id: sale.id, receipt_number: "QA-PRINT-123", tenant_name: "Negocio QA impresión",
    created_at: order.created_at, paper_width_mm: paperWidth, total_tendered: total, total_change: "0.00",
    refunds: [], void: null, discount_amount: "0.00", tax_rate: "0.00", tax_amount: "0.00",
  } }));
  return { total, lastProduct: items.at(-1)!.product_name, checkoutCalls: () => checkoutCalls };
}

type PrintSnapshot = { documents: number; text: string; bodyPrepared: boolean; rootWidth: string | null; pageRule: string };
type PrintProbe = { nativeCalls: number; before: PrintSnapshot[]; after: number };

for (const paperWidth of [58, 80] as const) {
  for (const itemCount of [2, 60]) {
    test(`pedido: botón nativo imprime contenido y papel ${paperWidth}mm con ${itemCount} líneas`, async ({ page }, testInfo) => {
      const fixture = await mockCheckout(page, paperWidth, itemCount);
      await page.goto("/register?customerOrderId=customer-print-qa");
      await expect(page.getByRole("heading", { name: /Caja.*PED-PRINTQA/ })).toBeVisible();
      await page.getByLabel("Efectivo recibido", { exact: true }).fill(fixture.total);
      await page.getByRole("button", { name: /^Cobrar / }).click();
      await expect(page.getByRole("heading", { name: "Pedido cobrado", exact: true })).toBeVisible();
      const print = page.getByRole("button", { name: "Imprimir recibo", exact: true });
      await expect(print).toBeVisible();
      await expect(page.getByText(`1 x ${fixture.lastProduct}`, { exact: true })).toBeVisible();

      await page.evaluate(() => {
        const target = window as Window & { qaPrintProbe?: PrintProbe };
        const probe: PrintProbe = { nativeCalls: 0, before: [], after: 0 };
        target.qaPrintProbe = probe;
        // Observe the real native call, without replacing it with synthetic
        // dispatchEvent or invoking prepareThermalPrint directly from the test.
        const nativePrint = window.print.bind(window);
        window.print = () => { probe.nativeCalls += 1; nativePrint(); };
        window.addEventListener("beforeprint", () => {
          const documents = [...document.querySelectorAll<HTMLElement>(".thermal-print-document")];
          probe.before.push({
            documents: documents.length,
            text: documents.map(node => node.innerText).join("\n"),
            bodyPrepared: document.body.hasAttribute("data-thermal-printing"),
            rootWidth: document.querySelector<HTMLElement>(".print-receipt-root")?.dataset.paperWidth ?? null,
            pageRule: [...document.querySelectorAll("style")].map(node => node.textContent).join("\n"),
          });
        });
        window.addEventListener("afterprint", () => { probe.after += 1; });
      });

      await print.click();
      await expect.poll(() => page.evaluate(() => (window as Window & { qaPrintProbe?: PrintProbe }).qaPrintProbe!.nativeCalls)).toBe(1);
      await expect.poll(() => page.evaluate(() => (window as Window & { qaPrintProbe?: PrintProbe }).qaPrintProbe!.before.length)).toBeGreaterThan(0);
      const probe = await page.evaluate(() => (window as Window & { qaPrintProbe?: PrintProbe }).qaPrintProbe!);
      await testInfo.attach("native-beforeprint-probe", { body: JSON.stringify(probe, null, 2), contentType: "application/json" });
      const snapshot = probe.before[0];
      expect.soft(snapshot.documents, "Actual print callback must prepare exactly one thermal document").toBe(1);
      expect.soft(snapshot.bodyPrepared).toBe(true);
      expect.soft(snapshot.rootWidth).toBe(String(paperWidth));
      expect.soft(snapshot.text).toContain("Negocio QA impresión");
      expect.soft(snapshot.text).toContain("QA-PRINT-123");
      expect.soft(snapshot.text).toContain(fixture.lastProduct);
      expect.soft(snapshot.text).toContain("Total");
      expect.soft(snapshot.pageRule).toContain(`size: ${paperWidth}mm`);

      // CDP PDF is supplemental output evidence after the actual button event,
      // never a substitute for exercising window.print and beforeprint above.
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      await testInfo.attach(`pedido-print-${paperWidth}mm-${itemCount}.pdf`, { body: pdf, contentType: "application/pdf" });
      const boxes = [...pdf.toString("latin1").matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
      expect(boxes.length).toBeGreaterThan(0);
      for (const box of boxes) expect.soft(Number(box[1]) * 25.4 / 72).toBeCloseTo(paperWidth, 0);
      await expect(page.locator(".thermal-print-document")).toHaveCount(0);
      expect(fixture.checkoutCalls(), "Printing and reprinting never submit another checkout").toBe(1);
    });
  }
}
