import { expect, test, type Page } from "./fixtures";
import axe from "axe-core";
const business = "Café del Patio · Pan, café y cocina de temporada";
const policy = { enabled: true, spend_amount: "100.00", points_per_step: 5 };
const reward = { id: "reward-1", version: 1, enabled: true, title: "Gracias por volver", points_cost: 20, discount_amount: "20.00" };
const card = { business_name: business, branch_name: "Centro Histórico", balance: 0, adjustments_pending: false, policy, reward, member_code: "KV-ABCD-EFGH-JKMP-QRST", expires_at: "2099-04-26T12:00:00Z", catalog_path: "/catalogo/membership-menu" };
async function accessible(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(async () => Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined))));
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => (await (window as unknown as { axe: typeof axe }).axe.run(document.body, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations);
  expect(violations).toEqual([]);
}
for (const width of [320, 390, 768, 1440]) {
  test(`menu creates a personal card without losing the order and keeps it after enrollment pauses at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    let enrolled = false; let available = true; const posts: { body: unknown; key?: string }[] = [];
    const mock = async (pattern: string, handler: Parameters<Page["route"]>[1]) => { await page.route(pattern, handler); await page.context().route(pattern, handler); };
    await mock("**/api/v1/auth/session", route => route.fulfill({ json: { authenticated: false } }));
    await mock("**/api/v1/public/catalog/membership-menu", route => route.fulfill({ json: { title: business, description: "Elige algo rico y conserva tus puntos para tu próxima visita.", whatsapp_phone: null, checkout_available: false, loyalty_available: available, products: [{ id: "bread", name: "Pan de nuez", description: null, price_amount: "45.00", availability: "available" }] } }));
    await mock("**/api/v1/public/loyalty/membership?menu=membership-menu", route => {
      expect(route.request().headers().referer).toBeUndefined();
      return route.fulfill({ json: { available, enrolled, business_name: business, branch_name: card.branch_name, policy, reward, csrf_token: "public-grant", card: enrolled ? card : null, card_path: "/lealtad?menu=membership-menu" } });
    });
    await mock("**/api/v1/public/loyalty/membership/enroll", route => {
      expect(route.request().headers()["x-kova-member-csrf"]).toBe("public-grant");
      expect(route.request().headers().referer).toBeUndefined();
      posts.push({ body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] }); enrolled = true;
      return route.fulfill({ status: 201, json: { card, card_path: "/lealtad?menu=membership-menu" } });
    });
    await page.goto("/catalogo/membership-menu");
    await page.getByRole("button", { name: "Agregar Pan de nuez al pedido" }).click();
    const entry = page.getByRole("button", { name: "Tu tarjeta de lealtad", exact: true });
    await entry.focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: `Tu tarjeta en ${business}` });
    await expect(dialog).toBeVisible(); await expect(dialog.getByRole("button", { name: "Crear mi tarjeta" })).toBeDisabled();
    await dialog.getByRole("textbox", { name: "¿Cómo te llamamos?" }).fill("Ana");
    await dialog.getByRole("checkbox", { name: "Quiero crear mi tarjeta personal en este dispositivo." }).check();
    await accessible(page);
    await dialog.getByRole("button", { name: "Crear mi tarjeta" }).click();
    const link = dialog.getByRole("link", { name: "Ver mi tarjeta (abre en otra pestaña)" });
    await expect(link).toHaveAttribute("target", "_blank");
    const popupReady = page.waitForEvent("popup"); await link.click(); const popup = await popupReady;
    await popup.setViewportSize({ width, height: 950 });
    await expect(popup.getByRole("textbox", { name: "Número de tarjeta" })).toHaveCount(0);
    await popup.getByText("Usar número de tarjeta", { exact: true }).click();
    await expect(popup.getByRole("textbox", { name: "Número de tarjeta" })).toHaveValue(card.member_code);
    expect(await popup.getByRole("textbox", { name: "Número de tarjeta" }).evaluate(input => input.scrollWidth <= input.clientWidth)).toBe(true);
    await popup.getByText("Usar número de tarjeta", { exact: true }).click();
    await expect(popup.getByLabel("Tus puntos")).toHaveText("0");
    await expect(popup.getByText("0 de 20 puntos")).toBeVisible();
    await expect(popup.getByText("Te faltan 20 puntos.")).toBeVisible();
    await expect(popup.getByText("Disponible para ti")).toHaveCount(0);
    await popup.evaluate(() => window.dispatchEvent(new CustomEvent("pos:pwa-update-available")));
    await expect(popup.getByRole("button", { name: "Actualizar ahora" })).toHaveCount(0);
    await accessible(popup); await popup.screenshot({ path: testInfo.outputPath(`membership-card-${width}.png`), fullPage: true });
    expect(posts).toEqual([{ body: { menu_token: "membership-menu", name: "Ana", confirmed: true }, key: expect.any(String) }]);
    await expect(page).toHaveURL(/\/catalogo\/membership-menu$/);
    await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Ver mi tarjeta", exact: true })).toBeFocused();
    if (width < 1024) await page.getByRole("button", { name: /Ver mi pedido/ }).click();
    await expect(page.getByRole("list", { name: "Productos de tu pedido" })).toContainText("Pan de nuez");
    await expect(page.getByRole("list", { name: "Productos de tu pedido" }).getByRole("group", { name: "Cantidad de Pan de nuez" })).toHaveText(/Cantidad: 1/);
    await expect(page.getByLabel("Tu nombre", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Enviar solicitud de pedido" })).toBeVisible();
    available = false; await page.goto("/catalogo/membership-menu");
    await expect(page.getByRole("button", { name: "Ver mi tarjeta", exact: true })).toBeVisible();
    expect(posts).toHaveLength(1); await popup.close();
  });
}
