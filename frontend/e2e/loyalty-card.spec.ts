import { expect, test, type Page } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";
import axe from "axe-core";

const card = {
  business_name: "Café de la Esquina · Panadería y especialidades del barrio",
  branch_name: "Sucursal Centro Histórico", balance: 35, adjustments_pending: false,
  policy: { enabled: true, spend_amount: "100.00", points_per_step: 5 },
  expires_at: "2099-11-26T12:00:00Z", catalog_path: "/catalogo/cafe-de-la-esquina",
};

async function checkAccessibility(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const engine = (window as unknown as { axe: typeof axe }).axe;
    return (await engine.run("main", { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations;
  });
  expect(violations).toEqual([]);
}

for (const width of [320, 390, 768, 1440]) {
  test(`public loyalty card shows real balance, pending reversals and keyboard access at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/v1/auth/session", route => route.fulfill({ json: { authenticated: false } }));
    const reads: { referrer: string | undefined; cookie: string | undefined }[] = [];
    let refreshed = false;
    await page.route("**/api/v1/public/loyalty/cards", route => {
      expect(route.request().postDataJSON()).toEqual({ token: "card-browser-test" });
      const headers = route.request().headers();
      reads.push({ referrer: headers.referer, cookie: headers.cookie });
      return route.fulfill({ json: !refreshed ? card : { ...card, balance: width === 320 ? 0 : -5, adjustments_pending: true } });
    });
    await page.goto("/lealtad#card-browser-test");
    await expect(page.getByRole("heading", { name: card.business_name })).toBeVisible();
    await expect(page.getByRole("heading", { name: card.business_name })).toHaveAttribute("title", card.business_name);
    await expect(page.getByLabel("Tus puntos")).toHaveText("35");
    const walletCard = page.getByRole("region", { name: "Tu saldo de lealtad" });
    const walletBox = await walletCard.boundingBox();
    expect(walletBox!.width / walletBox!.height).toBeGreaterThan(1.5);
    expect(walletBox!.width / walletBox!.height).toBeLessThan(1.65);
    const menuButton = page.getByRole("link", { name: "Ver menú del negocio" });
    const menuBox = await menuButton.boundingBox();
    expect(menuBox!.y + menuBox!.height).toBeLessThan(600);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("pos:pwa-update-available")));
    await expect(page.getByRole("button", { name: "Actualizar ahora" })).toHaveCount(0);
    await expect(page.getByText(/En cada compra elegible/)).toBeHidden();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    expect(new URL(page.url()).pathname).toBe("/lealtad");
    expect(reads[0]).toEqual({ referrer: undefined, cookie: undefined });
    await page.screenshot({ path: testInfo.outputPath(`loyalty-card-${width}-ready.png`), fullPage: true });
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Ver menú del negocio" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Actualizar puntos" })).toBeFocused();
    refreshed = true;
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Tus puntos")).toHaveText(width === 320 ? "0" : "-5");
    await expect(page.getByText("Saldo en revisión", { exact: true })).toBeVisible();
    await expect(page.getByText(/El saldo puede cambiar/)).toBeVisible();
    await expect(page.getByRole("button", { name: /canjear|pagar/i })).toHaveCount(0);
    const explanation = page.locator("summary").filter({ hasText: "Cómo funciona tu tarjeta" });
    await explanation.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(/En cada compra elegible/)).toBeVisible();
    await expect(page.getByText("Los importes sobrantes no se suman entre compras.")).toBeVisible();
    await expect(page.getByText(/El enlace vence el/)).toBeVisible();
    await checkAccessibility(page);
    await explanation.click();
    await page.screenshot({ path: testInfo.outputPath(`loyalty-card-${width}.png`), fullPage: true });
  });
}

test("an expired link has no balance and recovers through an explicit retry", async ({ page }) => {
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: { authenticated: false } }));
  let available = false;
  await page.route("**/api/v1/public/loyalty/cards", route => {
    expect(route.request().postDataJSON()).toEqual({ token: "expired-test" });
    return route.fulfill(!available ? { status: 404, json: {} } : { json: card });
  });
  await page.goto("/lealtad#expired-test");
  await expect(page.getByRole("alert")).toContainText("Pide al negocio un enlace nuevo");
  await expect(page.getByLabel("Tus puntos")).toHaveCount(0);
  available = true;
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(page.getByLabel("Tus puntos")).toHaveText("35");
});

test("owner shares a card for the exact selected customer without exposing their identity publicly", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: {
    authenticated: true, tenant_id: "tenant-1", tenant_name: "Negocio de prueba",
    user: { id: "owner-1", email: "owner@example.com", tenant_id: "tenant-1", role: "owner" },
  } }));
  await page.route("**/api/v1/billing/subscription", route => route.fulfill({ json: {
    plan: { name: "Standard Plan", amount_minor_units: 29900, currency: "MXN", interval: "month" },
    subscription: null, access: { allowed: true, reason: "active", trialing: false, trial_ends_at: null, blocked_at: null, recovery_path: "/settings/billing" },
  } }));
  const account = { customer_id: "customer-1", customer_name: "Ana del negocio", balance: 35 };
  await page.route("**/api/v1/loyalty?**", route => route.fulfill({ json: { policy: { ...card.policy, version: 1 }, accounts: [account], accounts_has_more: false } }));
  await page.route("**/api/v1/customers?**", route => route.fulfill({ json: [{ id: "customer-1", name: account.customer_name, is_active: true }] }));
  await page.route("**/api/v1/loyalty/customers/customer-1?**", route => route.fulfill({ json: { ...account, adjustments_pending: false, entries: [], has_more: false } }));
  let issuances = 0;
  await page.route("**/api/v1/loyalty/customers/customer-1/digital-card", route => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-kova-expected-user"]).toBe("owner-1");
    issuances += 1;
    return route.fulfill({ json: { share_path: "/lealtad#owner-shared-test", expires_at: card.expires_at } });
  });
  await page.goto("/loyalty");
  await page.getByRole("button", { name: /Ana del negocio.*35 puntos/ }).click();
  const share = page.getByRole("region", { name: "Tarjeta digital del cliente" });
  await expect(share).toBeVisible();
  expect(issuances).toBe(0);
  await share.getByRole("button", { name: "Crear enlace de tarjeta digital" }).click();
  await expect(share.getByLabel("Enlace de la tarjeta")).toHaveValue(/\/lealtad#owner-shared-test$/);
  await expect(share.getByRole("link", { name: "Ver tarjeta" })).toHaveAttribute("rel", "noreferrer");
  expect(issuances).toBe(1);
  await checkAccessibility(page);
});
