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

test("a code-update reset retries a verified GET once on a fresh stub while keeping private headers", async () => {
  const stubs = [], requests = [];
  let canceled = false;
  const env = { KOVA_NATIVE_BACKEND: "1", API: { getByName(name) {
    const index = stubs.length;
    const stub = { async fetch(request) {
      requests.push(request);
      if (!index) return new Response(new ReadableStream({ cancel() { canceled = true; } }), {
        status: 503, headers: { "x-kova-controller-failure": "code-update-reset" },
      });
      return Response.json({ quotes: [] }, { headers: { "Set-Cookie": "session=synthetic-updated; Secure; HttpOnly" } });
    } };
    stubs.push({ name, stub }); return stub;
  } } };
  const response = await gateway.fetch(new Request("https://api.test/api/v1/quotes?limit=50&offset=0", { headers: {
    Cookie: "session=synthetic-private", "X-Branch-Id": "synthetic-branch", "CF-Connecting-IP": "192.0.2.1",
    "X-Kova-Controller-Failure": "spoofed", "X-Forwarded-For": "spoofed",
  } }), env);
  assert.equal(response.status, 200);
  assert.equal(stubs.length, 2);
  assert.notEqual(stubs[0].stub, stubs[1].stub);
  assert.deepEqual(stubs.map(s => s.name), ["api-0", "api-0"]);
  assert.equal(canceled, true);
  for (const request of requests) {
    assert.equal(request.url, "https://api.test/api/v1/quotes?limit=50&offset=0");
    assert.equal(request.headers.get("cookie"), "session=synthetic-private");
    assert.equal(request.headers.get("x-branch-id"), "synthetic-branch");
    assert.equal(request.headers.get("x-kova-client-ip"), "192.0.2.1");
    assert.equal(request.headers.has("x-kova-controller-failure"), false);
    assert.equal(request.headers.has("x-forwarded-for"), false);
  }
  assert.equal(response.headers.get("x-kova-controller-failure"), null);
  assert.match(response.headers.get("set-cookie"), /synthetic-updated/);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.equal(response.headers.get("cloudflare-cdn-cache-control"), "no-store");
  assert.deepEqual(await response.json(), { quotes: [] });
});

test("only verified native GET reads recover from code-update resets, never mutations or application errors", async t => {
  const previous = console.error;
  console.error = () => {};
  t.after(() => { console.error = previous; });
  for (const [method, path, headers, native = "1"] of [
    ["POST", "/api/v1/orders", { "Idempotency-Key": "synthetic-key" }],
    ["PATCH", "/api/v1/quotes", { "Idempotency-Key": "synthetic-key" }],
    ["DELETE", "/api/v1/quotes", { "Idempotency-Key": "synthetic-key" }],
    ["POST", "/api/v1/auth/login", {}], ["POST", "/api/v1/auth/refresh", {}],
    ["GET", "/api/v1/billing/subscription", {}], ["GET", "/api/v1/unknown", {}],
    ["GET", "/api/v1/quotes/", {}], ["GET", "/api/v1/quotes", {}, "0"],
  ]) {
    let calls = 0;
    const response = await gateway.fetch(new Request(`https://api.test${path}`, { method, headers }), {
      KOVA_NATIVE_BACKEND: native, API: { getByName() { calls++; return { fetch() {
        return new Response("reset", { status: 503, headers: { "x-kova-controller-failure": "code-update-reset" } });
      } }; } },
    });
    assert.equal(calls, 1, `${method} ${path} must not replay`);
    assert.equal(response.status, 503);
    assert.equal(response.headers.has("x-kova-controller-failure"), false);
  }
  for (const extra of [ {}, { "x-kova-runtime": "native-resident" },
    { "x-kova-process-id": "a".repeat(32) }, { "Set-Cookie": "session=synthetic" } ]) {
    for (const status of [500, 503]) {
      let calls = 0;
      const headers = Object.keys(extra).length ? { "x-kova-controller-failure": "code-update-reset", ...extra } : {};
      const response = await gateway.fetch(new Request("https://api.test/api/v1/quotes"), {
        KOVA_NATIVE_BACKEND: "1", API: { getByName() { calls++; return { fetch() {
          return new Response("application failure", { status, headers });
        } }; } },
      });
      assert.equal(calls, 1, "application/unknown failures cannot trigger recovery");
      assert.equal(response.status, status);
      assert.equal(await response.text(), "application failure");
      assert.equal(response.headers.has("x-kova-controller-failure"), false);
      if (extra["Set-Cookie"]) assert.equal(response.headers.get("set-cookie"), extra["Set-Cookie"]);
    }
  }
});

