import { appendFileSync, readFileSync } from "node:fs";
import { expect, test } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";

const fixture = process.env.KOVA_ASSISTANT_ACCEPTANCE_FIXTURE;
type Actor = { email: string; net_sales: string; tenant_id: string };

test.describe("asistente autenticado con API, Postgres y workers reales", () => {
  test.skip(process.env.KOVA_INTEGRATION !== "1" || !fixture, "Requiere el runner desechable del asistente");
  for (const [index, width] of [390, 1440].entries()) {
    test(`consulta, historial y logout a ${width}px`, async ({ page }) => {
      const actors = JSON.parse(readFileSync(fixture!, "utf8")) as Actor[];
      const actor = actors[index];
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/login");
      await page.getByLabel(/correo/i).fill(actor.email);
      await page.getByLabel(/contrase[ñn]a/i).fill("Kova-Acceptance-Only-2026!");
      const loginStarted = Date.now();
      await page.getByRole("button", { name: /iniciar sesi[oó]n/i }).click();
      await page.waitForURL(/\/dashboard$/);
      const loginMs = Date.now() - loginStarted;
      await markFirstUseToursSeen(page, actor.tenant_id);
      await page.goto("/assistant");
      const input = page.getByRole("textbox", { name: "Tu pregunta" });
      await input.fill("¿Cuánto vendí hoy?");
      const started = Date.now();
      await input.press("Enter");
      const amount = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(actor.net_sales));
      await expect(page.getByRole("region", { name: "Resultados de ventas" })).toContainText(amount, { timeout: 15000 });
      const responseMs = Date.now() - started;
      expect(responseMs).toBeLessThanOrEqual(10000);
      const reloadStarted = Date.now();
      await page.reload();
      await expect(page.getByRole("region", { name: "Resultados de ventas" })).toContainText(amount);
      const reloadMs = Date.now() - reloadStarted;
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/assistant-real-${width}.png`, fullPage: true });
      const logout = await page.request.post("/api/v1/auth/logout", {
        headers: { "X-CSRF-Token": await page.evaluate(() => decodeURIComponent(document.cookie.split("; ").find(value => value.startsWith("csrf_token="))?.slice("csrf_token=".length) ?? "")) },
      });
      expect(logout.status()).toBe(204);
      expect((await page.request.get("/api/v1/assistant/capabilities")).status()).toBe(401);
      const metrics = process.env.KOVA_ASSISTANT_ACCEPTANCE_METRICS;
      if (metrics) appendFileSync(metrics, `${JSON.stringify({ width, loginMs, responseMs, reloadMs })}\n`);
    });
  }
});
