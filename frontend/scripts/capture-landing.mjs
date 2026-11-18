// Capture the current app with an isolated, deterministic example business.
// Every API request is intercepted. No credentials or production data are used.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { makeStory } from "../src/reports/__fixtures__/story.ts";
import { makeControl } from "../src/dashboard/__fixtures__/control.ts";
import { summaryFromStory } from "../src/dashboard/storyAdapters.ts";
import { REGISTER_DEMO_PRODUCTS, REGISTER_DEMO_CART, TOUR_INVENTORY } from "../src/landing/demo/registerDemoCatalog.ts";

const base = new URL(process.env.KOVA_CAPTURE_BASE_URL ?? "http://127.0.0.1:5174");
if (!["127.0.0.1", "localhost"].includes(base.hostname)) throw new Error("Landing captures require a local frontend.");
const output = fileURLToPath(new URL("../public/showcase/current/", import.meta.url));
const requestedScreens = (process.env.KOVA_CAPTURE_SCREENS ?? "register,inventory,shifts,reports,dashboard").split(",");
if (requestedScreens.some(name => !["register", "inventory", "shifts", "reports", "dashboard"].includes(name))) throw new Error("Unknown capture screen.");
const date = "2026-11-18";
const features = ["pos", "inventory", "sales_reports", "public_catalog", "purchasing", "advanced_reports", "loyalty", "customer_orders", "quotes"];
const shift = {
  id: "example-shift", tenant_id: "example-business", status: "open",
  opened_at: `${date}T14:00:00Z`, closed_at: null,
  opening_cash_amount: "500.00", expected_cash_amount: "2040.00",
  actual_cash_amount: null, reconciliation_status: null, variance_amount: null,
  movements: [{ id: "example-movement", shift_id: "example-shift", type: "cash_out", amount: "200.00", reason: "Compra de leche", created_at: `${date}T19:15:00Z` }],
};
const stock = TOUR_INVENTORY.map(item => ({
  product_id: item.id, product_name: REGISTER_DEMO_PRODUCTS.find(p => p.id === item.id).name,
  sku: item.id.toUpperCase(), track_inventory: true, stock_on_hand: item.after,
  reserved_quantity: 0, available_quantity: item.after,
  low_stock_threshold: item.threshold, is_low_stock: item.after <= item.threshold,
}));
const products = REGISTER_DEMO_PRODUCTS.map(product => ({
  id: product.id, tenant_id: "example-business", name: product.name,
  price_amount: product.price.toFixed(2), is_active: true,
  category_id: product.category, modifier_groups: [],
  track_inventory: stock.some(item => item.product_id === product.id),
  image_url: product.image ?? null,
}));
const driver = { product_id: "cold-brew", product_name: "Cold brew", quantity_sold: 24, gross_sales: "1488.00", sales_share_pct: 31 };
const story = makeStory({
  summary: { start_date: date, end_date: date, timezone: "America/Mexico_City", net_sales: "4820.00", gross_sales: "4820.00", refund_total: "0.00", completed_orders: 37, average_ticket: "130.27", refund_count: 0, cancellation_count: 0 },
  sales_by_day: [{ date, net_sales: "4820.00", order_count: 37, average_ticket: "130.27", sales_share_pct: 100 }],
  sales_by_daypart: [
    { key: "manana", label: "Mañana", start_hour: 6, end_hour: 11, net_sales: "1240.00", order_count: 10, average_ticket: "124.00", sales_share_pct: 26 },
    { key: "tarde", label: "Tarde", start_hour: 12, end_hour: 17, net_sales: "2380.00", order_count: 18, average_ticket: "132.22", sales_share_pct: 49 },
    { key: "noche", label: "Noche", start_hour: 18, end_hour: 23, net_sales: "1200.00", order_count: 9, average_ticket: "133.33", sales_share_pct: 25 },
  ],
  peak_hour: { hour: 17, label: "17:00–18:00", daypart_key: "tarde", net_sales: "980.00", order_count: 7, sales_share_pct: 20 },
  top_product_by_sales: driver, top_product_by_units: driver,
  product_drivers: [driver, { product_id: "capuchino", product_name: "Capuchino mediano", quantity_sold: 18, gross_sales: "1008.00", sales_share_pct: 21 }],
  dominant_payment: { method: "cash", amount: "1740.00", refunded_amount: "0.00", net_amount: "1740.00", payment_count: 14, sales_share_pct: 36 },
  payment_mix: [
    { method: "cash", amount: "1740.00", refunded_amount: "0.00", net_amount: "1740.00", payment_count: 14, sales_share_pct: 36 },
    { method: "manual_card", amount: "3080.00", refunded_amount: "0.00", net_amount: "3080.00", payment_count: 23, sales_share_pct: 64 },
  ],
});
const hourly = [240, 380, 560, 460, 620, 480, 540, 560, 980].map((amount, index) => ({
  hour: 9 + index, net_sales: amount.toFixed(2), order_count: [2, 3, 4, 3, 5, 4, 4, 5, 7][index],
}));
const control = makeControl({
  generated_at: `${date}T23:42:00Z`,
  scope: { kind: "all", branch_id: null, label: "Todo el negocio", can_view_all: true },
  branches: [{ id: "example-branch", name: "Sucursal principal" }],
  branch_sales: [{ branch_id: "example-branch", branch_name: "Sucursal principal", completed_orders: 37, net_sales: "4820.00", average_ticket: "130.27", share_pct: "100.00", low_stock_count: 1, open_shift_count: 1, attention_signals: 1 }],
  priority_counts: { now: 0, today: 1, followup: 0 },
  alert_groups_total: 1, alerts_has_more: false,
  alerts: [{ key: "low_stock", title: "Productos con existencias bajas", branch_id: "example-branch", branch_name: "Sucursal principal", count: 1, priority: "today", route_key: "inventory", scope: "current" }],
});
const salesArea = control.areas.find(area => area.key === "sales");
salesArea.metrics.find(metric => metric.key === "open_shifts").value = "1";
salesArea.metrics.find(metric => metric.key === "expected_cash").value = "2040.00";
control.areas = control.areas.map(area => {
  if (area.key === "business") return { ...area, metrics: area.metrics.filter(metric => metric.key === "subscription") };
  if (area.key === "attention") return { ...area, metrics: area.metrics.filter(metric => metric.key === "cases_open").map(metric => ({ ...metric, value: "0" })) };
  if (area.key === "money") return { ...area, metrics: area.metrics.filter(metric => metric.key === "unmatched").map(metric => ({ ...metric, value: "0" })) };
  if (area.key === "products") return { ...area, metrics: area.metrics.map(metric => ({ ...metric, value: metric.key === "low_stock" ? "1" : "0" })) };
  return area;
});
// Routes are exact or explicitly parameterized; unknown requests fail capture.
function payload(url) {
  const path = url.pathname.replace("/api/v1/", "");
  if (path === "auth/session") return { authenticated: true, feature_flags: {}, tenant_id: "example-business", tenant_name: "Sweet Home", user: { id: "example-owner", email: "example@example.test", tenant_id: "example-business", role: "owner", email_verified: true }, commercial_access: { allowed: true, reason: "active", valid_until: "2026-11-19T23:42:00Z", plan_code: "gestion", features } };
  if (path === "billing/plans") return { tiered_pricing_enabled: true, available_plans: [{ code: "gestion", name: "Gestión", amount_minor_units: 69900, currency: "MXN", interval: "month", tax_inclusive: true, features, limits: { branches: 1, product_image_bytes: 1073741824 } }] };
  if (path === "billing/subscription") return { subscription: { status: "active" }, access: { allowed: true, reason: "active", trialing: false, plan_code: "gestion", features } };
  if (path === "branches") return [{ id: "example-branch", name: "Sucursal principal", address: null, created_at: `${date}T14:00:00Z` }];
  if (path === "settings/business-profile") return { tenant_id: "example-business", public_name: "Sweet Home", timezone: "America/Mexico_City", locale: "es-MX", currency: "MXN", support_email: null, support_phone: null };
  if (path === "settings/receipt") return { tenant_id: "example-business", receipt_business_name: "Sweet Home", paper_width_mm: 80, logo_url: null, footer: null, tax_contact_text: null };
  if (path === "onboarding/state") return { tenant_id: "example-business", completed_count: 0, total_count: 0, steps: [] };
  if (path === "assistant/capabilities") return { enabled: false, inference_ready: false, configuration: false, documents: false, email: false, role: "owner" };
  if (path === "hardware/drawer") return { configured: false, online: false, auto_open: false };
  if (path === "catalog/products") return products;
  if (path === "catalog/categories") return [{ id: "hot", name: "Bebidas calientes" }, { id: "cold", name: "Bebidas frías" }, { id: "bakery", name: "Repostería" }, { id: "food", name: "Alimentos" }];
  if (["catalog/modifier-groups", "customers", "employees", "loyalty/rewards", "branches/transfers"].includes(path)) return [];
  if (path === "loyalty/rewards/offer") return null;
  if (path === "shifts/current") return shift;
  if (path === "shifts") return [shift];
  if (path === "inventory/stock") return stock;
  if (path === "inventory/low-stock") return stock.filter(item => item.is_low_stock);
  if (path === "inventory/velocity") return stock.map(item => ({ product_id: item.product_id, product_name: item.product_name, stock_on_hand: item.stock_on_hand, units_per_day_7d: "2.00", days_until_out: String(item.stock_on_hand / 2) }));
  if (path === "reports/business-story") {
    const start = url.searchParams.get("start_date");
    const end = url.searchParams.get("end_date");
    if (end === date && start !== end) return { ...story,
      summary: { ...story.summary, start_date: start, end_date: end, net_sales: "30000.00", gross_sales: "30000.00", completed_orders: 230, average_ticket: "130.43" },
      sales_by_day: [3900, 4100, 4300, 3800, 4400, 4680, 4820].map((amount, index) => ({ date: `2026-11-${12 + index}`, net_sales: amount.toFixed(2), order_count: 30 + index, average_ticket: (amount / (30 + index)).toFixed(2), sales_share_pct: amount / 300 })),
    };
    return end !== date ? { ...story, summary: { ...story.summary, start_date: start, end_date: end, net_sales: "4080.00", gross_sales: "4080.00", completed_orders: 32, average_ticket: "127.50" } } : story;
  }
  if (path === "reports/dashboard") return {
    story, hourly, previous_summary: { ...summaryFromStory(story), net_sales: "4080.00", gross_sales: "4080.00", order_count: 32 },
    timezone: "America/Mexico_City", active_catalog_count: products.length,
    tracked_inventory_count: stock.length, low_stock_items: stock.filter(item => item.is_low_stock),
    active_employee_count: 2, closed_shift_count: 0, billing: null,
    onboarding: { tenant_id: "example-business", completed_count: 0, total_count: 0, steps: [] },
    control_center: control,
  };
  if (path === "reports/branches") return { start_date: date, end_date: date, timezone: "America/Mexico_City", total_net_sales: "4820.00", leader_branch_ids: ["example-branch"], branches: [{ branch_id: "example-branch", branch_name: "Sucursal principal", completed_orders: 37, gross_sales: "4820.00", refunded_amount: "0.00", net_sales: "4820.00", average_ticket: "130.27", share_pct: "100", products: [{ product_id: "cold-brew", product_name: "Cold brew", net_quantity: 24, net_sales: "1488.00" }] }] };
  if (path === "reports/sales-by-hour") return [{ hour: 17, net_sales: "980.00", order_count: 7 }];
  throw new Error(`Unconfigured capture API: ${path}`);
}

