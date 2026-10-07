import { expect, test } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";
import axe from "axe-core";

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

for (const width of [1440, 768, 390, 320]) {
  test(`assistant formats real response payloads and remains usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    if (width === 390) await page.emulateMedia({ reducedMotion: "reduce" });
    const writes: { path: string; body: unknown }[] = [];
    let sent = false;
    let completed = false;
    const answer = "### Lo que encontré\n\nHay **ventas completadas** en el periodo consultado. Las tarjetas muestran los resultados registrados.\n\n### Siguiente paso\n\n- Revisa los productos que contribuyen a tus ventas.\n- Comprueba las existencias antes de reponer.";
    const chatMessages = () => sent ? [
      { id: "question-a", data: { role: "user", content: "Revisa mis ventas de este mes" } },
      ...(completed ? [{ id: "answer-a", data: { role: "assistant", content: answer } }] : []),
    ] : [];
    await page.route("**/api/v1/assistant/**", route => {
      const request = route.request();
      const path = new URL(request.url()).pathname.split("/assistant")[1];
      if (request.method() !== "GET") writes.push({ path, body: request.postDataJSON() });
      if (path === "/conversations/chat-a/messages") sent = true;
      if (path === "/runs/run-a") completed = true;
      const json = path === "/capabilities" ? { ...capabilities, inference_ready: true }
        : path === "/preferences" ? { chat_consent: true, document_consent: false, email_opt_in: false, frequency: "weekly" }
        : path === "/usage" ? { tenant_used: 100, tenant_limit: 8000, user_used: 100, user_limit: 6000, reset_at: "2026-10-08T00:00:00Z" }
        : path === "/conversations" ? request.method() === "POST" ? { id: "chat-a", data: {} } : sent ? [{ id: "chat-a", data: { title: "Revisa mis ventas de este mes" } }] : []
        : path === "/conversations/chat-a" ? { messages: chatMessages() }
        : path === "/conversations/chat-a/messages" ? { id: "run-a", status: "queued", data: {} }
        : path === "/runs/run-a" ? { id: "run-a", status: "completed", data: {
          metrics: { net_sales: "1250.50", gross_sales: "1350.50", refund_total: "100.00", order_count: 12, start_date: "2026-10-01", end_date: "2026-10-07" },
          cards: [{ kind: "get_top_products", data: { products: [{ product_id: "p-a", product_name: "Café de especialidad", quantity_sold: 8, gross_sales: "480.00" }], start_date: "2026-10-01", end_date: "2026-10-07" } }],
          sources: [{ id: "s-a", title: "Guía de ventas", page: 1, path: "/help/sales" }],
        } } : [];
      return route.fulfill({ json });
    });
    await page.goto("/assistant");
    await expect(page.getByRole("heading", { name: "¿Qué quieres resolver hoy?" })).toBeVisible();
    await page.screenshot({ path: `test-results/assistant-welcome-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Revisa mis ventas de este mes" }).click();
    const field = page.getByRole("textbox", { name: "Tu pregunta" });
    await expect(field).toHaveValue("Revisa mis ventas de este mes");
    expect(writes).toEqual([]);
    await field.press("Enter");
    await expect(page.getByRole("heading", { name: "Lo que encontré" })).toBeVisible();
    const logBox = await page.getByRole("log").boundingBox();
    const answerBox = await page.getByRole("heading", { name: "Lo que encontré" }).boundingBox();
    expect(answerBox!.y).toBeGreaterThanOrEqual(logBox!.y);
    expect(answerBox!.y).toBeLessThan(logBox!.y + logBox!.height);
    await expect(page.getByRole("region", { name: "Resultados de ventas" })).toContainText("$1,250.50");
    await expect(page.getByRole("region", { name: "Productos más vendidos" })).toContainText("Café de especialidad");
    await page.screenshot({ path: `test-results/assistant-response-${width}.png`, fullPage: true });
    await page.getByText("Fuentes consultadas · 1").click();
    await expect(page.getByRole("link", { name: "Guía de ventas · Página 1" })).toHaveAttribute("href", "/help/sales");
    await expect(page.getByRole("button", { name: "Copiar respuesta" })).toBeVisible();
    expect(writes.find(write => write.path.endsWith("/messages"))?.body).toEqual({ content: "Revisa mis ventas de este mes" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `test-results/assistant-answer-${width}.png`, fullPage: true });
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      const engine = (window as unknown as { axe: { run: (context: string) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> } }).axe;
      const result = await engine.run("main");
      return result.violations.filter(violation => ["serious", "critical"].includes(violation.impact));
    });
    expect(violations).toEqual([]);
  });
}

test("floating assistant formats a response, restores focus and preserves its continuation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  let sent = false;
  await page.route("**/api/v1/assistant/**", route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.split("/assistant")[1];
    if (path === "/conversations/chat-a/messages") sent = true;
    const json = path === "/capabilities" ? { ...capabilities, inference_ready: true }
      : path === "/preferences" ? { chat_consent: true, document_consent: false, email_opt_in: false, frequency: "weekly" }
      : path === "/usage" ? { tenant_used: 100, tenant_limit: 8000, user_used: 100, user_limit: 6000, reset_at: "2026-10-08T00:00:00Z" }
      : path === "/conversations" ? { id: "chat-a", data: {} }
      : path === "/conversations/chat-a/messages" ? { id: "run-a", status: "queued", data: {} }
      : path === "/conversations/chat-a" ? { messages: sent ? [
        { id: "question-a", data: { role: "user", content: "Revisa mis ventas" } },
        { id: "answer-a", data: { role: "assistant", content: "### Tus resultados\n\nHay **ventas registradas**. Revisa las tarjetas para ver los importes exactos." } },
      ] : [] }
      : path === "/runs/run-a" ? { id: "run-a", status: "completed", data: { metrics: { net_sales: "125.50", order_count: 2, start_date: "2026-10-01", end_date: "2026-10-07" } } }
      : [];
    return route.fulfill({ json });
  });
  await page.goto("/catalog");
  await page.getByRole("button", { name: "Abrir asistente Kova" }).click();
  const panel = page.getByRole("dialog", { name: "Asistente Kova" });
  await panel.getByRole("textbox", { name: "Tu pregunta" }).fill("Revisa mis ventas");
  await panel.getByRole("textbox", { name: "Tu pregunta" }).press("Enter");
  await expect(panel.getByRole("heading", { name: "Tus resultados" })).toBeVisible();
  await expect(panel.getByRole("region", { name: "Resultados de ventas" })).toContainText("$125.50");
  await expect(panel.getByRole("button", { name: "Copiar respuesta" })).toBeVisible();
  await expect(panel.getByRole("link", { name: "Abrir asistente completo" })).toHaveAttribute("href", "/assistant?conversation=chat-a&run=run-a");
  await page.screenshot({ path: "test-results/assistant-companion.png", fullPage: true });
  await panel.getByRole("textbox", { name: "Tu pregunta" }).press("Escape");
  await expect(page.getByRole("button", { name: "Abrir asistente Kova" })).toBeFocused();
  await expect(page).toHaveURL(/\/catalog$/);
});