test("an exact reset thrown by the stub can recover once but overloads and a second failure cannot replay", async t => {
  const previous = console.error;
  console.error = () => {};
  t.after(() => { console.error = previous; });
  for (const [error, expectedCalls] of [
    [new Error("Durable Object reset because its code was updated."), 2],
    [Object.assign(new Error("Durable Object reset because its code was updated."), { overloaded: true }), 1],
    [new Error("Durable Object is overloaded."), 1],
    [new Error("Durable Object reset because its code was updated. extra"), 1],
    [new Error("unknown private message"), 1],
  ]) {
    let calls = 0;
    const response = await gateway.fetch(new Request("https://api.test/api/v1/quotes"), {
      KOVA_NATIVE_BACKEND: "1", API: { getByName() { calls++; return { fetch() { throw error; } }; } },
    });
    assert.equal(calls, expectedCalls);
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes(error.message), false);
    assert.equal(response.headers.has("x-kova-controller-failure"), false);
  }
});

test("read recovery observes cancellation and a total budget including the first attempt and backoff", async () => {
  const { fetchWithControllerUpdateRecovery: recover } = await import("../../controller-update-recovery.mjs");
  const reset = () => new Response("private reset", { status: 503, headers: { "x-kova-controller-failure": "code-update-reset" } });
  let now = 0, calls = 0, waits = 0;
  const late = await recover(new Request("https://api.test/api/v1/quotes"), () => ({ fetch() {
    calls++; now = 1960; return reset();
  } }), { now: () => now, wait: async () => { waits++; } });
  assert.equal(calls, 1); assert.equal(waits, 0); assert.equal(await late.text(), "private reset");
  now = 0; calls = 0;
  const overslept = await recover(new Request("https://api.test/api/v1/quotes"), () => ({ fetch() {
    calls++; return reset();
  } }), { now: () => now, wait: async () => { now = 2001; } });
  assert.equal(calls, 1); assert.equal(await overslept.text(), "private reset");
  const abort = new AbortController(); calls = 0;
  await assert.rejects(recover(new Request("https://api.test/api/v1/quotes", { signal: abort.signal }), () => ({ fetch() {
    calls++; return reset();
  } }), { wait: async () => { abort.abort(new DOMException("Canceled", "AbortError")); } }), { name: "AbortError" });
  assert.equal(calls, 1);
  const retryAbort = new AbortController(); calls = 0;
  await assert.rejects(recover(new Request("https://api.test/api/v1/quotes", { signal: retryAbort.signal }), () => ({ fetch(request) {
    calls++;
    if (calls === 1) return reset();
    retryAbort.abort(new DOMException("Canceled", "AbortError"));
    assert.equal(request.signal.aborted, true);
    return new Promise(() => {});
  } }), { wait: async () => {} }), { name: "AbortError" });
  assert.equal(calls, 2);
  // Simulate a first attempt consuming most of the budget. A hanging second
  // RPC that ignores abort is still bounded by the remainder, not a new 2s.
  now = 0; calls = 0;
  const started = performance.now();
  await assert.rejects(recover(new Request("https://api.test/api/v1/quotes"), () => ({ fetch(request) {
    calls++;
    if (calls === 1) { now = 1900; return reset(); }
    assert.equal(request.signal.aborted, false);
    return new Promise(() => {});
  } }), { now: () => now, wait: async () => { now += 50; } }), { name: "TimeoutError" });
  assert.equal(calls, 2);
  assert.ok(performance.now() - started < 500, "only the remaining 50ms may be spent on recovery");
  // Normal first reads do not gain a new 2s timeout from this recovery path.
  now = 0;
  const healthy = await recover(new Request("https://api.test/api/v1/quotes"), () => ({ fetch() {
    now = 5000; return Response.json({ ok: true });
  } }), { now: () => now });
  assert.equal(healthy.status, 200);
});

