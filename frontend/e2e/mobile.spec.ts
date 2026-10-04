import { type Page, expect, test } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";

const OWNER_SESSION = {
  authenticated: true,
  user: { id: "user-1", email: "owner@bakery.com", tenant_id: "tenant-1", role: "owner" },
  tenant_id: "tenant-1",
  tenant_name: "Bakery",
};

const PRODUCT = {
  id: "product-1",
  tenant_id: "tenant-1",
  category_id: null,
  name: "Concha",
  description: null,
  sku: "CON-001",
  price_amount: "18.50",
  track_inventory: false,
  low_stock_threshold: null,
  is_active: true,
  modifier_groups: [],
};

const STOCK_ITEM = {
  product_id: "product-1",
  product_name: "Concha",
  sku: "CON-001",
  track_inventory: true,
  stock_on_hand: 2,
  low_stock_threshold: 6,
  is_low_stock: true,
};

const STANDARD_PLAN = {
  name: "Standard Plan",
  amount_minor_units: 29900,
  currency: "MXN",
  interval: "month",
};

const ACTIVE_ACCESS = {
  allowed: true,
  reason: "signup_trial",
  trialing: true,
  trial_ends_at: "2026-05-25T00:00:00Z",
  blocked_at: null,
  recovery_path: "/settings/billing",
};

function makeStoryPayload(overrides = {}) {
  return {
    summary: {
      start_date: "2026-05-13",
      end_date: "2026-05-19",
      timezone: "America/Mexico_City",
      gross_sales: "180.00",
      refund_total: "0.00",
      net_sales: "180.00",
      completed_orders: 6,
      average_ticket: "30.00",
      refund_count: 0,
      cancellation_count: 0,
    },
    executive_summary: "",
    sales_by_day: [
      { date: "2026-05-13", net_sales: "50.00", order_count: 2, average_ticket: "25.00", sales_share_pct: 28 },
      { date: "2026-05-14", net_sales: "130.00", order_count: 4, average_ticket: "32.50", sales_share_pct: 72 },
    ],
    sales_by_daypart: [
      { key: "madrugada", label: "Madrugada", start_hour: 0, end_hour: 5, net_sales: "0.00", order_count: 0, average_ticket: "0.00", sales_share_pct: 0 },
      { key: "manana", label: "Manana", start_hour: 6, end_hour: 11, net_sales: "30.00", order_count: 1, average_ticket: "30.00", sales_share_pct: 17 },
      { key: "tarde", label: "Tarde", start_hour: 12, end_hour: 17, net_sales: "150.00", order_count: 5, average_ticket: "30.00", sales_share_pct: 83 },
      { key: "noche", label: "Noche", start_hour: 18, end_hour: 23, net_sales: "0.00", order_count: 0, average_ticket: "0.00", sales_share_pct: 0 },
    ],
    peak_hour: {
      hour: 15,
      label: "15:00-16:00",
      daypart_key: "tarde",
      net_sales: "90.00",
      order_count: 3,
      sales_share_pct: 50,
    },
    top_product_by_sales: {
      product_id: "product-1",
      product_name: "Concha",
      quantity_sold: 10,
      gross_sales: "180.00",
      sales_share_pct: 100,
    },
    top_product_by_units: {
      product_id: "product-1",
      product_name: "Concha",
      quantity_sold: 10,
      gross_sales: "180.00",
      sales_share_pct: 100,
    },
    product_drivers: [
      {
        product_id: "product-1",
        product_name: "Concha",
        quantity_sold: 10,
        gross_sales: "180.00",
        sales_share_pct: 100,
      },
    ],
    dominant_payment: {
      method: "cash",
      amount: "180.00",
      payment_count: 6,
      sales_share_pct: 100,
    },
    payment_mix: [
      {
        method: "cash",
        amount: "180.00",
        payment_count: 6,
        sales_share_pct: 100,
      },
    ],
    operational_signals: [],
    recommended_actions: [
      {
        type: "opportunity",
        title: "Refuerza operacion en tarde",
        detail: "Este bloque concentra 83% de tus ventas del periodo.",
      },
    ],
    sales_by_employee: [
      {
        user_id: "user-1",
        display_name: "owner",
        order_count: 6,
        net_sales: "180.00",
        refund_count: 0,
      },
    ],
    refunds_by_reason: [],
    ...overrides,
  };
}

