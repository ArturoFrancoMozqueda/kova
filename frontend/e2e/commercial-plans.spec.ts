import { expect, test, type Page } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";
const coreFeatures = ["pos", "inventory", "sales_reports", "public_catalog"];
const allFeatures = [...coreFeatures, "purchasing", "advanced_reports", "loyalty", "customer_orders", "quotes"];
const plans = [
  { code: "esencial", name: "Esencial", amount_minor_units: 39900, currency: "MXN", interval: "month", tax_inclusive: true, features: coreFeatures, limits: { product_image_bytes: 250_000_000, branches: 1 } },
  { code: "gestion", name: "Gestión", amount_minor_units: 69900, currency: "MXN", interval: "month", tax_inclusive: true, features: allFeatures, limits: { product_image_bytes: 1_073_741_824, branches: 1 } },
];
const summary = { start_date: "2026-11-02", end_date: "2026-11-02", gross_sales: "150.00", refund_total: "10.00", net_sales: "140.00", order_count: 3, refund_count: 1, void_count: 0 };
async function workspace(page: Page, code = "esencial", trial = false) {
  await markFirstUseToursSeen(page, "tenant-1");
  const plan = plans.find((item) => item.code === code) ?? { ...plans[1], code: "standard", name: "Plan Standard", amount_minor_units: 29900 };
  const access = { allowed: true, reason: trial ? "signup_trial" : "active", valid_until: "2030-01-01T00:00:00Z", trialing: trial,
    trial_ends_at: trial ? "2030-01-01T00:00:00Z" : null, blocked_at: null, recovery_path: "/settings/billing", grace_period_ends_at: null,
    plan_code: plan.code, plan_name: plan.name, features: plan.features, limits: plan.limits };
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: { authenticated: true, tenant_id: "tenant-1", tenant_name: "Negocio de prueba",
    user: { id: "user-1", tenant_id: "tenant-1", role: "owner", email: "qa@example.invalid", email_verified: true }, feature_flags: { customer_orders: true }, commercial_access: access } }));
  await page.route("**/api/v1/settings/business-profile", (route) => route.fulfill({ json: { timezone: "America/Mexico_City" } }));
  await page.route("**/api/v1/billing/subscription", (route) => route.fulfill({ json: { plan, access, available_plans: code === "standard" ? [plan] : plans, tiered_pricing_enabled: code !== "standard", portal_available: false,
    subscription: trial ? null : { id: "sub-1", status: "active", cancel_at_period_end: false, current_period_start: "2026-11-01T00:00:00Z", current_period_end: "2030-01-01T00:00:00Z", period_freshness: "verified" } } }));
}
for (const width of [390, 1440]) {
  test(`tier selection is explicit and keyboard accessible at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 }); await workspace(page, "gestion", true);
    let selected: unknown;
    await page.route("**/api/v1/billing/checkout", (route) => { selected = route.request().postDataJSON(); return route.fulfill({ status: 503, json: { detail: "Sandbox unavailable" } }); });
    await page.goto("/settings/billing");
    await expect(page.getByRole("button", { name: "Elige un plan para continuar" })).toBeDisabled();
    const essential = page.getByRole("radio", { name: /Esencial/ });
    await essential.focus(); await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: /Gestión/ })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowLeft"); await expect(essential).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("Fotos de productos: hasta 250 MB de archivos originales.")).toBeVisible();
    await page.getByRole("button", { name: "Activar por $399 MXN/mes" }).click();
    await expect.poll(() => selected).toEqual({ plan_code: "esencial" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`billing-tiers-${width}.png`), fullPage: true });
  });
  test(`Essential dashboard reveals ready core data without premium requests at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 }); await workspace(page);
    const premium: string[] = [];
    page.on("request", (request) => { if (/reports\/(business-story|sales-by-hour|branches)|inventory\/velocity|assistant\/capabilities/.test(request.url())) premium.push(request.url()); });
    await page.route("**/api/v1/reports/dashboard?*", (route) => route.fulfill({ json: { story: null, summary, advanced_reports_available: false } }));
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/v1/reports/payment-breakdown?*", async (route) => { await pending; await route.fulfill({ json: { payments: [] } }); });
    await page.route("**/api/v1/reports/top-products?*", (route) => route.fulfill({ json: { products: [] } }));
    await page.goto("/dashboard");
    await expect(page.getByText("$140.00")).toBeVisible();
    await expect(page.getByLabel("Cargando formas de pago")).toBeVisible();
    release(); await expect(page.getByText("No hay cobros en este periodo.")).toBeVisible();
    expect(premium).toEqual([]);
    await expect(page.getByRole("link", { name: "Asistente", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`essential-core-${width}.png`), fullPage: true });
  });
  for (const code of ["standard", "gestion"]) test(`${code} retains the paid subscription at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await workspace(page, code);
    await page.goto("/settings/billing");
    await expect(page.getByText(code === "standard" ? "$299 MXN/mes" : "$699 MXN/mes", { exact: true })).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Activar por/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Administrar suscripción" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
  test(`downgraded purchasing preserves receipt of an existing commitment at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await workspace(page);
    await page.route("**/api/v1/purchasing/suppliers", (route) => route.fulfill({ json: [] }));
    await page.route("**/api/v1/catalog/products", (route) => route.fulfill({ json: [] }));
    const purchase = { id: "purchase-1", supplier_name: "Proveedor previo", status: "pending", created_at: "2026-11-01T15:00:00Z", notes: null,
      items: [{ id: "line-1", product_id: "product-1", product_name: "Harina", quantity: 5, received_quantity: 0, unit_cost: "10.00" }] };
    await page.route("**/api/v1/purchasing/orders?*", (route) => route.fulfill({ json: [purchase] }));
    await page.goto("/purchasing");
    await expect(page.getByRole("button", { name: "Preparar compra" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Nuevo proveedor" })).toBeDisabled();
    await expect(page.getByText(/Proveedor previo/).first()).toBeVisible();
    await page.getByRole("button", { name: "Recibir mercancía" }).click();
    await expect(page.getByRole("button", { name: "Confirmar recepción" })).toBeEnabled();
  });
  test(`public offer does not guess a price while loading or unavailable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: { authenticated: false } }));
    let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/v1/billing/plans", async (route) => { await wait; await route.fulfill({ status: 503 }); });
    await page.goto("/");
    await expect(page.getByLabel("Consultando planes")).toBeAttached();
    await expect(page.locator("body")).not.toContainText("299");
    release();
    await expect(page.getByRole("button", { name: "Consultar planes de nuevo" })).toBeAttached();
    await expect(page.locator("body")).not.toContainText("299");
  });
  test(`public tiered plans match the server offer at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: { authenticated: false } }));
    await page.route("**/api/v1/billing/plans", (route) => route.fulfill({ json: { offer_revision: "tiered-current", tiered_pricing_enabled: true, available_plans: plans } }));
    await page.goto("/");
    const pricing = page.locator("#precio");
    await expect(pricing.getByRole("heading", { name: "Esencial" })).toBeAttached();
    await pricing.scrollIntoViewIfNeeded();
    await expect(pricing.getByText("$399 MXN/mes", { exact: true })).toBeVisible();
    await expect(pricing.getByText("$699 MXN/mes", { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("299");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`public-tiers-${width}.png`) });
  });

  test(`signup preserves the reviewed offer and form across a rollout at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: { authenticated: false } }));
    const legacy = { offer_revision: "standard-before-rollout", tiered_pricing_enabled: false,
      available_plans: [{ ...plans[1], code: "standard", name: "Plan Standard", amount_minor_units: 29900 }] };
    let catalog: unknown = legacy;
    await page.route("**/api/v1/billing/plans", (route) => route.fulfill({ json: catalog }));
    const signups: Record<string, unknown>[] = [];
    const login: string[] = [];
    page.on("request", (request) => { if (request.url().includes("/auth/login")) login.push(request.url()); });
    await page.route("**/api/v1/auth/signup", (route) => {
      signups.push(route.request().postDataJSON());
      return route.fulfill({ status: 409, json: { detail: "La oferta se actualizó. Revisa los planes y vuelve a continuar." } });
    });
    await page.goto("/signup");
    await expect(page.getByText(/Después, \$299 MXN/)).toBeVisible();
    await page.getByLabel(/Nombre del negocio/i).fill("Negocio conservado");
    await page.getByLabel(/Correo/i).fill("qa@example.invalid");
    await page.getByLabel(/Contraseña/i).fill("PassStrong123");
    await page.getByRole("checkbox").focus(); await page.keyboard.press("Space");
    catalog = { offer_revision: "tiered-after-rollout", tiered_pricing_enabled: true, available_plans: plans };
    await page.getByRole("button", { name: "Crear cuenta", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toContainText("Los planes se actualizaron");
    expect(signups).toHaveLength(0);
    await expect(page.getByText(/Esencial por \$399 MXN/)).toBeVisible();
    await page.getByRole("button", { name: "Crear cuenta", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toContainText("Los planes cambiaron antes de completar el registro");
    expect(signups).toHaveLength(1);
    expect(signups[0].billing_offer_revision).toBe("tiered-after-rollout");
    expect(login).toEqual([]);
    await expect(page.getByLabel(/Nombre del negocio/i)).toHaveValue("Negocio conservado");
    await expect(page.getByLabel(/Correo/i)).toHaveValue("qa@example.invalid");
    await expect(page.getByLabel(/Contraseña/i)).toHaveValue("PassStrong123");
    await expect(page.getByRole("checkbox")).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`signup-offer-review-${width}.png`), fullPage: true });
  });

  test(`a returning public tab refreshes its displayed offer at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: { authenticated: false } }));
    let catalog: unknown = { offer_revision: "standard-before-rollout", tiered_pricing_enabled: false,
      available_plans: [{ ...plans[1], code: "standard", name: "Plan Standard", amount_minor_units: 29900 }] };
    await page.route("**/api/v1/billing/plans", (route) => route.fulfill({ json: catalog }));
    await page.goto("/");
    await expect(page.locator(".lp-hero-pricing")).toContainText("$299 MXN/mes");
    catalog = { offer_revision: "tiered-after-rollout", tiered_pricing_enabled: true, available_plans: plans };
    await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
    await expect(page.locator(".lp-hero-pricing")).toContainText("Desde $399 MXN/mes");
    await expect(page.locator("body")).not.toContainText("299");
  });

}