test("a recovered streamed response remains cancellable by the original client after headers", async () => {
  const { fetchWithControllerUpdateRecovery: recover } = await import("../../controller-update-recovery.mjs");
  const original = new AbortController();
  let calls = 0, retrySignal, streamAborts = 0;
  const response = await recover(new Request("https://api.test/api/v1/quotes", { signal: original.signal }), () => ({
    fetch(request) {
      if (++calls === 1) return new Response("reset", { status: 503, headers: {
        "x-kova-controller-failure": "code-update-reset",
      } });
      retrySignal = request.signal;
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
        request.signal.addEventListener("abort", () => {
          streamAborts++;
          controller.error(request.signal.reason);
        }, { once: true });
      } }));
    },
  }), { wait: async () => {} });
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "partial");
  assert.equal(retrySignal.aborted, false);
  original.abort(new DOMException("Client canceled stream", "AbortError"));
  assert.equal(retrySignal.aborted, true);
  await assert.rejects(reader.read(), { name: "AbortError" });
  assert.equal(streamAborts, 1);
  assert.equal(calls, 2);
});

test("the exact verified GET allowlist can recover and a second marked reset remains a private failure", async () => {
  const { fetchWithControllerUpdateRecovery: recover } = await import("../../controller-update-recovery.mjs");
  for (const path of ["/health", "/health/db", "/api/v1/auth/session", "/api/v1/catalog/products",
    "/api/v1/reports/dashboard", "/api/v1/purchasing/orders", "/api/v1/quotes"]) {
    let calls = 0;
    const response = await recover(new Request(`https://api.test${path}`), () => ({ fetch() {
      if (++calls === 1) return new Response(null, { status: 503, headers: { "x-kova-controller-failure": "code-update-reset" } });
      return Response.json({ ok: true });
    } }), { wait: async () => {} });
    assert.equal(response.status, 200); assert.equal(calls, 2);
  }
  let calls = 0;
  const response = await gateway.fetch(new Request("https://api.test/api/v1/quotes"), {
    KOVA_NATIVE_BACKEND: "1", API: { getByName() { calls++; return { fetch() {
      return new Response("reset", { status: 503, headers: { "x-kova-controller-failure": "code-update-reset" } });
    } }; } },
  });
  assert.equal(calls, 2); assert.equal(response.status, 503);
  assert.equal(response.headers.has("x-kova-controller-failure"), false);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
});

test("client cancellation during the actual backoff clears the wait without a second stub", async () => {
  const { fetchWithControllerUpdateRecovery: recover } = await import("../../controller-update-recovery.mjs");
  const abort = new AbortController();
  let calls = 0;
  const pending = recover(new Request("https://api.test/api/v1/quotes", { signal: abort.signal }), () => ({
    fetch() { calls++; return new Response(null, { status: 503, headers: { "x-kova-controller-failure": "code-update-reset" } }); },
  }));
  const timer = setTimeout(() => abort.abort(new DOMException("Client canceled", "AbortError")), 5);
  try { await assert.rejects(pending, { name: "AbortError" }); }
  finally { clearTimeout(timer); }
  assert.equal(calls, 1);
});

test("recognized recovery emits one fixed event without private context and logger failures cannot alter it", async t => {
  const { fetchWithControllerUpdateRecovery: recover } = await import("../../controller-update-recovery.mjs");
  const previous = console.info;
  t.after(() => { console.info = previous; });
  const events = [];
  console.info = value => events.push(value);
  const run = async () => {
    let calls = 0;
    const response = await recover(new Request("https://api.test/api/v1/quotes?private=synthetic-secret", { headers: {
      Cookie: "session=synthetic-secret", "X-Branch-Id": "synthetic-secret",
    } }), () => ({ fetch() {
      if (++calls === 1) return new Response(null, { status: 503, headers: { "x-kova-controller-failure": "code-update-reset" } });
      return Response.json({ ok: true });
    } }), { wait: async () => {} });
    assert.equal(response.status, 200);
    assert.equal(calls, 2);
  };
  await run();
  assert.deepEqual(events, [JSON.stringify({ event: "controller_update_read_retried" })]);
  assert.equal(events[0].includes("synthetic-secret"), false);
  console.info = () => { throw new Error("synthetic-logger-failure"); };
  await run();
});
