import { expect, test } from "./fixtures";
import axe from "axe-core";

const catalog = {
  title: "Café del Patio", description: "Café de especialidad, pan recién hecho y algo rico para compartir.",
  whatsapp_phone: "525550000000", checkout_available: false,
  products: [
    { id: "bread", name: "Pan de nuez", description: "Horneado con nuez y un toque de canela.", price_amount: "45.00", availability: "available" },
    { id: "coffee", name: "Café de olla", description: "Con piloncillo, canela y mucho sabor.", price_amount: "35.50", availability: "available" },
    { id: "toast", name: "Tostada de aguacate", description: "Pan de masa madre, aguacate y aceite de oliva.", price_amount: "95.00", availability: "unavailable" },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: { authenticated: false } }));
  await page.route("**/api/v1/public/catalog/menu-test", route => route.fulfill({ json: catalog }));
});

for (const width of [320, 390, 768, 1440]) {
  test(`menu request flows from basket to pending receipt at ${width}px`, async ({ page }) => {
    const height = width < 1024 ? 844 : 950;
    await page.setViewportSize({ width, height });
    if (width === 390) await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    const submissions: { message: string; product_ids: string[]; submission_id: string }[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/v1/public/catalog/menu-test/requests", async route => {
      submissions.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, json: { receipt_id: "receipt-menu-1", status: "received" } });
    });
    await page.goto("/catalogo/menu-test");
    const menu = page.getByRole("region", { name: "Nuestro menú" });
    const summary = page.getByRole("region", { name: "Tu pedido" });
    await expect(page.getByRole("heading", { name: "Café del Patio" })).toBeVisible();
    await expect(menu.getByRole("button", { name: "Agregar Tostada de aguacate al pedido" })).toBeDisabled();
    if (width < 1024) {
      await expect(summary).toBeHidden();
      await expect(page.getByLabel("Tu nombre", { exact: true })).toBeHidden();
      const first = await menu.getByRole("article").first().boundingBox();
      const second = await menu.getByRole("article").nth(1).boundingBox();
      expect(first!.y).toBeLessThan(400);
      expect(second!.y + second!.height).toBeLessThan(height);
    }
    await checkLayout();
    await menu.getByRole("button", { name: "Agregar Pan de nuez al pedido" }).click();
    if (width < 1024) {
      await menu.getByRole("button", { name: /Editar cantidad de Pan de nuez/ }).click();
      const details = page.getByRole("dialog", { name: "Pan de nuez" });
      await details.getByRole("button", { name: "Agregar uno de Pan de nuez" }).click();
      await details.getByRole("button", { name: "Cerrar", exact: true }).click();
      await expect(details).toHaveCount(0);
    } else await menu.getByRole("button", { name: "Agregar uno de Pan de nuez" }).click();
    await menu.getByRole("button", { name: "Agregar Café de olla al pedido" }).click();
    await page.getByLabel("Buscar en el menú").fill("cafe");
    await expect(menu.getByRole("heading", { name: "Café de olla" })).toBeVisible();
    await expect(menu.getByRole("heading", { name: "Pan de nuez" })).toHaveCount(0);
    await page.getByLabel("Buscar en el menú").fill("");
    if (width < 1024) await expect(menu.getByRole("button", { name: /Editar cantidad de Pan de nuez/ })).toContainText("2 en pedido");
    else await expect(menu.getByRole("group", { name: "Cantidad de Pan de nuez" })).toContainText("2");
    await page.getByRole("heading", { name: "Café del Patio" }).click();
    await page.screenshot({ path: `test-results/menu-${width}-menu.png`, fullPage: true });
    await page.screenshot({ path: `test-results/menu-${width}-vista.png` });
    if (width < 1024) {
      await page.getByRole("button", { name: /Ver mi pedido/ }).click();
      await expect(menu).toBeHidden();
      await expect(page.getByRole("complementary", { name: "Revisar pedido" })).toBeFocused();
      await expect(page.getByRole("button", { name: /Ver mi pedido/ })).toBeHidden();
    }
    await expect(summary.getByText("$125.50")).toBeVisible();
    await expect(page.getByRole("button", { name: "Enviar solicitud de pedido" })).toBeDisabled();
    await summary.getByRole("button", { name: "Restar uno de Pan de nuez" }).click();
    await expect(summary.getByText("$80.50")).toBeVisible();
    await page.getByLabel(width < 1024 ? "En el negocio" : "A distancia", { exact: true }).check();
    await page.getByLabel("Tu nombre", { exact: true }).fill("Ana de prueba");
    await page.getByLabel("Teléfono o correo para responder").fill("ana@example.com");
    await page.getByLabel("Notas para el negocio (opcional)").fill(width < 1024 ? "Estoy en la mesa 4" : "Quisiera recoger a las 2");
    if (width < 1024) {
      await page.getByRole("button", { name: "Volver al menú" }).click();
      await expect(summary).toBeHidden();
      await expect(page.getByRole("button", { name: /Ver mi pedido/ })).toBeFocused();
      await expect(menu.getByRole("button", { name: /Editar cantidad de Pan de nuez/ })).toContainText("1 en pedido");
      await page.getByRole("button", { name: /Ver mi pedido/ }).click();
      await expect(page.getByLabel("Tu nombre", { exact: true })).toHaveValue("Ana de prueba");
      await expect(page.getByLabel("Notas para el negocio (opcional)")).toHaveValue("Estoy en la mesa 4");
    }
    await checkLayout();
    await page.screenshot({ path: `test-results/menu-${width}-pedido.png`, fullPage: true });
    await page.getByRole("button", { name: "Enviar solicitud de pedido" }).click();
    await expect(page.getByText("Solicitud de pedido recibida", { exact: true })).toBeVisible();
    await expect(page.getByText(/Falta que la revise y acepte/)).toBeVisible();
    expect(submissions).toHaveLength(1);
    expect(submissions[0].product_ids).toEqual(["bread", "coffee"]);
    expect(submissions[0].message).toContain("1 × Pan de nuez\n1 × Café de olla");
    expect(submissions[0].message).toContain(`Origen: ${width < 1024 ? "En el negocio" : "A distancia"}`);
    expect(submissions[0].message.length).toBeLessThanOrEqual(1000);
    expect(errors).toEqual([]);
    await checkLayout();

    async function checkLayout() {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(async () => {
        const instance = window as unknown as { axe: typeof axe };
        return (await instance.axe.run("main", {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        })).violations;
      });
      expect(violations).toEqual([]);
    }
  });
}