function makeSyncResponse(clientUuid: string, orderId: string, total: string) {
  return {
    results: [
      {
        client_uuid: clientUuid,
        status: "synced",
        order_id: orderId,
        order: {
          id: orderId,
          tenant_id: "tenant-1",
          status: "completed",
          subtotal_amount: total,
          total_amount: total,
          items: [],
          payments: [],
        },
        error: null,
      },
    ],
  };
}

async function mockCommon(
  page: Page,
  options: {
    viewport?: { width: number; height: number };
    billingAccess?: Record<string, unknown>;
    subscription?: Record<string, unknown> | null;
    stock?: unknown[];
    lowStock?: unknown[];
  } = {},
) {
  await page.setViewportSize(options.viewport ?? { width: 390, height: 844 });
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: OWNER_SESSION }));
  await page.route("**/api/v1/catalog/products", (route) => route.fulfill({ json: [PRODUCT] }));
  await page.route("**/api/v1/catalog/categories", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/inventory/stock", (route) => route.fulfill({ json: options.stock ?? [] }));
  await page.route("**/api/v1/inventory/low-stock", (route) => route.fulfill({ json: options.lowStock ?? [] }));
  await page.route("**/api/v1/inventory/velocity", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/inventory/movements**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/shifts/current", (route) => route.fulfill({ json: null }));
  await page.route("**/api/v1/telemetry/events", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/v1/settings/business-profile", (route) =>
    route.fulfill({
      json: {
        tenant_id: "tenant-1",
        public_name: "Bakery",
        support_email: "owner@bakery.com",
        support_phone: null,
        timezone: "America/Mexico_City",
        locale: "es-MX",
        currency: "MXN",
      },
    }),
  );
  await page.route("**/api/v1/billing/subscription", (route) =>
    route.fulfill({
      json: {
        plan: STANDARD_PLAN,
        subscription: options.subscription ?? null,
        access: options.billingAccess ?? ACTIVE_ACCESS,
      },
    }),
  );
  await page.route("**/api/v1/onboarding/state", (route) =>
    route.fulfill({
      json: {
        tenant_id: "tenant-1",
        completed_count: 1,
        total_count: 7,
        steps: [
          { key: "business_profile", label: "Confirma los datos de tu cafetería", completed: false, action_path: "/settings/business-profile" },
          { key: "first_product", label: "Agrega tu primer producto vendible", completed: true, action_path: "/catalog?new=product" },
          { key: "open_shift", label: "Abre tu primer turno de caja", completed: false, action_path: "/shifts" },
        ],
      },
    }),
  );
}

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const report = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const offenders = Array.from(document.querySelectorAll("body *"))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
        return {
          tag: el.tagName.toLowerCase(),
          className: typeof el.className === "string" ? el.className : "",
          text,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((item) => item.width > 0 && (item.left < -1 || item.right > viewportWidth + 1))
      .sort((a, b) => Math.max(b.right - viewportWidth, -b.left) - Math.max(a.right - viewportWidth, -a.left))
      .slice(0, 8);

    return {
      viewportWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      hasOverflow: document.documentElement.scrollWidth > viewportWidth,
      offenders,
    };
  });

  expect(report.hasOverflow, JSON.stringify(report, null, 2)).toBe(false);
}

async function expectMobileSidebarClosed(page: Page) {
  await page.waitForFunction(() => Boolean(document.querySelector("aside, [role='complementary']")));
  const sidebar = await page.evaluate(() => {
    const aside = document.querySelector("aside, [role='complementary']");
    const rect = aside?.getBoundingClientRect();
    return rect
      ? { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) }
      : null;
  });

  expect(sidebar, "App shell sidebar should exist").not.toBeNull();
  expect(sidebar?.right, JSON.stringify(sidebar, null, 2)).toBeLessThanOrEqual(1);
}

async function expectMobileTaskNavigation(page: Page) {
  await expect(page.getByRole("navigation", { name: /navegaci/i }).last()).toBeVisible();
  await expectMobileSidebarClosed(page);
}

