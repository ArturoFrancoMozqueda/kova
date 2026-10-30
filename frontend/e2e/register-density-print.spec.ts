import { expect, test, type Page } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";
import { fileURLToPath } from "node:url";

async function authenticate(page: Page) {
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: {
    authenticated: true, tenant_id: "tenant-1", tenant_name: "Negocio de prueba",
    user: { id: "user-1", email: "owner@example.com", tenant_id: "tenant-1", role: "owner", email_verified: true },
  } }));
}

for (const width of [390, 768, 998, 1440]) {
  test(`register shows usable product rows with bounded photos at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await authenticate(page);
    await page.route("**/api/v1/catalog/products", route => route.fulfill({ json:
      Array.from({ length: 18 }, (_, i) => ({
        id: `product-${i}`, tenant_id: "tenant-1", name: `Producto ${i + 1}`,
        price_amount: "32.00", is_active: true, track_inventory: false,
        modifier_groups: [], category_id: null, image_url: `/api/v1/catalog/products/product-${i}/image?v=1`,
      })),
    }));
    await page.route("**/api/v1/catalog/categories", route => route.fulfill({ json: [] }));
    await page.route("**/api/v1/catalog/products/*/image?**", route => route.fulfill({
      path: fileURLToPath(new URL("../public/showcase/products/alfajores.png", import.meta.url)),
      contentType: "image/png",
    }));
    await page.route("**/api/v1/shifts/current", route => route.fulfill({ json: null }));
    await page.goto("/register");
    const products = page.getByRole("button", { name: /^Agregar Producto / });
    await expect(products).toHaveCount(18);
    const first = await products.nth(0).boundingBox();
    const nextRow = await products.nth(width < 640 ? 2 : width < 768 ? 3 : width < 1280 ? 4 : 3).boundingBox();
    expect(first!.height).toBeLessThanOrEqual(180);
    expect(nextRow!.y).toBeGreaterThan(first!.y);
    expect(nextRow!.y + nextRow!.height).toBeLessThan(730);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(products.nth(0).locator("img")).toHaveCSS("opacity", "1");
    expect((await products.nth(0).locator("img").boundingBox())!.height).toBeLessThanOrEqual(80);
    const expand = page.getByRole("button", { name: "Mostrar resumen de venta" });
    if (width < 1280) {
      await expect(expand).toBeInViewport();
    }
    await products.nth(0).click();
    await expect(page.locator(".kv-cart-sheet")).toContainText("Producto 1");
    if (width < 1280) {
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: "Ocultar resumen de venta" }).click();
      await expect(expand).toHaveAttribute("aria-expanded", "false");
      await expect(expand).toBeInViewport();
    }
    await testInfo.attach(`caja-${width}px`, { body: await page.screenshot(), contentType: "image/png" });
  });
}

for (const paperWidth of [58, 80]) {
  for (const itemCount of [2, 60]) {
    test(`receipt PDF uses ${paperWidth}mm paper and preserves ${itemCount} lines`, async ({ page }, testInfo) => {
      await authenticate(page);
      const items = Array.from({ length: itemCount }, (_, i) => ({
        id: `item-${i}`, product_id: `product-${i}`,
        product_name: `Producto ${i + 1} con descripción suficientemente larga para ocupar varias líneas`,
        quantity: 2, unit_price_amount: "32.00", line_total_amount: "64.00", modifiers: [],
      }));
      const total = (itemCount * 64).toFixed(2);
      const order = {
        id: "order-print", tenant_id: "tenant-1", status: "completed",
        subtotal_amount: total, total_amount: total, items, payments: [],
      };
      const receipt = {
        ...order, order_id: order.id, receipt_number: "QA-123", tenant_name: "Negocio de prueba",
        created_at: "2026-10-30T12:00:00Z", paper_width_mm: paperWidth,
        total_tendered: "0.00", total_change: "0.00", refunds: [], void: null,
      };
      await page.route("**/api/v1/orders/order-print", route => route.fulfill({ json: order }));
      await page.route("**/api/v1/orders/order-print/receipt", route => route.fulfill({ json: receipt }));
      await page.goto("/orders/order-print");
      await expect(page.locator(".print-receipt-root")).toContainText(`Producto ${itemCount} con descripción`);
      await page.evaluate(() => window.addEventListener("beforeprint", () => {
        (window as Window & { thermalMinWidth?: string }).thermalMinWidth = getComputedStyle(document.body).minWidth;
      }));
      // Read print-only CSS after switching media; beforeprint may fire while
      // the browser is still using screen styles in its normal dialog flow.
      await page.emulateMedia({ media: "print" });
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      expect(await page.evaluate(() => (window as Window & { thermalMinWidth?: string }).thermalMinWidth)).toBe("0px");
      const boxes = [...pdf.toString("latin1").matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
      expect(boxes.length).toBeGreaterThan(0);
      for (const box of boxes) {
        expect(Number(box[1]) * 25.4 / 72).toBeCloseTo(paperWidth, 0);
        const height = Number(box[2]) * 25.4 / 72;
        expect(height).toBeGreaterThan(itemCount === 2 ? 40 : 200);
        expect(height).toBeLessThan(2000);
      }
      // Hidden app layout must not generate blank pages after the receipt.
      expect((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(1);
      await testInfo.attach(`ticket-${paperWidth}mm-${itemCount}-items`, { body: pdf, contentType: "application/pdf" });
      expect(await page.locator(".thermal-print-document").count()).toBe(0);
      await page.emulateMedia({ media: null });
      await expect(page.getByRole("button", { name: /imprimir/i })).toBeVisible();
      // Also exercise the normal dialog sequence, where beforeprint can run
      // before print media is applied. Screen layout must not shrink the paper.
      const dialogPdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      const dialogBox = dialogPdf.toString("latin1").match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
      expect(dialogBox).not.toBeNull();
      expect(Number(dialogBox![1]) * 25.4 / 72).toBeCloseTo(paperWidth, 0);
      expect(Math.abs(Number(dialogBox![2]) - Number(boxes[0][2])) * 25.4 / 72).toBeLessThan(2);
    });
  }
}
