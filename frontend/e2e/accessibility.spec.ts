import { createRequire } from "node:module";
import { expect, test, type Page } from "./fixtures";
import { createTenantThroughUi, integrationEnabled } from "./integration-helpers";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");

type AxeViolation = {
  id: string;
  impact: string | null;
  help: string;
  nodes: Array<{ target: string[]; failureSummary?: string }>;
};

async function expectNoSeriousAxeViolations(page: Page, surface: string) {
  // A visible entering modal can still have transitional opacity. Measure the
  // rendered state after finite transitions; leave infinite animations alone.
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((animation) =>
      animation.playState === "running"
      && animation.effect?.getComputedTiming().endTime !== Infinity
    );
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
  });
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => {
    const axe = (window as typeof window & {
      axe: {
        run: (context: Document, options: object) => Promise<{ violations: AxeViolation[] }>;
      };
    }).axe;
    const result = await axe.run(document, {
      resultTypes: ["violations"],
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
      rules: { "color-contrast": { enabled: true } },
    });
    return result.violations.filter((item) =>
      item.impact === "critical" || item.impact === "serious"
    );
  });

  expect(violations, `${surface}: ${JSON.stringify(violations, null, 2)}`).toEqual([]);
}

test.describe("axe en Chromium contra el stack real", () => {
  test.skip(!integrationEnabled(), "Requiere docker-compose.test.yml");

  test("avisos públicos de acceso conservan contraste en pantallas pequeñas", async ({ page }) => {
    const email = `audit-auth-feedback-${Date.now()}@example.com`;
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/reset-password");
      await expect(page.getByRole("alert")).toBeVisible();
      await expectNoSeriousAxeViolations(page, `Enlace incompleto ${width}px`);

      await page.goto("/login");
      await page.getByLabel(/^correo$/i).fill(email);
      await page.getByLabel(/^contraseña$/i).fill("Wrong-Local-Password-2026");
      await page.getByRole("button", { name: /^iniciar sesión$/i }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await expectNoSeriousAxeViolations(page, `Credenciales incorrectas ${width}px`);

      await page.goto("/forgot-password");
      await page.getByLabel(/^correo$/i).fill(email);
      await page.getByRole("button", { name: /enviar instrucciones/i }).click();
      await expect(page.getByRole("status")).toBeVisible();
      await expectNoSeriousAxeViolations(page, `Instrucciones de recuperación ${width}px`);
    }
  });

  test("login y vistas operativas no tienen violaciones críticas/serias", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: /iniciar sesi[oó]n/i })).toBeVisible();
    await expectNoSeriousAxeViolations(page, "Login");

    await createTenantThroughUi(page, "axe");
    const surfaces = [
      ["Caja", "/register"],
      ["Catálogo", "/catalog"],
      ["Ventas", "/orders"],
      ["Análisis", "/reports"],
      ["Settings", "/settings"],
    ] as const;

    for (const [name, path] of surfaces) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectNoSeriousAxeViolations(page, name);
    }
  });

  test("modales financieros conservan contraste y semántica", async ({ page }) => {
    await createTenantThroughUi(page, "axe-modal");
    await page.goto("/shifts");
    const openRegister = page.getByRole("button", { name: /^abrir turno$/i });
    await expect(openRegister).toBeVisible();
    await openRegister.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoSeriousAxeViolations(page, "Modal financiero de apertura de caja");
  });
});
