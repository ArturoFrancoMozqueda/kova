import { expect, test } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";

const session = {
  authenticated: true,
  user: { id: "user-1", email: "owner@example.com", tenant_id: "tenant-1", role: "owner" },
  tenant_id: "tenant-1", tenant_name: "Testing",
};
const capabilities = {
  enabled: true, inference_ready: false, configuration: false,
  documents: false, email: false, role: "owner",
};

test.beforeEach(async ({ page }) => {
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: session }));
  await page.route("**/api/v1/billing/subscription", route => route.fulfill({ json: {
    plan: { name: "Standard Plan", amount_minor_units: 29900, currency: "MXN", interval: "month" },
    subscription: null,
    access: { allowed: true, reason: "active", trialing: false, trial_ends_at: null, blocked_at: null, recovery_path: "/settings/billing" },
  } }));
  for (const path of ["catalog/products", "catalog/categories", "catalog/modifier-groups", "inventory/stock"]) {
    await page.route(`**/api/v1/${path}`, route => route.fulfill({ json: [] }));
  }
});

test("disabled cohort keeps the companion and assistant navigation hidden", async ({ page }) => {
  let capabilityRead = false;
  await page.route("**/api/v1/assistant/capabilities", route => {
    capabilityRead = true;
    return route.fulfill({ json: { ...capabilities, enabled: false } });
  });
  await page.goto("/dashboard");
  await expect.poll(() => capabilityRead).toBe(true);
  await expect(page.getByRole("button", { name: "Abrir asistente Kova" })).toHaveCount(0);
  await expect(page.locator('a[href="/assistant"]')).toHaveCount(0);
});

for (const width of [1280, 320]) {
  test(`companion preserves a private draft across routes without inference at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 800 });
    const writes: string[] = [];
    page.on("request", request => {
      if (request.url().includes("/api/v1/assistant/") && request.method() !== "GET") writes.push(request.method());
    });
    await page.route("**/api/v1/assistant/capabilities", route => route.fulfill({ json: capabilities }));
    await page.route("**/api/v1/assistant/preferences", route => route.fulfill({ json: {
      chat_consent: true, document_consent: false, email_opt_in: false, frequency: "weekly",
    } }));
    await page.route("**/api/v1/assistant/usage", route => route.fulfill({ json: {
      tenant_used: 0, tenant_limit: 8000, user_used: 0, user_limit: 6000, reset_at: "2026-10-07T00:00:00Z",
    } }));
    await page.goto("/dashboard?range=private");
    await page.getByRole("button", { name: "Abrir asistente Kova" }).click();
    const panel = page.getByRole("dialog", { name: "Asistente Kova" });
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard\?range=private$/);
    await expect(panel.getByText("La IA aún no está conectada.", { exact: false })).toBeVisible();
    await panel.getByLabel("Tu pregunta").fill("Borrador privado del negocio");
    await expect(panel.getByRole("button", { name: "Enviar pregunta" })).toBeDisabled();
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(width === 320 ? 568 : 800);
    await panel.getByLabel("Tu pregunta").press("Escape");
    await expect(page.getByRole("button", { name: "Abrir asistente Kova" })).toBeFocused();
    if (width === 320) {
      await page.getByRole("button", { name: /abrir men/i }).first().click();
      await expect(page.getByRole("button", { name: "Abrir asistente Kova" })).toBeHidden();
    }
    await page.locator('a[href="/catalog"]:visible').first().click();
    await expect(page).toHaveURL(/\/catalog$/);
    await page.getByRole("button", { name: "Abrir asistente Kova" }).click();
    await expect(panel.getByLabel("Tu pregunta")).toHaveValue("Borrador privado del negocio");
    await expect(panel.getByText("Testing · Catálogo")).toBeVisible();
    expect(writes).toEqual([]);
    expect(await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)]
      .some(value => value.includes("Borrador privado del negocio")))).toBe(false);
  });
}
