import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import gateway, { coordinatorShard } from "../gateway.mjs";

test("dependent dashboard reads reuse the session coordinator with at most four lanes per cookie", () => {
  const groups = new Set();
  const chain = ["/api/v1/auth/session", "/api/v1/auth/refresh", "/api/v1/auth/logout",
    "/api/v1/settings/business-profile", "/api/v1/reports/business-story", "/api/v1/reports/dashboard",
    "/api/v1/reports/sales-summary", "/api/v1/reports/sales-by-hour"];
  const parallel = ["/api/v1/catalog/products", "/api/v1/inventory/stock",
    "/api/v1/inventory/low-stock", "/api/v1/onboarding/state", "/api/v1/employees",
    "/api/v1/shifts", "/api/v1/billing/subscription", "/api/v1/branches", "/api/v1/settings/receipt"];
  for (let index = 0; index < 128; index++) {
    const cookie = `synthetic-routing-cookie-${index}`;
    const critical = coordinatorShard(cookie, chain[0]);
    groups.add(critical);
    for (const path of chain) {
      assert.equal(coordinatorShard(cookie, path), critical);
      assert.equal(coordinatorShard(cookie, `${path}/`), critical);
    }
    const lanes = new Set([critical]);
    for (const path of parallel) {
      const shard = coordinatorShard(cookie, path);
      assert.ok(shard > critical && shard < critical + 4);
      assert.ok(shard >= 0 && shard < 16);
      lanes.add(shard);
    }
    assert.ok(lanes.size >= 3 && lanes.size <= 4);
  }
  assert.deepEqual([...groups].sort((a, b) => a - b), [0, 4, 8, 12]);
});

test("unknown scanner paths stay outside Python and the database", async () => {
  const env = { API: { getByName() { assert.fail("Unknown path entered Python"); } } };
  for (const path of ["/.env", "//.env.sample", "/web/.env", "/api/v10/auth", "/docs"]) {
    const response = await gateway.fetch(new Request(`https://api.test${path}`), env);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { detail: "Not Found" });
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
});

test("health, root and application routes retain their API handler", async () => {
  const env = { API: { getByName() { return { fetch: () => Response.json({ forwarded: true }) }; } } };
  for (const path of ["/", "/health", "/health/", "/health/db", "/health/db/",
    "/api/v1/auth/session", "/api/v1/billing/webhooks/stripe"]) {
    const response = await gateway.fetch(new Request(`https://api.test${path}`), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { forwarded: true });
  }
});

test("resident hosting routes all cookies and paths directly to one process", async () => {
  const objects = new Set();
  const env = { KOVA_NATIVE_BACKEND: "1", API: { getByName(name) {
    objects.add(name);
    return { async fetch(request) {
      assert.equal(request.headers.get("x-kova-client-ip"), "192.0.2.1");
      assert.equal(request.headers.has("x-forwarded-for"), false);
      return Response.json({ status: "ok" });
    } };
  } } };
  for (const cookie of ["", "access_token=synthetic-a", "access_token=synthetic-b"]) {
    for (const path of ["/health", "/api/v1/auth/session", "/api/v1/inventory/stock"]) {
      const response = await gateway.fetch(new Request(`https://api.test${path}`, {
        headers: { Cookie: cookie, "CF-Connecting-IP": "192.0.2.1", "X-Forwarded-For": "spoofed" },
      }), env);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("cache-control"), /no-store/);
    }
  }
  assert.deepEqual([...objects], ["api-0"]);
});

