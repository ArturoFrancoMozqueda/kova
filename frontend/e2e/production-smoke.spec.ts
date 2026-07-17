import { expect, test, type Page } from "@playwright/test";

const productionSmokeEnabled = process.env.PRODUCTION_SMOKE === "1";
const smokeEmail = process.env.PRODUCTION_SMOKE_EMAIL;
const smokePassword = process.env.PRODUCTION_SMOKE_PASSWORD;
const expectedStripeMode = process.env.PRODUCTION_SMOKE_STRIPE_MODE ?? "test";

test.skip(!productionSmokeEnabled, "Set PRODUCTION_SMOKE=1 to run production smoke checks.");
test.describe.configure({ mode: "serial" });

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is required for production smoke tests`);
  }
  return value;
}

function watchConsole(page: Page) {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !page.url().includes("checkout.stripe.com")) {
      consoleErrors.push(`${page.url()} :: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    if (page.url().includes("checkout.stripe.com")) return;
    consoleErrors.push(`${page.url()} :: ${error.message}`);
  });
  return consoleErrors;
}

async function login(page: Page) {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /log in|iniciar sesi.n/i })).toBeVisible();
  await page.getByLabel(/email/i).fill(requireEnv("PRODUCTION_SMOKE_EMAIL", smokeEmail));
  await page.getByLabel(/password|contrase.a/i).fill(
    requireEnv("PRODUCTION_SMOKE_PASSWORD", smokePassword),
  );
  await page.getByRole("button", { name: /log in|iniciar sesi.n/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function expectNoConsoleErrors(consoleErrors: string[]) {
  expect(consoleErrors, `Console/page errors:\n${consoleErrors.join("\n")}`).toEqual([]);
}

test("landing, login, dashboard, and billing are production healthy", async ({ page }) => {
  const consoleErrors = watchConsole(page);

  await page.goto("/");
  const landingText = await page.locator("body").innerText();
  expect(landingText).toMatch(/kova|tu negocio|crear cuenta|create account/i);
  expect(landingText).toContain("299");
  expect(landingText).not.toContain("199");

  await login(page);
  await expect(page.getByRole("heading")).toBeVisible();

  await page.goto("/settings/billing");
  await expect(page.getByRole("heading", { name: /billing|facturaci.n/i })).toBeVisible();
  await expect(page.locator("body")).toContainText(/MX\$299\.00|299/, { timeout: 15_000 });
  const billingText = await page.locator("body").innerText();
  expect(billingText).not.toContain("199");

  await expectNoConsoleErrors(consoleErrors);
});

test("receipt settings load and save in production", async ({ page }) => {
  const consoleErrors = watchConsole(page);
  await login(page);

  await page.goto("/settings/receipt");
  await expect(page.getByRole("heading", { name: /ajustes del recibo|receipt settings/i })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/no configurado|not configured/i);

  const receiptName = page.locator("form input").first();
  await expect(receiptName).toBeVisible();
  const currentName = await receiptName.inputValue();
  await receiptName.fill(currentName || "Kova Smoke Receipt");
  await page.getByRole("button", { name: /guardar recibo|save receipt/i }).click();
  await expect(page.getByText(/guardado|saved/i)).toBeVisible();

  await expectNoConsoleErrors(consoleErrors);
});

test("core owner workspaces load and logout clears the production session", async ({ page }) => {
  const consoleErrors = watchConsole(page);
  await login(page);

  for (const path of [
    "/catalog",
    "/inventory",
    "/shifts",
    "/orders",
    "/settings/employees",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`${path.replace("/", "\\/")}(?:$|\\?)`));
    await expect(page.getByRole("heading").first()).toBeVisible();
  }

  await page.getByRole("button", { name: /cerrar sesi.n|log out/i }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);

  await expectNoConsoleErrors(consoleErrors);
});

test("production checkout redirects to the expected Stripe Checkout mode", async ({ page }) => {
  const consoleErrors = watchConsole(page);
  await login(page);
  await page.goto("/settings/billing");

  await expectNoConsoleErrors(consoleErrors);
  await page.getByRole("button", { name: /start checkout|checkout|pagar|suscrib/i }).click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });

  const checkoutUrl = page.url();
  expect(checkoutUrl).toContain("checkout.stripe.com");
  expect(checkoutUrl).not.toContain("checkout.stripe.test");
  if (expectedStripeMode === "live") {
    expect(checkoutUrl).not.toContain("cs_test");
  } else {
    expect(checkoutUrl).toContain("cs_test");
  }
});

test("register can create a smoke cash sale, receipt, and report data", async ({ page }, testInfo) => {
  const consoleErrors = watchConsole(page);
  await login(page);
  await page.goto("/register");

  await expect(page.getByRole("heading", { name: /register|caja/i })).toBeVisible();
  const addButtons = page.getByRole("button", { name: /^Add /i });
  await expect(addButtons.first()).toBeVisible();
  await addButtons.first().click();

  const tendered = page.getByLabel(/cash tendered|efectivo recibido/i);
  await expect(tendered).toBeVisible();
  await tendered.fill("100.00");

  await page.getByRole("button", { name: /complete sale|completar venta/i }).click();
  await expect(page.getByRole("status")).toContainText(/completed|queued|venta/i);

  const openOrder = page.getByRole("link", { name: /open order|abrir/i });
  await expect(openOrder).toBeVisible();
  const href = await openOrder.getAttribute("href");
  expect(href).toMatch(/\/orders\//);
  testInfo.annotations.push({ type: "created-order-url", description: href ?? "" });

  await openOrder.click();
  await expect(page).toHaveURL(/\/orders\//);
  await expect(page.getByText(/receipt|recibo|total/i).first()).toBeVisible();

  await page.goto("/reports");

  await expect(page.getByRole("heading", { name: /reports|reportes/i })).toBeVisible();
  await expect(page.getByText(/net sales|ventas netas|gross sales|ventas brutas/i).first()).toBeVisible();
  await expect(page.getByText(/MX\$|orders|ventas|sales/i).first()).toBeVisible();

  await expectNoConsoleErrors(consoleErrors);
});
