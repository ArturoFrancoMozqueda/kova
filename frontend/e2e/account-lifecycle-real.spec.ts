import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";
import { createTenantThroughUi, integrationEnabled } from "./integration-helpers";
import { markFirstUseToursSeen } from "./helpers";

test.describe("portabilidad y eliminación reversible con API y PostgreSQL reales", () => {
  test.skip(!integrationEnabled(), "Requiere el stack local desechable");

  for (const width of [390, 1440]) {
    test(`el dueño exporta y cancela su eliminación a ${width}px`, async ({ page, baseURL }, testInfo) => {
      test.setTimeout(120_000);
      // These actions must never schedule deletion on a hosted business.
      expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL!).hostname);
      await page.setViewportSize({ width, height: 1000 });
      const credentials = await createTenantThroughUi(page, `account-lifecycle-${width}`);
      const sessionResponse = await page.request.get("/api/v1/auth/session");
      expect(sessionResponse.status()).toBe(200);
      const session = await sessionResponse.json();
      await markFirstUseToursSeen(page, session.tenant_id);

      await page.goto("/settings/business-profile");
      await page.getByRole("navigation", { name: "Secciones de configuración" })
        .getByRole("link", { name: "Formato y zona horaria", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Tus datos y tu cuenta", exact: true })).toBeVisible();

      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Descargar exportación", exact: true }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/^kova-export-.*\.zip$/);
      const path = await download.path();
      expect(path).not.toBeNull();
      const archive = await readFile(path!);
      expect(archive.subarray(0, 4).toString("hex")).toBe("504b0304");
      expect(archive.byteLength).toBeGreaterThan(200);

      const submit = page.getByRole("button", { name: "Programar eliminación", exact: true });
      await expect(submit).toBeDisabled();
      await page.getByLabel(`Escribe “${session.tenant_name}” para confirmar`, { exact: true })
        .fill(session.tenant_name);
      await page.getByLabel("Contraseña actual", { exact: true }).fill(credentials.password);
      const scheduledAfter = Date.now();
      const scheduledPromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === "/api/v1/account/deletion"
        && response.request().method() === "POST");
      await submit.click();
      const scheduledResponse = await scheduledPromise;
      expect(scheduledResponse.status()).toBe(200);
      const scheduled = await scheduledResponse.json();
      expect(scheduled.status).toBe("pending");
      expect(Date.parse(scheduled.purge_after)).toBeGreaterThanOrEqual(scheduledAfter + 30 * 86400_000);

      await page.reload();
      const cancel = page.getByRole("button", { name: "Cancelar eliminación", exact: true });
      await expect(cancel).toBeVisible();
      const canceledPromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === "/api/v1/account/deletion"
        && response.request().method() === "DELETE");
      await cancel.click();
      const canceledResponse = await canceledPromise;
      expect(canceledResponse.status()).toBe(200);
      expect((await canceledResponse.json()).status).toBe("canceled");
      await page.reload();
      await expect(submit).toBeDisabled();
      await expect(cancel).toHaveCount(0);
      const finalState = await page.request.get("/api/v1/account/deletion");
      expect(finalState.status()).toBe(200);
      expect((await finalState.json()).status).toBe("none");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`account-lifecycle-${width}.png`), fullPage: true });
    });
  }
});