test("dashboard routes spread one cookie's reads while preserving private responses", async () => {
  const coordinators = new Set();
  const paths = ["/auth/session", "/settings/receipt", "/settings/business-profile",
    "/branches", "/billing/subscription", "/reports/business-story"];
  const env = { API: { getByName(name) {
    coordinators.add(name);
    return { async fetch(request) {
      assert.equal(request.headers.get("cookie"), "access_token=synthetic-test-cookie");
      assert.equal(request.headers.get("x-kova-client-ip"), "192.0.2.1");
      for (const header of ["fly-client-ip", "x-forwarded-for", "x-real-ip", "forwarded"]) {
        assert.equal(request.headers.has(header), false);
      }
      return Response.json({ path: new URL(request.url).pathname }, {
        headers: { "Set-Cookie": "csrf_token=synthetic-test; Secure; SameSite=Lax" },
      });
    } };
  } } };
  const responses = await Promise.all(paths.map(path => gateway.fetch(
    new Request(`https://api.test/api/v1${path}`, { headers: {
      Cookie: "access_token=synthetic-test-cookie", "CF-Connecting-IP": "192.0.2.1",
      "X-Forwarded-For": "spoofed", "Fly-Client-IP": "spoofed",
      "X-Real-IP": "spoofed", Forwarded: "spoofed",
    } }), env,
  )));
  assert.ok(coordinators.size >= 3, "dashboard reads must not share one serial queue");
  for (const [index, response] of responses.entries()) {
    assert.equal(response.status, 200);
    assert.equal((await response.json()).path, `/api/v1${paths[index]}`);
    assert.match(response.headers.get("cache-control"), /private, no-store/);
    assert.equal(response.headers.get("cloudflare-cdn-cache-control"), "no-store");
    assert.match(response.headers.get("set-cookie"), /csrf_token=synthetic-test/);
  }
});

test("the public gateway reuses only explicitly public versioned raster images across sessions", async t => {
  const entries = new Map();
  const previous = globalThis.caches;
  globalThis.caches = { default: {
    async match(key) { assert.deepEqual([...key.headers], []); return entries.get(key.url)?.clone(); },
    async put(key, response) { entries.set(key.url, response.clone()); },
  } };
  t.after(() => { if (previous === undefined) delete globalThis.caches; else globalThis.caches = previous; });
  let calls = 0;
  const env = { KOVA_NATIVE_BACKEND: "1", API: { getByName() {
    return { fetch(request) {
      calls++;
      assert.equal(request.headers.has("cookie"), false);
      assert.equal(request.headers.has("authorization"), false);
      assert.equal(request.headers.get("x-kova-client-ip"), "192.0.2.20");
      assert.equal(request.headers.has("x-real-ip"), false);
      assert.equal(request.headers.has("x-forwarded-for"), false);
      return new Response("synthetic-image", { headers: {
        "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400",
      } });
    } };
  } } };
  const url = "https://api.test/api/v1/catalog/products/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/image?v=123";
  const first = await gateway.fetch(new Request(url, { headers: {
    Cookie: "session=a", "CF-Connecting-IP": "192.0.2.20",
    "X-Kova-Client-IP": "198.51.100.99", "X-Real-IP": "198.51.100.99",
    "X-Forwarded-For": "198.51.100.99",
  } }), env);
  const second = await gateway.fetch(new Request(url, { headers: { Cookie: "session=b", Authorization: "Bearer b" } }), env);
  assert.equal(first.headers.get("x-kova-image-cache"), "MISS");
  assert.equal(second.headers.get("x-kova-image-cache"), "HIT");
  assert.equal(calls, 1);
  assert.equal(await second.text(), "synthetic-image");
});

test("the deployable gateway bundles its shared policy while retaining the native API binding", async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL("../gateway.mjs", import.meta.url))],
    bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022", external: ["node:*"] });
  const bundled = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  const env = { KOVA_NATIVE_BACKEND: "1", API: { getByName(name) {
    assert.equal(name, "api-0");
    return { fetch: () => new Response("image", { headers: {
      "Content-Type": "image/png", "Cache-Control": "public, max-age=86400",
    } }) };
  } } };
  const response = await bundled.default.fetch(new Request("https://api.test/api/v1/catalog/products/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/image?v=123&w=160"), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /^public, max-age=/);
});

const imageUrl = "https://api.test/api/v1/catalog/products/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/image?v=123&w=160";
function imageTimingEnv(timing, responseOverrides = {}) {
  const headers = { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400",
    ...(timing === undefined ? {} : { "Server-Timing": timing }), ...responseOverrides.headers };
  return { API: { getByName() { return { fetch: () => new Response("synthetic-image", {
    ...responseOverrides, headers,
  }) }; } } };
}

