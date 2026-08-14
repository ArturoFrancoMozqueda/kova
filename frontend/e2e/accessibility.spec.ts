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
    const openRegister = page.getByRole("button", { name: /abrir caja/i });
    await expect(openRegister).toBeVisible();
    await openRegister.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoSeriousAxeViolations(page, "Modal financiero de apertura de caja");
  });
});