async function mockReports(page: Page) {
  await page.route("**/api/v1/reports/business-story**", (route) =>
    route.fulfill({ json: makeStoryPayload() }),
  );
  await page.route("**/api/v1/reports/sales-by-hour**", (route) =>
    route.fulfill({
      json: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        net_sales: hour === 15 ? "90.00" : hour === 16 ? "60.00" : "0.00",
        order_count: hour === 15 ? 3 : hour === 16 ? 2 : 0,
      })),
    }),
  );
}

test("public landing fits common phone and tablet widths", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: { authenticated: false } }));

  for (const viewport of [
    { width: 320, height: 844 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: /probar kova gratis|prueba kova 7 días gratis/i }).first(),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    if (viewport.width < 768) {
      const heroContent = page.locator(".lp-hero-content");
      const heroVisual = page.locator(".lp-hero-visual");
      const heroCta = page.locator('.lp-hero-actions a[href="/signup"]').first();
      await expect(heroContent).toBeVisible();
      await expect(heroCta).toBeVisible();
      const [contentBox, visualBox, ctaBox] = await Promise.all([
        heroContent.boundingBox(),
        heroVisual.boundingBox(),
        heroCta.boundingBox(),
      ]);
      expect(contentBox).not.toBeNull();
      expect(visualBox).not.toBeNull();
      expect(ctaBox).not.toBeNull();
      expect(contentBox!.y).toBeLessThan(visualBox!.y);
      expect(ctaBox!.y + ctaBox!.height).toBeLessThanOrEqual(viewport.height);
      await expect(page.getByRole("link", { name: "Producto" })).toBeHidden();
      await expect(page.getByRole("link", { name: "Precio" })).toBeHidden();
    }
  }
});

test("public landing uses one continuous Kova ink canvas", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: { authenticated: false } }),
  );
  await page.goto("/");
  await expect(page.locator(".lp-root")).toBeVisible();

  const backgrounds = await page.evaluate(() => {
    const color = (selector: string) =>
      getComputedStyle(document.querySelector<HTMLElement>(selector)!).backgroundColor;
    return {
      body: getComputedStyle(document.body).backgroundColor,
      root: color(".lp-root"),
      hero: color(".lp-hero-section"),
      problem: color("#problema"),
      navigation: color(".lp-nav"),
    };
  });

  expect(backgrounds.body).toBe("rgb(15, 17, 23)");
  expect(backgrounds.root).toBe(backgrounds.body);
  expect(backgrounds.hero).toBe(backgrounds.body);
  expect(backgrounds.problem).toBe(backgrounds.body);
  expect(backgrounds.navigation).not.toBe("rgb(255, 255, 255)");
});

test("mobile landing uses the vertical product film without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: { authenticated: false } }));
  await page.goto("/");
  await expect(page.locator(".lp-root")).toHaveClass(/lp-motion-ready/);

  const story = page.locator("#producto");
  await story.scrollIntoViewIfNeeded();
  const video = story.getByLabel("Demostración de Kova: venta, inventario, caja y análisis");
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute("src", "/film/kova-demo-vertical.mp4");
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => new URL(element.currentSrc).pathname))
    .toBe("/film/kova-demo-vertical.mp4");
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.videoHeight > element.videoWidth))
    .toBe(true);
  await expect(story.getByRole("button", { name: "Reproducir" })).toBeVisible();
  await expect(story.getByRole("button", { name: "Activar sonido" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("landing switches the active film when the viewport becomes mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: { authenticated: false } }),
  );
  await page.goto("/");

  const video = page
    .locator("#producto")
    .getByLabel("Demostración de Kova: venta, inventario, caja y análisis");
  await expect(video).toHaveAttribute("src", "/film/kova-demo-horizontal.mp4");

  await page.setViewportSize({ width: 390, height: 844 });

  await expect(video).toHaveAttribute("src", "/film/kova-demo-vertical.mp4");
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => new URL(element.currentSrc).pathname))
    .toBe("/film/kova-demo-vertical.mp4");
});

