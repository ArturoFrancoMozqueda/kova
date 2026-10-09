import { expect, test } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";

for (const width of [390, 1100, 1440]) {
  test(`drawer configuration and explicit test remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await markFirstUseToursSeen(page);
    await page.route("**/api/v1/auth/session", route => route.fulfill({ json: {
      authenticated: true, user: { id: "user-1", tenant_id: "tenant-1", email: "qa@example.com", role: "owner" },
      tenant_id: "tenant-1", tenant_name: "Negocio QA",
    } }));
    await page.route("**/api/v1/account/deletion**", route => route.fulfill({ json: { status: "none" } }));
    await page.route("**/api/v1/employees", route => route.fulfill({ json: [] }));
    await page.route("**/api/v1/employees/invitations", route => route.fulfill({ json: [] }));
    await page.route("**/api/v1/settings/business-profile", route => route.fulfill({ json: {
      tenant_id: "tenant-1", public_name: "Negocio QA", timezone: "America/Mexico_City",
      locale: "es-MX", currency: "MXN", support_email: null, support_phone: null,
    } }));
    await page.route("**/api/v1/settings/receipt", route => route.fulfill({ json: {
      tenant_id: "tenant-1", receipt_business_name: "Negocio QA", paper_width_mm: 80,
      logo_url: null, footer: null, tax_contact_text: null,
    } }));
    await page.route("**/api/v1/hardware/drawer", route => route.fulfill({ json: {
      configured: true, online: true, paired: true, auto_open: false, name: "Caja principal", pin: 0,
    } }));
    const commands: unknown[] = [];
    await page.route("**/api/v1/hardware/drawer/open", route => {
      commands.push(route.request().postDataJSON());
      return route.fulfill({ json: { id: "command-1", status: "sent" } });
    });
    await page.goto("/settings/receipt");
    await expect(page.getByRole("heading", { name: "Cajón de dinero" })).toBeVisible();
    await expect(page.getByLabel("Nombre del equipo de caja")).toHaveValue("Caja principal");
    const automatic = page.getByRole("checkbox", { name: /abrir al cobrar efectivo/i });
    await expect(automatic).not.toBeChecked();
    expect(commands).toHaveLength(0);
    await page.getByRole("button", { name: "Probar apertura" }).click();
    await expect(page.getByRole("status").filter({ hasText: /confirma que el cajón se abrió físicamente/i })).toBeVisible();
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ kind: "test", reason: "Prueba de configuración" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await page.screenshot({ path: `/private/tmp/kova-drawer-settings-${width}.png`, fullPage: true });
  });
}

test("cashier can open the drawer manually with a reason without creating a sale", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: {
    authenticated: true, user: { id: "user-1", tenant_id: "tenant-1", email: "qa@example.com", role: "cashier" },
    tenant_id: "tenant-1", tenant_name: "Negocio QA",
  } }));
  await page.route("**/api/v1/catalog/products", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/catalog/categories", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/shifts/current", route => route.fulfill({ json: { id: "shift-1", status: "open" } }));
  await page.route("**/api/v1/hardware/drawer", route => route.fulfill({ json: {
    configured: true, online: true, paired: true, auto_open: true, name: "Caja principal", pin: 0,
  } }));
  const commands: unknown[] = [];
  await page.route("**/api/v1/hardware/drawer/open", route => {
    commands.push(route.request().postDataJSON());
    return route.fulfill({ json: { id: "command-1", status: "sent" } });
  });
  await page.goto("/register");
  await page.getByRole("button", { name: "Abrir cajón" }).click();
  const confirm = page.getByRole("button", { name: "Confirmar apertura" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Motivo de apertura").fill("Dar cambio");
  await confirm.click();
  await expect(page.getByRole("status").filter({ hasText: /orden enviada al cajón/i })).toBeVisible();
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({ kind: "manual", reason: "Dar cambio" });
});
