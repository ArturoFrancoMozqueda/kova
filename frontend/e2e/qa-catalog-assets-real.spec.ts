import { Buffer } from "node:buffer";
import { crc32, deflateSync } from "node:zlib";
import { expect, test, type Page } from "./fixtures";
import { createTenantThroughUi, integrationEnabled } from "./integration-helpers";
import { markFirstUseToursSeen } from "./helpers";
import type { Product, CatalogImportResponse } from "../src/catalog/types";
import type { StockItem, MovementHistoryResponse } from "../src/inventory/types";
import type { Order } from "../src/orders/types";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const HEADERS = ["nombre", "sku", "precio", "costo", "categoria", "control_inventario", "stock_inicial", "umbral_stock", "codigo_barras"];
type Cell = string | number | { formula: string };

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Real, minimal OpenXML fixtures. Every byte is synthetic; no spreadsheet
// package, external file, browser route interception or user document is used.
function storedZip(parts: Array<[string, string]>): Buffer {
  const entries: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [path, text] of parts) {
    const name = Buffer.from(path);
    const data = Buffer.from(text);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    entries.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(parts.length, 8);
  end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...entries, central, end]);
}

function workbook(rows: Cell[][], extraSheet = false): Buffer {
  const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const relation = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const lastColumn = String.fromCharCode(64 + Math.max(...rows.map(row => row.length)));
  const sheet = `<worksheet xmlns="${main}"><dimension ref="A1:${lastColumn}${rows.length}"/><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => {
    const reference = `${String.fromCharCode(65 + c)}${r + 1}`;
    if (typeof value === "number") return `<c r="${reference}"><v>${value}</v></c>`;
    if (typeof value === "object") return `<c r="${reference}"><f>${xml(value.formula)}</f></c>`;
    return `<c r="${reference}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
  }).join("")}</row>`).join("")}</sheetData></worksheet>`;
  return storedZip([
    ["[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>${extraSheet ? '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' : ""}</Types>`],
    ["_rels/.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relation}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<workbook xmlns="${main}" xmlns:r="${relation}"><sheets><sheet name="Productos" sheetId="1" r:id="rId1"/>${extraSheet ? '<sheet name="Otra hoja" sheetId="2" r:id="rId2"/>' : ""}</sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relation}/worksheet" Target="worksheets/sheet1.xml"/>${extraSheet ? `<Relationship Id="rId2" Type="${relation}/worksheet" Target="worksheets/sheet2.xml"/>` : ""}</Relationships>`],
    ["xl/worksheets/sheet1.xml", sheet],
    ...(extraSheet ? [["xl/worksheets/sheet2.xml", `<worksheet xmlns="${main}"><sheetData/></worksheet>`] as [string, string]] : []),
  ]);
}

function syntheticPng(): Buffer {
  const chunk = (kind: string, data: Buffer) => {
    const type = Buffer.from(kind);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([length, type, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(32, 0);
  header.writeUInt32BE(32, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc(32 * (1 + 32 * 4));
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const start = y * 129 + 1 + x * 4;
      pixels.set([53, 99, 208, 255], start);
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

async function read<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`/api/v1${path}`);
  expect(response.ok(), `Lectura real ${path}: ${response.status()}`).toBe(true);
  return await response.json() as T;
}

async function catalogSnapshot(page: Page) {
  const [products, categories, stock] = await Promise.all([
    read<Product[]>(page, "/catalog/products"),
    read<Array<{ id: string; name: string }>>(page, "/catalog/categories"),
    read<StockItem[]>(page, "/inventory/stock"),
  ]);
  return { products, categories, stock };
}

async function importDialog(page: Page) {
  await page.goto("/catalog");
  await page.getByRole("button", { name: "Importar catálogo", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Importar catálogo", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

function waitForImport(page: Page, dryRun: boolean) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/v1/catalog/import" && url.searchParams.get("dry_run") === String(dryRun)
      && response.request().method() === "POST";
  });
}

test.describe("QA catálogo, archivos e imágenes con API/Postgres reales", () => {
  test.skip(!integrationEnabled(), "Requiere KOVA_INTEGRATION=1 y el stack efímero local");
  test.beforeEach(async ({ page, baseURL }) => {
    // Guard every setup and mutation against accidental production execution.
    expect(baseURL).toBeTruthy();
    expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL!).hostname);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const signupResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/auth/signup"
      && response.request().method() === "POST");
    await createTenantThroughUi(page, "catalog-assets-real");
    const signup = await (await signupResponse).json();
    expect(signup.dev_verification_token, "El setup debe usar únicamente la verificación de desarrollo local").toBeTruthy();
    // The only non-UI mutation shared by these cases is synthetic account setup.
    // It uses real CSRF/session and public auth; it never fabricates paid access.
    await page.evaluate(async (token: string) => {
      const csrf = document.cookie.split("; ").find(item => item.startsWith("csrf_token="))?.slice("csrf_token=".length);
      if (!csrf) throw new Error("El setup local requiere la cookie CSRF real");
      const response = await fetch("/api/v1/auth/verify", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf) },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) throw new Error(`Verificación local: ${response.status}`);
    }, signup.dev_verification_token);
    const session = await read<{ tenant_id: string }>(page, "/auth/session");
    await markFirstUseToursSeen(page, session.tenant_id);
  });

  for (const format of ["csv", "xlsx"] as const) {
    test(`${format.toUpperCase()}: preview sin writes y commit conserva acentos, ceros, costo y ledger`, async ({ page }, testInfo) => {
      const name = format === "csv" ? "Café CSV ágil" : "Café XLSX de olla";
      const sku = `QA-${format.toUpperCase()}-REAL`;
      const barcode = format === "csv" ? "0000411260001" : "0000411260002";
      const row: Cell[] = [name, sku, 38.50, 12.25, "Bebidas frías QA", "sí", 7, 2, barcode];
      const buffer = format === "csv"
        ? Buffer.from(`\ufeff${HEADERS.join(",")}\r\n${row.join(",")}\r\n`)
        : workbook([HEADERS, row]);
      const before = await catalogSnapshot(page);
      const dialog = await importDialog(page);
      const previewResponse = waitForImport(page, true);
      await dialog.getByLabel("Elegir archivo CSV o Excel", { exact: true }).setInputFiles({
        name: `catalogo-qa.${format}`, mimeType: format === "csv" ? "text/csv" : XLSX_TYPE, buffer,
      });
      const preview = await previewResponse;
      expect(preview.status()).toBe(200);
      const body = await preview.json() as CatalogImportResponse;
      expect(body).toMatchObject({ total_rows: 1, valid_rows: 1, error_rows: 0 });
      expect(body.rows[0].normalized).toMatchObject({ name, sku, barcode, price_amount: "38.50", cost_price: "12.25", initial_stock: 7 });
      await expect(dialog.getByText(name, { exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Importar productos", exact: true })).toBeEnabled();
      expect(await catalogSnapshot(page)).toEqual(before);
      const commitResponse = waitForImport(page, false);
      await dialog.getByRole("button", { name: "Importar productos", exact: true }).click();
      const committed = await commitResponse;
      expect(committed.status()).toBe(201);
      expect(await committed.json()).toMatchObject({ created_products: 1, created_categories: 1, initial_stock_movements: 1 });
      await expect(dialog).toBeHidden();
      await page.reload();
      const after = await catalogSnapshot(page);
      expect(after.products).toHaveLength(before.products.length + 1);
      const product = after.products.find(item => item.sku === sku)!;
      expect(product).toMatchObject({ name, barcode, price_amount: "38.50", cost_price: "12.25", track_inventory: true, low_stock_threshold: 2 });
      expect(after.stock.find(item => item.product_id === product.id)).toMatchObject({ stock_on_hand: 7, reserved_quantity: 0, available_quantity: 7 });
      const movements = await read<MovementHistoryResponse>(page, `/inventory/products/${product.id}/movements`);
      expect(movements.total).toBe(1);
      expect(movements.items[0]).toMatchObject({ quantity_delta: 7, stock_on_hand_after: 7 });
      await expect(page.getByRole("button", { name: `Editar ${name}`, exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`catalog-${format}-persisted.png`), fullPage: true });
    });
  }

  test("CSV mixto inválido bloquea todo el commit y conserva catálogo/stock", async ({ page }) => {
    const before = await catalogSnapshot(page);
    const dialog = await importDialog(page);
    const previewResponse = waitForImport(page, true);
    await dialog.getByLabel("Elegir archivo CSV o Excel", { exact: true }).setInputFiles({
      name: "catalogo-mixto.csv", mimeType: "text/csv",
      buffer: Buffer.from(`${HEADERS.join(",")}\nFila válida,QA-VALIDA,20,5,Categoría sin guardar,sí,3,1,0000411260003\nFila inválida,QA-INVALIDA,no-es-numero,5,Categoría sin guardar,sí,3,1,0000411260004\n`),
    });
    const response = await previewResponse;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ total_rows: 2, valid_rows: 1, error_rows: 1 });
    await expect(dialog.getByText(/precio debe ser/i)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Importar productos", exact: true })).toBeDisabled();
    expect(await catalogSnapshot(page)).toEqual(before);
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.reload();
    expect(await catalogSnapshot(page)).toEqual(before);
  });

  for (const invalid of ["formula", "multiple-sheets"] as const) {
    test(`XLSX ${invalid}: rechazo accionable sin productos, categorías ni stock parciales`, async ({ page }) => {
      const before = await catalogSnapshot(page);
      const rows: Cell[][] = [HEADERS, ["Producto que no debe guardarse", "QA-XLSX-REJECT", invalid === "formula" ? { formula: "9+9" } : 18, 4, "Categoría no creada", "sí", 8, 2, "0000411260005"]];
      const dialog = await importDialog(page);
      const responsePromise = waitForImport(page, true);
      await dialog.getByLabel("Elegir archivo CSV o Excel", { exact: true }).setInputFiles({
        name: `${invalid}.xlsx`, mimeType: XLSX_TYPE, buffer: workbook(rows, invalid === "multiple-sheets"),
      });
      const response = await responsePromise;
      expect(response.status()).toBe(400);
      await expect(dialog.getByRole("alert")).toContainText(invalid === "formula" ? /contiene una fórmula/i : /exactamente una hoja/i);
      await expect(dialog.getByRole("button", { name: "Importar productos", exact: true })).toBeDisabled();
      expect(await catalogSnapshot(page)).toEqual(before);
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
      await page.reload();
      expect(await catalogSnapshot(page)).toEqual(before);
    });
  }

  test("PNG sintético: previsualización, encuadre, imagen persistida y borrado desde UI", async ({ page }, testInfo) => {
    const name = "Producto PNG efímero";
    await page.goto("/catalog");
    await page.getByRole("button", { name: "Nuevo producto", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Nuevo producto", exact: true });
    await dialog.getByLabel("Nombre del producto", { exact: true }).fill(name);
    await dialog.getByLabel("Precio", { exact: true }).fill("25.00");
    await dialog.getByLabel("SKU", { exact: true }).fill("QA-PNG-REAL");
    await dialog.getByLabel("Subir imagen", { exact: true }).setInputFiles({ name: "qa-synthetic.png", mimeType: "image/png", buffer: syntheticPng() });
    await expect(dialog.getByRole("button", { name: "Quitar imagen", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Aumentar zoom", exact: true }).click();
    await dialog.getByRole("button", { name: "Aumentar zoom", exact: true }).click();
    expect(await read<Product[]>(page, "/catalog/products")).toHaveLength(0);
    const uploadResponse = page.waitForResponse(response => /\/api\/v1\/catalog\/products\/[^/]+\/image$/.test(new URL(response.url()).pathname)
      && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Guardar producto", exact: true }).click();
    expect((await uploadResponse).ok()).toBe(true);
    await expect(dialog).toBeHidden();
    await page.reload();
    const [product] = await read<Product[]>(page, "/catalog/products");
    expect(product).toMatchObject({ name, sku: "QA-PNG-REAL" });
    expect(product.image_zoom).toBeCloseTo(1.2);
    expect(product.image_url).toMatch(/^\/api\/v1\/catalog\/products\/[^/]+\/image\?v=/);
    const asset = await page.request.get(product.image_url!);
    expect(asset.status()).toBe(200);
    expect(asset.headers()["content-type"]).toMatch(/^image\/(png|jpeg|webp)/);
    expect((await asset.body()).length).toBeGreaterThan(0);
    const thumbnail = page.getByRole("img", { name: `Imagen de ${name}`, exact: true }).first();
    await expect(thumbnail).toBeVisible();
    await expect.poll(() => thumbnail.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("catalog-image-persisted.png"), fullPage: true });
    await page.getByRole("button", { name: `Editar ${name}`, exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Editar producto", exact: true });
    await expect(edit.getByText("1.2x", { exact: true })).toBeVisible();
    await edit.getByRole("button", { name: "Quitar imagen", exact: true }).click();
    const deletionResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/catalog/products/${product.id}/image`
      && response.request().method() === "DELETE");
    await edit.getByRole("button", { name: "Guardar producto", exact: true }).click();
    expect((await deletionResponse).status()).toBe(204);
    await expect(edit).toBeHidden();
    await page.reload();
    expect((await read<Product[]>(page, "/catalog/products"))[0].image_url).toBeNull();
    expect((await page.request.get(product.image_url!)).status()).toBe(404);
    await expect(page.getByRole("img", { name: `Imagen de ${name}`, exact: true })).toHaveCount(0);
  });

  test("modificadores obligatorios: completar selección y cobrar conserva deltas y snapshot", async ({ page }, testInfo) => {
    // API-only setup creates synthetic master data. Selecting modifiers and
    // collecting the sale below are real UI actions against FastAPI/PG/RLS.
    const prepared = await page.evaluate(async () => {
      const csrf = document.cookie.split("; ").find(item => item.startsWith("csrf_token="))?.slice("csrf_token=".length);
      if (!csrf) throw new Error("El setup efímero necesita CSRF real");
      const write = async (path: string, body: object, method = "POST") => {
        const response = await fetch(`/api/v1${path}`, { method, credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf), "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify(body) });
        if (!response.ok) throw new Error(`Master data local ${path}: ${response.status}`);
        return response.json();
      };
      const group = await write("/catalog/modifier-groups", { name: "QA Dos complementos", is_required: true, min_selections: 2, max_selections: 2 });
      await write(`/catalog/modifier-groups/${group.id}/options`, { name: "QA Complemento A", price_delta: "5.00", sort_order: 0 });
      await write(`/catalog/modifier-groups/${group.id}/options`, { name: "QA Complemento B", price_delta: "7.50", sort_order: 1 });
      const product = await write("/catalog/products", { name: "QA Café con complementos", price_amount: "45.00", track_inventory: false });
      await write(`/catalog/products/${product.id}/modifier-groups`, { assignments: [{ modifier_group_id: group.id, sort_order: 0 }] }, "PUT");
      return { productId: product.id as string, productName: product.name as string };
    });
    await page.goto("/register");
    await page.getByRole("button", { name: `Agregar ${prepared.productName}`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `Personalizar — ${prepared.productName}`, exact: true });
    await expect(dialog.getByRole("button", { name: "Agregar al carrito", exact: true })).toBeDisabled();
    await dialog.getByRole("checkbox", { name: /QA Complemento A/ }).check();
    await expect(dialog.getByRole("button", { name: "Agregar al carrito", exact: true })).toBeDisabled();
    await dialog.getByRole("checkbox", { name: /QA Complemento B/ }).check();
    await expect(dialog.getByRole("button", { name: "Agregar al carrito", exact: true })).toBeEnabled();
    await dialog.getByRole("button", { name: "Agregar al carrito", exact: true }).click();
    await expect(dialog).toBeHidden();
    const cart = page.getByLabel("Carrito", { exact: true });
    await expect(cart).toContainText("QA Complemento A");
    await expect(cart).toContainText("QA Complemento B");
    await expect(cart).toContainText("$57.50");
    await page.getByRole("radio", { name: "Transferencia", exact: true }).check();
    await page.getByRole("button", { name: /^cobrar$/i }).click();
    await expect(page.getByRole("status").filter({ hasText: /venta completada\.?/i })).toHaveText(/venta completada\.?/i);
    await page.reload();
    const orders = await read<{ total: number; items: Array<{ id: string }> }>(page, "/orders");
    expect(orders.total).toBe(1);
    const order = await read<Order>(page, `/orders/${orders.items[0].id}`);
    expect(order.total_amount).toBe("57.50");
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({ product_id: prepared.productId, quantity: 1, unit_price_amount: "57.50", line_total_amount: "57.50" });
    expect(order.items[0].modifiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ modifier_group_name: "QA Dos complementos", modifier_option_name: "QA Complemento A", price_delta_amount: "5.00" }),
      expect.objectContaining({ modifier_group_name: "QA Dos complementos", modifier_option_name: "QA Complemento B", price_delta_amount: "7.50" }),
    ]));
    expect(order.items[0].modifiers).toHaveLength(2);
    expect(order.payments[0]).toMatchObject({ method: "bank_transfer", amount_amount: "57.50" });
    await page.goto(`/orders/${order.id}`);
    await expect(page.locator("main")).toContainText("QA Complemento A");
    await expect(page.locator("main")).toContainText("QA Complemento B");
    await page.screenshot({ path: testInfo.outputPath("modifier-snapshot-persisted.png"), fullPage: true });
  });
});