test("desktop product film controls stay navigable without horizontal overlap", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: { authenticated: false } }));
  await page.goto("/");
  await expect(page.locator(".lp-root")).toHaveClass(/lp-motion-ready/);

  const story = page.locator("#producto");
  await story.scrollIntoViewIfNeeded();
  const video = story.getByLabel("Demostración de Kova: venta, inventario, caja y análisis");
  await expect(video).toHaveAttribute("src", "/film/kova-demo-horizontal.mp4");
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => new URL(element.currentSrc).pathname))
    .toBe("/film/kova-demo-horizontal.mp4");
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth > element.videoHeight))
    .toBe(true);
  const controls = story.getByRole("group", { name: "Controles del video" }).getByRole("button");
  await expect(controls).toHaveCount(2);
  await controls.nth(1).focus();
  await expect(controls.nth(1)).toBeFocused();
  await expectNoHorizontalOverflow(page);
});

test("mobile hero and story share the signup destination", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: { authenticated: false } }),
  );
  await page.goto("/");
  await expect(page.locator(".lp-root")).toHaveClass(/lp-motion-ready/);

  const heroCta = page.locator('.lp-hero-actions a[href="/signup"]').first();
  const storyCta = page.locator('#producto a[href="/signup"]');
  await expect(heroCta).toBeVisible();
  await expect(storyCta).toHaveCount(1);
  await heroCta.click();
  await expect(page).toHaveURL(/\/signup$/);
});

test("mobile product and pricing CTAs remain reachable without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: { authenticated: false } }),
  );
  await page.goto("/");
  await expect(page.locator(".lp-root")).toHaveClass(/lp-motion-ready/);

  const storyCta = page.locator('#producto a[href="/signup"]');
  await storyCta.scrollIntoViewIfNeeded();
  await expect(storyCta).toBeVisible();

  const pricingCta = page.locator('#precio a[href="/signup"]');
  await pricingCta.scrollIntoViewIfNeeded();
  await expect(pricingCta).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("landing product film waits for manual playback under reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: { authenticated: false } }),
  );
  await page.goto("/");
  await expect(page.locator(".lp-root")).toHaveClass(/lp-motion-ready/);

  // El hero y la demostración conservan sus pósteres y no arrancan movimiento
  // hasta que la persona lo solicita explícitamente.
  await expect(page.locator(".lp-hero-frame")).toBeVisible();
  const story = page.locator("#producto");
  await story.scrollIntoViewIfNeeded();
  const video = story.getByLabel("Demostración de Kova: venta, inventario, caja y análisis");
  await expect(video).toBeVisible();
  await expect(story.locator("picture img")).toBeVisible();
  await expect(story.getByRole("button", { name: "Reproducir" })).toBeVisible();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
});