const browser = await chromium.launch();
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: 1.5, isMobile: mobile, hasTouch: mobile, reducedMotion: "reduce", timezoneId: "America/Mexico_City", locale: "es-MX", serviceWorkers: "block" });
    await context.addInitScript(() => {
      globalThis.localStorage.setItem("kova:tour:example-business:register", "1");
      globalThis.localStorage.setItem("kova:tour:example-business:catalog", "1");
      globalThis.localStorage.setItem("kova:tour:example-business:reports", "1");
    });
    const page = await context.newPage();
    await page.clock.install({ time: new Date(`${date}T23:42:00Z`) });
    const failures = [];
    page.on("pageerror", error => failures.push(error.message));
    page.on("console", message => { if (message.type() === "error") console.error(message.text().slice(0, 500)); });
    await context.route("**/api/**", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/v1/telemetry/")) return route.fulfill({ status: 204, body: "" });
      try {
        if (request.method() !== "GET") throw new Error(`Capture attempted a write: ${request.method()} ${url.pathname}`);
        await route.fulfill({ json: payload(url) });
      } catch (error) {
        failures.push(error.message);
        await route.fulfill({ status: 503, json: { detail: "Capture fixture missing" } });
      }
    });
    const dir = resolve(output, mobile ? "mobile" : ".");
    await mkdir(dir, { recursive: true });
    for (const [name, path, heading] of [["register", "/register", "Caja"], ["inventory", "/inventory", "Inventario"], ["shifts", "/shifts", "Turnos"], ["reports", "/reports", "Análisis"], ["dashboard", "/dashboard", "Centro de control"]]) {
      if (!requestedScreens.includes(name)) continue;
      await page.goto(new URL(path, base).href, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: heading, exact: true }).waitFor({ timeout: 15000 }).catch(async error => { console.error(await page.locator("body").innerText(), failures); throw error; });
      if (name === "register") {
        for (const id of Object.keys(REGISTER_DEMO_CART)) {
          await page.getByRole("button", { name: `Agregar ${products.find(p => p.id === id).name}`, exact: true }).click();
          if (mobile) {
            const close = page.getByRole("button", { name: "Ocultar resumen de venta" });
            if (await close.isVisible()) await close.click();
          }
        }
      }
      if (name === "reports") await page.locator(".kv-report-stagger").waitFor();
      await page.addStyleTag({ content: "[data-capture-account], [data-capture-email] { display: none !important; }" });
      await page.evaluate(async () => {
        await globalThis.document.fonts.ready;
        await Promise.all([...globalThis.document.images].map(img => img.decode().catch(() => {})));
        globalThis.window.scrollTo(0, 0);
      });
      // Focus the actual analysis overview, after the branch summary. Nothing
      // is removed or restyled; this is the app at its natural scroll position.
      if (name === "reports") await page.locator(".kv-report-stagger").evaluate(element => element.scrollIntoView({ block: "start" }));
      if (name === "dashboard") await page.locator('section[aria-label="Tu día"]').evaluate(element => element.scrollIntoView({ block: "start" }));
      if (failures.length) throw new Error([...new Set(failures)].join("\n"));
      const text = await page.locator("body").innerText();
      if (/example@example|Capture fixture|No pudimos|Error al cargar/i.test(text)) throw new Error(`Unready or unsanitized capture: ${name}\n${text}`);
      await page.screenshot({ path: resolve(dir, `${name}.jpg`), type: "jpeg", quality: 88, animations: "disabled" });
      console.log(`Captured ${mobile ? "mobile/" : ""}${name}.jpg`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
