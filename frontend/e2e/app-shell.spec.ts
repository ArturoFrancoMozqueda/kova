import { expect, test } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";

const authenticatedOwner = {
  authenticated: true,
  user: {
    id: "user-1",
    email: "owner@example.com",
    tenant_id: "tenant-1",
    role: "owner",
  },
  tenant_id: "tenant-1",
  tenant_name: "Testing",
};

const billingAllowed = {
  plan: { name: "Standard Plan", amount_minor_units: 29900, currency: "MXN", interval: "month" },
  subscription: null,
  access: {
    allowed: true,
    reason: "active",
    trialing: false,
    trial_ends_at: null,
    blocked_at: null,
    recovery_path: "/settings/billing",
  },
};

test("skip link is first in tab order and moves focus to the content area", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({ json: authenticatedOwner });
  });
  await page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({ json: billingAllowed });
  });
  await page.route("**/api/v1/catalog/products", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/catalog/categories", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/inventory/stock", (route) => route.fulfill({ json: [] }));

  await page.goto("/dashboard");
  await expect(page.getByRole("navigation").first()).toBeVisible();

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Saltar al contenido" });
  await expect(skipLink).toBeFocused();

  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.id))
    .toBe("contenido-principal");
});

test("desktop sidebar crossfades labels without losing link names", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({ json: authenticatedOwner });
  });
  await page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({ json: billingAllowed });
  });
  await page.route("**/api/v1/catalog/products", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/catalog/categories", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/inventory/stock", (route) => route.fulfill({ json: [] }));

  await page.goto("/dashboard");

  const dashboardLink = page.getByRole("navigation").first().locator('a[href="/dashboard"]');
  const dashboardLabel = dashboardLink.getByText("Panel", { exact: true });
  await expect(dashboardLabel).toHaveAttribute("aria-hidden", "false");

  await page.getByRole("button", { name: /contraer men/i }).click();
  await expect(dashboardLink).toHaveAttribute("title", "Panel");
  await expect(dashboardLabel).toHaveAttribute("aria-hidden", "true");
  await expect(dashboardLabel).toHaveCSS("opacity", "0");

  await page.getByRole("button", { name: /expandir men/i }).click();
  await expect(dashboardLabel).toHaveAttribute("aria-hidden", "false");
  await expect(dashboardLabel).toHaveCSS("opacity", "1");
});

test("task workspaces stay simple and keyboard-accessible in the compact rail", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: authenticatedOwner }));
  await page.route("**/api/v1/billing/subscription", route => route.fulfill({ json: billingAllowed }));
  await page.route("**/api/v1/purchasing/suppliers", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/purchasing/orders?*", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/operations/queue", route => route.fulfill({ json: { generated_at: "2026-10-22T18:00:00Z", sections: [] } }));
  await page.goto("/dashboard");
  const nav = page.locator("aside nav");
  await expect(nav.getByRole("link")).toHaveCount(7);
  for (const name of ["Panel", "Caja", "Ventas", "Clientes", "Operación", "Análisis", "Configuración"]) {
    await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole("button")).toHaveCount(0);
  await nav.getByRole("link", { name: "Operación", exact: true }).click();
  await expect(nav.getByRole("heading", { name: "En esta sección: Operación", exact: true })).toBeVisible();
  for (const path of ["/catalog", "/inventory", "/purchasing", "/replenishment"]) {
    await expect(nav.locator(`a[href="${path}"]`)).toBeVisible();
  }
  for (const link of await nav.getByRole("link").all()) await expect(link).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("navigation-expanded-top.png"), animations: "disabled" });
  await nav.getByRole("link").last().scrollIntoViewIfNeeded();
  await expect(nav.getByRole("link").last()).toBeInViewport();
  await expect(page.locator("aside").getByRole("button", { name: "Cerrar sesión", exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("navigation-expanded-end.png"), animations: "disabled" });

  await page.getByRole("button", { name: /contraer men/i }).click();
  const purchasing = nav.getByRole("link", { name: "Compras y proveedores", exact: true });
  await expect(purchasing).toBeVisible();
  await expect(purchasing).toHaveAttribute("title", "Compras y proveedores");
  await expect(nav.locator('a[href="/orders"]')).toHaveAccessibleName("Ventas");
  await expect(nav.getByRole("button")).toHaveCount(0);
  await purchasing.focus();
  await expect(purchasing).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/purchasing$/);
  await expect(purchasing).toHaveAttribute("aria-current", "page");

  // Direct deep links select their task scope and retain the rail preference.
  await page.reload();
  await expect(purchasing).toHaveAttribute("aria-current", "page");
  await expect(purchasing).toHaveAttribute("title", "Compras y proveedores");
  await page.getByRole("button", { name: /expandir men/i }).click();
  await expect(nav.getByRole("heading", { name: "En esta sección: Operación", exact: true })).toBeVisible();
  await expect(purchasing).toHaveAttribute("aria-current", "page");
});

test("catalog owns the desktop product search without a global command bar", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: authenticatedOwner }),
  );
  await page.route("**/api/v1/billing/subscription", (route) =>
    route.fulfill({ json: billingAllowed }),
  );
  await page.route("**/api/v1/catalog/products", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/catalog/categories", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/catalog/modifier-groups", (route) => route.fulfill({ json: [] }));

  await page.goto("/dashboard");
  await expect(page.locator("#global-product-search")).toHaveCount(0);
  const contentBox = await page.locator("#contenido-principal").boundingBox();
  expect(Math.round(contentBox?.y ?? -1)).toBe(0);

  await page.goto("/catalog");
  await expect(page.locator("#global-product-search")).toHaveCount(0);
  await expect(page.locator("#catalog-product-search")).toBeVisible();
});

test("public landing explains the single Standard Plan", async ({ page }) => {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({ json: { authenticated: false } });
  });

  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: /vende\. kova mantiene el resto bajo control/i,
    }),
  ).toBeVisible();
  await expect(page.getByText(/299/).first()).toBeVisible();
  await expect(page.getByText(/199/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /un solo plan/i })).toBeVisible();
});

test("protected routes redirect unauthenticated users to login", async ({ page }) => {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({ json: { authenticated: false } });
  });

  await page.goto("/dashboard");

  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("heading", { name: /iniciar sesi.n/i })).toBeVisible();
});

test("public landing suppresses app update prompts", async ({ page }) => {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({ json: { authenticated: false } });
  });

  await page.goto("/");

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("pos:pwa-update-available"));
  });

  await expect(page.getByRole("status")).toHaveCount(0);
});
