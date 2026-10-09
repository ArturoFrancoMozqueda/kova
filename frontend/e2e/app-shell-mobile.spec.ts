import { expect, test, type Page } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";

async function openShell(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: {
    authenticated: true,
    user: { id: "user-1", email: "owner@example.com", tenant_id: "tenant-1", role: "owner" },
    tenant_id: "tenant-1", tenant_name: "Mi negocio",
  } }));
  await page.route("**/api/v1/billing/subscription", (route) => route.fulfill({ json: {
    plan: { name: "Standard Plan", amount_minor_units: 29900, currency: "MXN", interval: "month" },
    subscription: null,
    access: { allowed: true, reason: "active", trialing: false, trial_ends_at: null,
      blocked_at: null, recovery_path: "/settings/billing" },
  } }));
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "Abrir menú de navegación" }).first()).toBeVisible();
}

test("closed mobile navigation stays out of the tab order and accessibility tree", async ({ page }) => {
  await openShell(page);
  await expect(page.getByRole("link", { name: "Catálogo", exact: true })).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Abrir menú de navegación" }).first()).toBeFocused();
});

test("mobile drawer manages focus, traps Tab and restores the trigger on Escape", async ({ page }) => {
  await openShell(page);
  const trigger = page.getByRole("button", { name: "Abrir menú de navegación" }).first();
  await trigger.focus();
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Navegación de la cuenta" });
  await expect(drawer).toBeFocused();
  await expect(page.getByRole("link", { name: "Saltar al contenido" })).toHaveCount(0);

  await drawer.getByRole("button", { name: "Cerrar sesión" }).focus();
  await page.keyboard.press("Tab");
  await expect(drawer.getByRole("button", { name: "Cerrar menú de navegación" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(drawer.getByRole("button", { name: "Cerrar sesión" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("drawer can navigate and desktop resize makes the sidebar operable", async ({ page }) => {
  await openShell(page);
  await page.getByRole("button", { name: "Abrir menú de navegación" }).first().click();
  await page.getByRole("dialog").getByRole("link", { name: "Catálogo", exact: true }).click();
  await expect(page).toHaveURL(/\/catalog$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole("link", { name: "Catálogo", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Contraer menú" }).click();
  await expect(page.getByRole("button", { name: "Expandir menú" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("link", { name: "Catálogo", exact: true })).toHaveCount(0);
});

test("support opened from the drawer receives focus and returns to the menu trigger", async ({ page }) => {
  await openShell(page);
  const trigger = page.getByRole("button", { name: "Abrir menú de navegación" }).first();
  await trigger.click();
  await page.getByRole("dialog").getByRole("button", { name: "Ayuda y soporte" }).click();
  const support = page.getByRole("dialog", { name: "¿Necesitas ayuda?" });
  await expect(support).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(support).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
