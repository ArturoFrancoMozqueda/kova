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

test("categories open without navigation, persist and expand the compact rail with keyboard", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: authenticatedOwner }));
  await page.route("**/api/v1/billing/subscription", route => route.fulfill({ json: billingAllowed }));
  await page.route("**/api/v1/purchasing/suppliers", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/purchasing/orders?*", route => route.fulfill({ json: [] }));
  await page.goto("/dashboard");
  const nav = page.locator("aside nav");
  await expect(nav.getByRole("link")).toHaveCount(3);
  for (const name of ["Caja", "Ventas", "Panel"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  const group = nav.getByRole("button", { name: "Productos y operación", exact: true });
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await expect(nav.getByRole("link", { name: "Catálogo", exact: true })).toHaveCount(0);
  await group.focus(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(group).toHaveAttribute("aria-expanded", "true");
  const purchasing = nav.getByRole("link", { name: "Compras y proveedores", exact: true });
  await expect(purchasing).toBeVisible();
  await page.reload();
  await expect(group).toHaveAttribute("aria-expanded", "true");
  await nav.getByRole("button", { name: "Configuración", exact: true }).scrollIntoViewIfNeeded();
  await expect(nav.getByRole("link", { name: "Caja", exact: true })).toBeInViewport();
  await expect(nav.getByRole("link", { name: "Ventas", exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("navigation-groups-expanded.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Contraer menú", exact: true }).click();
  await expect(purchasing).toHaveCount(0);
  await expect(group).toHaveAttribute("title", "Productos y operación");
  await group.focus(); await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Contraer menú", exact: true })).toBeVisible();
  await expect(group).toBeFocused();
  await expect(purchasing).toBeVisible();
  await purchasing.click();
  await expect(page).toHaveURL(/\/purchasing$/);
  await expect(purchasing).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(purchasing).toHaveAttribute("aria-current", "page");
});

for (const role of ["owner", "manager", "cashier", "staff"]) {
  for (const width of [390, 768, 1440]) {
    test(`daily navigation stays visible for ${role} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await markFirstUseToursSeen(page);
      await page.route("**/api/v1/auth/session", route => route.fulfill({ json: {
        ...authenticatedOwner, user: { ...authenticatedOwner.user, role }, feature_flags: { customer_orders: true },
      } }));
      await page.route("**/api/v1/billing/subscription", route => route.fulfill({ json: billingAllowed }));
      await page.goto("/register");
      if (width < 1280) {
        const bottom = page.locator("nav").last();
        for (const name of ["Caja", "Pedidos", "Ventas"]) await expect(bottom.getByRole("link", { name, exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Abrir menú de navegación", exact: true }).first().click();
      }
      const nav = page.locator("aside nav");
      for (const name of ["Caja", "Pedidos", "Ventas"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
      if (role === "cashier" || role === "staff") {
        await expect(nav.getByRole("button")).toHaveCount(0);
        await expect(nav.getByRole("link", { name: "Clientes", exact: true })).toBeVisible();
        await expect(nav.locator('a[href="/settings/billing"]')).toHaveCount(0);
        await expect(nav.locator('a[href="/inventory"]')).toHaveCount(0);
      } else {
        const group = nav.getByRole("button", { name: "Configuración", exact: true });
        await group.click();
        if (role === "manager") await expect(nav.locator('a[href="/settings/billing"]')).toHaveCount(0);
        else await expect(nav.getByRole("link", { name: "Suscripción", exact: true })).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}

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
      name: /vende con orden\. conoce tu negocio\./i,
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
