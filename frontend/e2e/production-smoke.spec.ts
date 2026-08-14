import { expect, test, type Page } from "./fixtures";

const smokeEmail = process.env.PRODUCTION_SMOKE_EMAIL;
const smokePassword = process.env.PRODUCTION_SMOKE_PASSWORD;
const smokeTenantId = process.env.PRODUCTION_SMOKE_TENANT_ID;
const mutationsAuthorized = process.env.PRODUCTION_SMOKE_ALLOW_MUTATIONS === "1";
const smokeProductName = process.env.PRODUCTION_SMOKE_PRODUCT_NAME;
const smokeClientUuid = process.env.PRODUCTION_SMOKE_CLIENT_UUID;
const smokeReference = process.env.PRODUCTION_SMOKE_REFERENCE;

test.describe.configure({ mode: "serial" });

function requireEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required for production smoke tests`);
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isDeclaredTelemetry(url: string): boolean {
  const parsed = new URL(url);
  return (
    parsed.pathname.startsWith("/_vercel/insights") ||
    parsed.hostname.endsWith(".sentry.io") ||
    parsed.hostname.endsWith(".ingest.sentry.io")
  );
}

function watchRuntime(page: Page) {
  const errors: string[] = [];
  const requestIds: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console ${page.url()} :: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror ${page.url()} :: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (!isDeclaredTelemetry(request.url())) {
      errors.push(
        `requestfailed ${request.method()} ${request.url()} :: ${request.failure()?.errorText}`,
      );
    }
  });
  page.on("response", (response) => {
    if (!response.url().includes("/api/")) return;
    const requestId = response.headers()["x-request-id"];
    if (requestId) requestIds.push(requestId);
    else errors.push(`missing x-request-id ${response.request().method()} ${response.url()}`);
    if (response.status() >= 500) {
      errors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  return { errors, requestIds };
}

async function expectHealthyRuntime(runtime: ReturnType<typeof watchRuntime>) {
  expect(runtime.errors, `Runtime errors:\n${runtime.errors.join("\n")}`).toEqual([]);
  expect(runtime.requestIds.length, "Expected correlated API responses with x-request-id").toBeGreaterThan(0);
}

async function login(page: Page) {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /log in|iniciar sesi.n/i })).toBeVisible();
  await page.getByLabel(/email|correo/i).fill(requireEnv("PRODUCTION_SMOKE_EMAIL", smokeEmail));
  await page.getByLabel(/password|contrase.a/i).fill(
    requireEnv("PRODUCTION_SMOKE_PASSWORD", smokePassword),
  );
  await page.getByRole("button", { name: /log in|iniciar sesi.n/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const session = await page.evaluate(async () => {
    const response = await fetch("/api/v1/auth/session", { credentials: "include" });
    return {
      ok: response.ok,
      requestId: response.headers.get("x-request-id"),
      body: await response.json(),
    };
  });
  expect(session.ok).toBeTruthy();
  expect(session.requestId).toBeTruthy();
  expect(session.body).toMatchObject({
    authenticated: true,
    tenant_id: requireEnv("PRODUCTION_SMOKE_TENANT_ID", smokeTenantId),
  });
}

test("landing, login, session refresh, and billing read are healthy", async ({ page }) => {
  const runtime = watchRuntime(page);

  await page.goto("/");
  const landingText = await page.locator("body").innerText();
  expect(landingText).toMatch(/kova|tu negocio|crear cuenta|create account/i);
  expect(landingText).toContain("299");
  expect(landingText).not.toContain("199");

  await login(page);
  const refresh = await page.evaluate(async () => {
    const csrf = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith("csrf_token="))
      ?.split("=")[1];
    const response = await fetch("/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {},
    });
    return { ok: response.ok, requestId: response.headers.get("x-request-id") };
  });
  expect(refresh).toMatchObject({ ok: true });
  expect(refresh.requestId).toBeTruthy();

  await page.goto("/settings/billing");
  await expect(page.getByRole("heading", { name: /billing|facturaci.n|suscripci.n/i })).toBeVisible();
  await expect(page.locator("body")).toContainText(/MX\$299\.00|299/, { timeout: 15_000 });
  expect(await page.locator("body").innerText()).not.toContain("199");

  await expectHealthyRuntime(runtime);
});

test("catalog, inventory, shifts, orders, and reports load read-only", async ({ page }) => {
  const runtime = watchRuntime(page);
  await login(page);

  for (const path of ["/catalog", "/inventory", "/shifts", "/orders", "/reports"]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`${path.replace("/", "\\/")}(?:$|\\?)`));
    await expect(page.getByRole("heading").first()).toBeVisible();
  }

  await expectHealthyRuntime(runtime);
});

test("authorized smoke sale is idempotent, identifiable, and exposes its receipt", async ({ page }, testInfo) => {
  const runtime = watchRuntime(page);

  if (!mutationsAuthorized) {
    testInfo.annotations.push({
      type: "mutation-policy",
      description: "Read-only smoke: PRODUCTION_SMOKE_ALLOW_MUTATIONS is not 1",
    });
    await login(page);
    await page.goto("/reports");
    await expect(page.getByRole("heading").first()).toBeVisible();
    await expectHealthyRuntime(runtime);
    return;
  }

  const clientUuid = requireEnv("PRODUCTION_SMOKE_CLIENT_UUID", smokeClientUuid);
  await page.addInitScript((uuid) => {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: () => uuid,
    });
  }, clientUuid);

  await login(page);
  await page.goto("/shifts");
  await expect(page.getByText(/active shift|turno activo/i)).toBeVisible();

  await page.goto("/register");
  const productName = requireEnv("PRODUCTION_SMOKE_PRODUCT_NAME", smokeProductName);
  const addProduct = page.getByRole("button", {
    name: new RegExp(`^(add|agregar) ${escapeRegExp(productName)}$`, "i"),
  });
  await expect(addProduct).toBeVisible();
  await addProduct.click();
  await page.getByRole("radio", { name: /bank transfer|transferencia/i }).check();
  const reference = requireEnv("PRODUCTION_SMOKE_REFERENCE", smokeReference);
  await page.getByLabel(/reference|referencia/i).fill(reference);

  const syncResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/sync/offline-sales") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /complete sale|completar venta|^cobrar$/i }).click();
  const syncResponse = await syncResponsePromise;
  expect(syncResponse.ok()).toBeTruthy();
  expect(syncResponse.headers()["x-request-id"]).toBeTruthy();
  const syncPayload = syncResponse.request().postDataJSON() as {
    sales: Array<{ client_uuid: string; order: { payments: Array<{ reference?: string }> } }>;
  };
  expect(syncPayload.sales[0]?.client_uuid).toBe(clientUuid);
  expect(syncPayload.sales[0]?.order.payments[0]?.reference).toBe(reference);

  const openOrder = page.getByRole("link", { name: /open order|abrir/i });
  await expect(openOrder).toBeVisible();
  await openOrder.click();
  await expect(page).toHaveURL(/\/orders\//);
  await expect(page.getByText(/receipt|recibo|total/i).first()).toBeVisible();
  await page.goto("/reports");
  await expect(page.getByRole("heading").first()).toBeVisible();

  testInfo.annotations.push({ type: "smoke-reference", description: reference });
  await expectHealthyRuntime(runtime);
});

test("logout clears the production session", async ({ page }) => {
  const runtime = watchRuntime(page);
  await login(page);

  await page.getByRole("button", { name: /cerrar sesi.n|log out/i }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);

  await expectHealthyRuntime(runtime);
});