test("keyboard navigation reaches the menu and a failed submission can be retried without duplication", async ({ page }) => {
  const submissions: string[] = [];
  await page.route("**/api/v1/public/catalog/menu-test/requests", async route => {
    submissions.push(route.request().postDataJSON().submission_id);
    await route.fulfill(submissions.length === 1 ? { status: 503, json: {} }
      : { status: 201, json: { receipt_id: "receipt-menu-2", status: "received" } });
  });
  await page.goto("/catalogo/menu-test");
  await expect(page.getByRole("heading", { name: "Café del Patio" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Saltar al menú" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Nuestro menú" })).toBeFocused();
  await page.getByRole("button", { name: "Agregar Pan de nuez al pedido" }).click();
  await page.getByLabel("Tu nombre", { exact: true }).fill("Ana");
  await page.getByLabel("Teléfono o correo para responder").fill("ana@example.com");
  await page.getByRole("button", { name: "Enviar solicitud de pedido" }).click();
  await expect(page.getByRole("alert")).toBeFocused();
  await page.getByRole("button", { name: "Enviar solicitud de pedido" }).click();
  await expect(page.getByText("Solicitud de pedido recibida", { exact: true })).toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[0]).toBe(submissions[1]);
});

test("mobile discovery finds mixed-order words, sorts prices and keeps the selected order", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/catalogo/menu-test");
  const menu = page.getByRole("region", { name: "Nuestro menú" });
  const search = page.getByRole("searchbox", { name: "Buscar en el menú" });
  await menu.getByRole("button", { name: "Agregar Pan de nuez al pedido" }).click();
  await search.fill("CANELA cafe");
  await expect(menu.getByRole("heading", { level: 3 })).toHaveText("Café de olla");
  await expect(menu.getByRole("status")).toContainText("1 de 3 productos");
  await expect(page.getByRole("button", { name: /Ver mi pedido/ })).toContainText("$45.00");
  await page.getByRole("button", { name: "Limpiar búsqueda", exact: true }).click();
  await expect(search).toBeFocused();
  await page.getByRole("combobox", { name: "Ordenar menú" }).selectOption("price_asc");
  await expect(menu.getByRole("heading", { level: 3 })).toHaveText(["Café de olla", "Pan de nuez", "Tostada de aguacate"]);
  await page.getByRole("button", { name: "Disponibles", exact: true }).click();
  // Foreground and background switch together: cross-fading both goes through
  // unreadable mid-grey even though the final selected state passes axe.
  const filterContrast = await page.getByRole("group", { name: "Filtrar productos" }).getByRole("button").evaluateAll(buttons => buttons.map(button => {
    const styles = getComputedStyle(button);
    const luminance = (color: string) => {
      const channels = color.match(/\d+/g)!.slice(0, 3).map(value => {
        const channel = Number(value) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const foreground = luminance(styles.color), background = luminance(styles.backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  }));
  for (const contrast of filterContrast) expect(contrast).toBeGreaterThanOrEqual(4.5);
  await expect(menu.getByRole("heading", { level: 3 })).toHaveText(["Café de olla", "Pan de nuez"]);
  await expect(menu.getByRole("status")).toContainText("2 de 3 productos");
  await search.fill("no existe");
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await page.getByRole("combobox", { name: "Ordenar menú" }).selectOption("published");
  await expect(menu.getByRole("heading", { level: 3 })).toHaveText(["Pan de nuez", "Café de olla"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("optimized-menu-mobile.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: /Ver mi pedido/ }).click();
  const summary = page.getByRole("region", { name: "Tu pedido" });
  await expect(summary.getByText("Pan de nuez", { exact: true })).toBeVisible();
  await expect(summary.getByText("$45.00").last()).toBeVisible();
});

// A separate visual example includes the same photo fields the public API
// returns. The original scenarios deliberately retain coverage without photos.
const photoCatalog = {
  ...catalog,
  products: [
    { id: "croissant", name: "Croissant de mantequilla", description: "Hojaldrado, doradito y recién horneado. Ideal para acompañar tu café.", price_amount: "45.00", availability: "available", image_url: "/showcase/products/croissant-mantequilla.png" },
    { id: "cappuccino", name: "Capuchino", description: "Espresso con leche vaporizada y una capa suave de espuma.", price_amount: "55.00", availability: "available", image_url: "/showcase/products/capuchino-mediano.png" },
    { id: "concha", name: "Concha de vainilla", description: "Pan dulce de vainilla, con una cubierta crujiente y suave por dentro.", price_amount: "28.00", availability: "available", image_url: "/showcase/products/concha-vainilla.png" },
    { id: "cold-brew", name: "Cold brew", description: "Café de extracción en frío, servido con hielo.", price_amount: "60.00", availability: "unavailable", image_url: "/showcase/products/cold-brew.png" },
  ],
};

for (const width of [320, 390, 768]) {
  test(`photographic menu loads actual images and supports product detail at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/api/v1/public/catalog/menu-test", route => route.fulfill({ json: photoCatalog }));
    await page.goto("/catalogo/menu-test");
    const menu = page.getByRole("region", { name: "Nuestro menú" });
    const firstPhoto = menu.getByRole("img", { name: "Croissant de mantequilla", exact: true });
    await expect(firstPhoto).toBeVisible();
    for (const product of photoCatalog.products) {
      const img = menu.getByRole("img", { name: product.name, exact: true });
      await expect.poll(() => img.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      await expect(img).not.toHaveClass(/opacity-0/);
    }
    const photoBox = await firstPhoto.boundingBox();
    const cardBox = await menu.getByRole("article").first().boundingBox();
    expect(photoBox!.width / cardBox!.width).toBeGreaterThan(0.9);
    expect(photoBox!.height).toBeGreaterThan(64);
    for (const index of [1, 2]) {
      const sameRow = await menu.getByRole("article").nth(index).boundingBox();
      expect(Math.abs(sameRow!.y - cardBox!.y)).toBeLessThan(1);
    }
    const detailsButton = menu.getByRole("button", { name: "Ver detalles de Croissant de mantequilla", exact: true });
    await detailsButton.click();
    const details = page.getByRole("dialog", { name: "Croissant de mantequilla" });
    await expect(details).toBeFocused();
    await expect(details.getByText(photoCatalog.products[0].description)).toBeVisible();
    await page.keyboard.press("Shift+Tab");
    await expect(details.getByRole("button", { name: "Agregar al pedido" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(details.getByRole("button", { name: "Cerrar", exact: true })).toBeFocused();
    await page.screenshot({ path: `test-results/menu-${width}-detalle-foto.png` });
    await page.keyboard.press("Escape");
    await expect(details).toHaveCount(0);
    await expect(detailsButton).toBeFocused();
    await menu.getByRole("button", { name: "Agregar Croissant de mantequilla al pedido" }).click();
    await menu.getByRole("button", { name: "Agregar Capuchino al pedido" }).click();
    const editQuantity = menu.getByRole("button", { name: /Editar cantidad de Croissant de mantequilla/ });
    expect((await editQuantity.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole("heading", { name: "Café del Patio" }).click();
    await page.screenshot({ path: `test-results/menu-${width}-fotografias.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => (await (window as unknown as { axe: typeof axe }).axe.run("main", {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    })).violations);
    expect(violations).toEqual([]);
    await expect(page.getByRole("button", { name: /Ver mi pedido/ })).toContainText("$100.00");
  });
}
