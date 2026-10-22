import { expect, test } from "./fixtures";

// Fault injection must reach page.route on every reload. Service-worker
// precache fetches bypass that route and could recover the real asset instead.
// Service-worker/offline behavior remains covered by the dedicated PWA suites.
test.use({ serviceWorkers: "block" });

const authAsset =
  /\/(?:assets\/AuthView-[^/]+\.js|src\/auth\/AuthView\.tsx)(?:\?|$)/;

test.beforeEach(async ({ page, baseURL }) => {
  expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL!).hostname);
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: { authenticated: false } }),
  );
  await page.route("**/api/v1/auth/refresh", (route) =>
    route.fulfill({ status: 401, json: { detail: "No refresh token" } }),
  );
});

test("recovers a missing login chunk once and preserves cookies and queued offline data", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    { name: "recovery_test_cookie", value: "keep", url: baseURL! },
  ]);
  await page.goto("/");
  await page.evaluate(async () => {
    sessionStorage.setItem("recovery_test_form", "keep");
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("kova-recovery-test", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("queued");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("queued", "readwrite");
        tx.objectStore("queued").put(
          { id: "sale-test", idempotency_key: "keep" },
          "sale-test",
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  let attempts = 0;
  let documents = 0;
  page.on("request", (request) => {
    if (
      request.isNavigationRequest() &&
      request.frame() === page.mainFrame() &&
      new URL(request.url()).pathname === "/login"
    )
      documents++;
  });
  await page.route(authAsset, (route) => {
    attempts++;
    return attempts === 1
      ? route.fulfill({
          status: 404,
          contentType: "text/javascript",
          body: "",
          headers: { "Cache-Control": "no-store" },
        })
      : route.continue();
  });
  await page.goto("/login?return=%2Fdashboard#keep");
  await expect(page.getByLabel("Correo", { exact: true })).toBeVisible();
  expect(attempts).toBe(2);
  expect(documents).toBe(2);
  expect(new URL(page.url()).search).toBe("?return=%2Fdashboard");
  expect(new URL(page.url()).hash).toBe("#keep");
  expect(
    (await context.cookies()).find(
      (cookie) => cookie.name === "recovery_test_cookie",
    )?.value,
  ).toBe("keep");
  const persisted = await page.evaluate(async () => ({
    form: sessionStorage.getItem("recovery_test_form"),
    sale: await new Promise<unknown>((resolve, reject) => {
      const open = indexedDB.open("kova-recovery-test");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const read = db
          .transaction("queued")
          .objectStore("queued")
          .get("sale-test");
        read.onsuccess = () => {
          db.close();
          resolve(read.result);
        };
        read.onerror = () => reject(read.error);
      };
    }),
  }));
  expect(persisted).toEqual({
    form: "keep",
    sale: { id: "sale-test", idempotency_key: "keep" },
  });
});

test("a persistently missing login chunk stops after one automatic recovery across reloads", async ({
  page,
}) => {
  let attempts = 0;
  let documents = 0;
  page.on("request", (request) => {
    if (
      request.isNavigationRequest() &&
      request.frame() === page.mainFrame() &&
      new URL(request.url()).pathname === "/login"
    )
      documents++;
  });
  await page.route(authAsset, (route) => {
    attempts++;
    return route.fulfill({
      status: 404,
      contentType: "text/javascript",
      body: "",
      headers: { "Cache-Control": "no-store" },
    });
  });
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Actualiza Kova para continuar" }),
  ).toBeVisible();
  // The second failed document has already consumed the persisted guard.
  await expect.poll(() => attempts).toBe(2);
  expect(documents).toBe(2);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Actualiza Kova para continuar" }),
  ).toBeVisible();
  expect(attempts).toBe(3);
  expect(documents).toBe(3);
  await expect(
    page.getByRole("button", { name: "Recargar", exact: true }),
  ).toBeVisible();
});