test("orders render as cards at 390px without horizontal overflow", async ({ page }) => {
  await mockCommon(page);
  await page.route("**/api/v1/orders?**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "order-1",
            tenant_id: "tenant-1",
            status: "completed",
            total_amount: "18.50",
            created_at: "2026-05-18T10:00:00Z",
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      },
    }),
  );
  await page.goto("/orders");
  await expect(page.getByRole("link", { name: /\$18\.50/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("register dashboard and billing fit at 390px", async ({ page }) => {
  await mockCommon(page);
  await mockReports(page);
  await page.route("**/api/v1/reports/sales-summary**", (route) =>
    route.fulfill({
      json: {
        gross_sales: "0.00",
        refund_total: "0.00",
        net_sales: "0.00",
        order_count: 0,
        refund_count: 0,
        void_count: 0,
      },
    }),
  );
  await page.route("**/api/v1/reports/payment-breakdown**", (route) =>
    route.fulfill({ json: { payments: [] } }),
  );
  await page.route("**/api/v1/reports/top-products**", (route) =>
    route.fulfill({ json: { products: [] } }),
  );
  await page.route("**/api/v1/reports/sales-by-hour**", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/reports/sales-by-employee**", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/reports/refunds-by-reason**", (route) =>
    route.fulfill({ json: [] }),
  );

  for (const path of ["/register", "/dashboard", "/reports", "/settings/billing"]) {
    await page.goto(path);
    if (path === "/dashboard") {
      await expect(page.getByText(/Agrega tu primer producto vendible|Agrega productos vendibles/i)).toBeVisible();
    }
    if (path !== "/settings/billing") {
      await expectMobileSidebarClosed(page);
    }
    await expectNoHorizontalOverflow(page);
  }
});

test("billing banner stays visible and usable on phone and tablet", async ({ page }) => {
  await mockCommon(page, {
    billingAccess: {
      allowed: false,
      reason: "trial_expired",
      trialing: false,
      trial_ends_at: "2026-01-01T00:00:00Z",
      blocked_at: "2026-05-01T00:00:00Z",
      recovery_path: "/settings/billing",
    },
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/register");

    const banner = page.getByTestId("billing-banner");
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("link", { name: /administrar suscripci/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Agregar Concha" })).toBeVisible();
    await expectMobileTaskNavigation(page);
    await expectNoHorizontalOverflow(page);
  }
});

test("PWA update prompt stays above mobile task navigation", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockCommon(page);
  await page.goto("/dashboard");

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("pos:pwa-update-available"));
  });

  const prompt = page.getByRole("status").filter({ hasText: "Nueva versión disponible" });
  const taskNavigation = page.locator("nav.fixed.inset-x-0.bottom-0");
  await expect(prompt).toBeVisible();
  await expect(taskNavigation).toBeVisible();

  const [promptBox, navigationBox] = await Promise.all([
    prompt.boundingBox(),
    taskNavigation.boundingBox(),
  ]);
  expect(promptBox).not.toBeNull();
  expect(navigationBox).not.toBeNull();
  expect(promptBox!.y + promptBox!.height).toBeLessThanOrEqual(navigationBox!.y);

  await prompt.getByRole("button", { name: "Más tarde" }).click();
  await expect(prompt).toHaveCount(0);
});

test("reports filters fit mobile and keep the primary CTA visible", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockCommon(page);
  await mockReports(page);

  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Análisis", exact: true })).toBeVisible();

  // On phones the manual range hides behind "Personalizar" so the first
  // screen leads with data; presets stay one tap away.
  // Restock coverage has its own day selector; target the report period explicitly.
  await expect(page.getByRole("group", { name: "Periodo de análisis" })
    .getByRole("button", { name: /7 días/i })).toBeVisible();
  await expect(page.getByLabel(/^desde$/i)).toBeHidden();
  await page.getByRole("button", { name: /personalizar/i }).click();
  await expect(page.getByRole("button", { name: /aplicar/i })).toBeVisible();
  await page.getByLabel(/^desde$/i).fill("2026-05-13");
  await page.getByLabel(/^hasta$/i).fill("2026-05-19");
  await page.getByRole("button", { name: /aplicar/i }).click();

  await expect(page.getByText(/ventas netas/i).first()).toBeVisible();
  await expect(page.getByText(/Tarde/).first()).toBeVisible();
  // Dashboard layout: the priority action reads before scrolling into charts;
  // the old chapter-chip navigation is gone with the narrative acts.
  await expect(page.getByTestId("priority-recommendation")).toBeVisible();
  await expectMobileTaskNavigation(page);
  await expectNoHorizontalOverflow(page);

  // Tablet and up: the manual range is always visible, no toggle needed.
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.getByRole("button", { name: /aplicar/i })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("register quick sale keeps CTAs above mobile navigation", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockCommon(page);
  // A cash sale needs an open drawer (product decision); override the default
  // no-shift mock so the quick cash sale is allowed. Registered after
  // mockCommon so this handler takes precedence.
  await page.route("**/api/v1/shifts/current", (route) =>
    route.fulfill({ json: { id: "shift-mobile", tenant_id: "tenant-1", status: "open" } }),
  );
  await page.route("**/api/v1/sync/offline-sales", async (route) => {
    expect(route.request().method()).toBe("POST");
    const body = route.request().postDataJSON() as {
      sales: Array<{ client_uuid: string }>;
    };
    await route.fulfill({
      json: makeSyncResponse(body.sales[0].client_uuid, "10000000-0000-4000-8000-000000000004", "18.50"),
    });
  });

  await page.goto("/register");
  await expect(page.getByRole("heading", { name: /cat.logo/i }).first()).toBeVisible();
  await page.getByRole("button", { name: "Agregar Concha" }).click();

  const stickyCheckout = page.locator("button", { hasText: /cobrar/i }).first();
  await expect(stickyCheckout).toBeVisible();
  await expect(page.getByLabel(/efectivo recibido/i)).toBeVisible();
  await page.getByLabel(/efectivo recibido/i).fill("20.00");
  await expect(page.getByRole("button", { name: /^cobrar$/i })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: /^cobrar$/i }).click();
  await expect(page.getByRole("dialog", { name: /venta completada/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /nueva venta/i })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("register sale summary fits the zoom-equivalent 1024-1279px band", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockCommon(page, { viewport: { width: 1272, height: 700 } });
  await page.route("**/api/v1/shifts/current", (route) =>
    route.fulfill({ json: { id: "shift-zoom", tenant_id: "tenant-1", status: "open" } }),
  );
  await page.goto("/register");

  const addProduct = page.getByRole("button", { name: "Agregar Concha" });
  await addProduct.click();
  const summary = page.getByRole("dialog", { name: "Resumen de venta" });
  await expect(summary).toBeVisible();
  await expect(page.getByText("Concha", { exact: true }).last()).toBeVisible();
  await expect(page.getByRole("radio", { name: "Efectivo" })).toBeVisible();

  const box = await summary.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1272);
  await expectMobileSidebarClosed(page);
  await expectMobileTaskNavigation(page);
  await expectNoHorizontalOverflow(page);

  await page.keyboard.press("Escape");
  await expect(summary).toHaveCount(0);
  await expect(addProduct).toBeFocused();
});

test("first-use guidance stays clear of the desktop checkout and exits cleanly", async ({ page }) => {
  await mockCommon(page, { viewport: { width: 1536, height: 960 } });

  await page.goto("/register");

  const tour = page.getByTestId("first-use-tour");
  const cart = page.getByLabel("Carrito");
  await expect(tour).toBeVisible();
  await expect(cart).toBeVisible();

  const [tourBox, cartBox] = await Promise.all([tour.boundingBox(), cart.boundingBox()]);
  expect(tourBox).not.toBeNull();
  expect(cartBox).not.toBeNull();
  expect(tourBox!.x + tourBox!.width).toBeLessThanOrEqual(cartBox!.x);

  await page.getByRole("button", { name: "Entendido" }).click();
  await expect(tour).toHaveCount(0);
});

test("first-use guidance respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockCommon(page);

  await page.goto("/register");

  const tour = page.getByTestId("first-use-tour");
  await expect(tour).toBeVisible();

  const animationDurationMs = await tour.locator("section").evaluate((element) => {
    const duration = window.getComputedStyle(element).animationDuration;
    return duration.endsWith("ms") ? Number.parseFloat(duration) : Number.parseFloat(duration) * 1000;
  });
  expect(animationDurationMs).toBeLessThanOrEqual(0.02);

  await page.getByRole("button", { name: "Entendido" }).click();
  await expect(tour).toHaveCount(0);
});

test("cash checkout waits for interaction before showing an error on common phone widths", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockCommon(page);
  await page.route("**/api/v1/shifts/current", (route) =>
    route.fulfill({ json: { id: "shift-cro-3", tenant_id: "tenant-1", status: "open" } }),
  );

  const telemetryEvents: Array<{ event_name?: string; properties?: Record<string, unknown> }> = [];
  await page.route("**/api/v1/telemetry/events", async (route) => {
    telemetryEvents.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });

  for (const viewport of [
    { width: 320, height: 844 },
    { width: 390, height: 844 },
  ]) {
    telemetryEvents.length = 0;
    await page.setViewportSize(viewport);
    await page.goto("/register");
    await page.getByRole("button", { name: "Agregar Concha" }).click();

    const cashInput = page.getByLabel(/efectivo recibido/i);
    const chargeButton = page.getByRole("button", { name: /^cobrar$/i });
    await expect(cashInput).toBeVisible();
    await expect(
      page.getByText(/ingresa el efectivo recibido o elige un monto rápido/i),
    ).toBeVisible();
    await expect(page.getByText(/aún no cubre el total/i)).toHaveCount(0);
    await expect(cashInput).not.toHaveAttribute("aria-invalid", "true");
    await expect(chargeButton).toHaveAttribute("aria-disabled", "true");
    expect(telemetryEvents).toHaveLength(0);

    // A shorter visual viewport approximates the space left by an open mobile
    // keyboard. The payment selector and CTA must remain reachable in-sheet.
    await cashInput.focus();
    await page.setViewportSize({ width: viewport.width, height: 500 });
    const paymentSelector = page.getByRole("radiogroup", { name: /método de pago/i });
    await paymentSelector.scrollIntoViewIfNeeded();
    await expect(paymentSelector).toBeVisible();

    // Playwright treats aria-disabled as non-actionable. Scroll the CTA into
    // the safe area and send a real pointer event to verify the touch path.
    await chargeButton.scrollIntoViewIfNeeded();
    const chargeBox = await chargeButton.boundingBox();
    expect(chargeBox).not.toBeNull();
    expect(chargeBox!.y + chargeBox!.height).toBeLessThanOrEqual(500 - 56);
    await page.mouse.click(
      chargeBox!.x + chargeBox!.width / 2,
      chargeBox!.y + chargeBox!.height / 2,
    );
    await expect(page.getByText(/aún no cubre el total/i)).toBeVisible();
    await expect(cashInput).toHaveAttribute("aria-invalid", "true");
    await expect.poll(() => telemetryEvents.filter(
      (event) => event.event_name === "sale_validation_blocked",
    )).toHaveLength(1);
    expect(telemetryEvents.find(
      (event) => event.event_name === "sale_validation_blocked",
    )?.properties).toMatchObject({
      field: "cash_tendered",
      reason_code: "insufficient_cash",
      device_class: "mobile",
      viewport_bucket: viewport.width < 360 ? "mobile_320" : "mobile_390",
    });

    await cashInput.fill("20.00");
    await expect(page.getByText(/cambio/i).last()).toBeVisible();
    await expect(page.getByText(/\$1\.50/).first()).toBeVisible();
    await expect(chargeButton).toHaveAttribute("aria-disabled", "false");
    await expectNoHorizontalOverflow(page);
  }
});