test("qualified public images preserve only bounded numerical stage timings and add the current API hop", async () => {
  const response = await gateway.fetch(new Request(imageUrl), imageTimingEnv(
    'image-resize;dur=17.250, private-db;dur=11;desc="synthetic-private", image-db;dur=0001.200, image-cache;dur=0',
  ));
  assert.match(response.headers.get("server-timing"),
    /^image-db;dur=1\.2, image-cache;dur=0, image-resize;dur=17\.25, api;dur=[0-9]+\.[0-9]$/);
  assert.doesNotMatch(response.headers.get("server-timing"), /private|synthetic/);
  assert.match(response.headers.get("cache-control"), /^public, max-age=/);
  assert.equal(await response.text(), "synthetic-image");
});

test("missing or malformed upstream stage timings cannot reflect metadata through the gateway", async () => {
  for (const timing of [undefined, '', 'image-db;dur=-1', 'image-db;dur=NaN',
    'image-db;dur=Infinity', 'image-db;dur=1e3', 'image-db;dur=300001',
    'image-db;dur=0.0001', 'image-db;dur=1;desc="synthetic-private"',
    'image-db;dur="1"', 'image-db;dur=1, image-db;dur=2',
    'image-cache;desc="hit"', 'api;dur=0;desc="synthetic-private"',
    `image-db;dur=1, unknown;desc="${"x".repeat(512)}"`]) {
    const response = await gateway.fetch(new Request(imageUrl), imageTimingEnv(timing));
    assert.match(response.headers.get("server-timing"), /^api;dur=[0-9]+\.[0-9]$/);
  }
  const bounded = await gateway.fetch(new Request(imageUrl), imageTimingEnv('image-db;dur=300000'));
  assert.match(bounded.headers.get("server-timing"), /^image-db;dur=300000, api;dur=/);
});

test("upstream image timings stay hidden for every nonqualified or private response", async () => {
  const timing = 'image-db;dur=1, image-cache;dur=0, image-resize;dur=2';
  for (const [request, overrides] of [
    [new Request("https://api.test/api/v1/reports/dashboard"), {}],
    [new Request(imageUrl, { method: "POST" }), {}],
    [new Request(imageUrl + "&tenant=synthetic-private"), {}],
    [new Request(imageUrl, { headers: { Origin: "https://synthetic.test" } }), {}],
    [new Request(imageUrl), { status: 404 }],
    [new Request(imageUrl), { status: 500 }],
    [new Request(imageUrl), { headers: { "Cache-Control": "private, no-store" } }],
    [new Request(imageUrl), { headers: { "Content-Type": "application/json" } }],
    [new Request(imageUrl), { headers: { "Set-Cookie": "synthetic-private=1" } }],
    [new Request(imageUrl), { headers: { Vary: "Cookie" } }],
  ]) {
    const response = await gateway.fetch(request, imageTimingEnv(timing, overrides));
    assert.match(response.headers.get("server-timing"), /^api;dur=[0-9]+\.[0-9]$/);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(response.headers.get("cdn-cache-control"), "no-store");
    assert.equal(response.headers.get("cloudflare-cdn-cache-control"), "no-store");
  }
});

test("a public image edge hit replaces historical origin timings without another API call", async t => {
  const entries = new Map();
  const previous = globalThis.caches;
  globalThis.caches = { default: {
    async match(key) { return entries.get(key.url)?.clone(); },
    async put(key, response) { entries.set(key.url, response.clone()); },
  } };
  t.after(() => { if (previous === undefined) delete globalThis.caches; else globalThis.caches = previous; });
  let calls = 0;
  const env = imageTimingEnv('image-db;dur=10, image-cache;dur=0, image-resize;dur=20');
  const original = env.API.getByName;
  env.API.getByName = (...args) => { calls++; return original(...args); };
  const first = await gateway.fetch(new Request(imageUrl), env);
  assert.match(first.headers.get("server-timing"), /^image-db;dur=10, image-cache;dur=0, image-resize;dur=20, api;dur=/);
  const hit = await gateway.fetch(new Request(imageUrl), env);
  assert.equal(hit.headers.get("server-timing"), 'image-cache;desc="hit"');
  assert.equal(hit.headers.get("x-kova-image-cache"), "HIT");
  assert.equal(calls, 1);
});