test("inventory low-stock workflow fits phone and tablet", async ({ page }) => {
  await mockCommon(page, {
    stock: [STOCK_ITEM],
    lowStock: [STOCK_ITEM],
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/inventory");

    await expect(page.getByRole("heading", { name: /inventario/i })).toBeVisible();
    await expect(page.getByText(/stock bajo/i).first()).toBeVisible();
    await expect(page.getByText("2 disponible, umbral 6.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ajustar stock: Concha" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ajustar", exact: true })).toBeVisible();
    await page.getByLabel(/filtrar inventario/i).selectOption("low");
    await expect(page.getByRole("heading", { name: "Concha" })).toBeVisible();
    await expectMobileTaskNavigation(page);
    await expectNoHorizontalOverflow(page);
  }
});

test("catalog fits at 390px with category and product visible", async ({ page }) => {
  await mockCommon(page);
  await page.route("**/api/v1/catalog/categories", (route) =>
    route.fulfill({
      json: [{ id: "cat-1", tenant_id: "tenant-1", name: "Pan", description: null, sort_order: 0, is_active: true }],
    }),
  );
  await page.route("**/api/v1/catalog/modifier-groups", (route) => route.fulfill({ json: [] }));

  await page.goto("/catalog");
  await expect(page.getByRole("heading", { name: "Catálogo", exact: true })).toBeVisible();
  await expect(page.getByText("Concha")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("inventory fits at 390px with empty state", async ({ page }) => {
  await mockCommon(page);
  await page.route("**/api/v1/inventory/movements**", (route) => route.fulfill({ json: [] }));

  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "Inventario", exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("shifts fits at 390px with no open shift", async ({ page }) => {
  await mockCommon(page);
  await page.route(/\/api\/v1\/shifts(\?|$)/, (route) => route.fulfill({ json: [] }));

  await page.goto("/shifts");
  await expect(page.getByRole("heading", { name: /turnos/i })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
