import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import worker, { handleRequest } from "./worker.mjs";

function assets(files = {}) {
  return { ASSETS: { fetch: async request => {
    const path = new URL(request.url).pathname;
    return Object.hasOwn(files, path)
      ? new Response(request.method === "HEAD" ? null : files[path], {
        headers: { "Content-Type": "text/html" },
      }) : new Response("missing", { status: 404 });
  } } };
}

test("streams a write without changing cookies, CSRF, origin, query or idempotency key", async () => {
  const request = new Request("https://kovasuite.com/api/v1/sync/sales?attempt=2", {
    method: "POST", body: '{"sales":[]}', headers: {
      Cookie: "access_token=test-session; csrf_token=test-csrf",
      "X-CSRF-Token": "test-csrf", Origin: "https://kovasuite.com",
      "Idempotency-Key": "test-retry", "Content-Type": "application/json",
      "Fly-Client-IP": "1.2.3.4", "X-Forwarded-For": "1.2.3.4",
    },
  });
  let calls = 0;
  const response = await handleRequest(request, {}, async (upstream, options) => {
    calls++;
    assert.equal(upstream.url, "https://api.kovasuite.com/api/v1/sync/sales?attempt=2");
    assert.equal(await upstream.text(), '{"sales":[]}');
    for (const header of ["cookie", "x-csrf-token", "origin", "idempotency-key"]) {
      assert.equal(upstream.headers.get(header), request.headers.get(header));
    }
    assert.equal(upstream.headers.get("fly-client-ip"), null);
    assert.equal(upstream.headers.get("x-forwarded-for"), null);
    assert.equal(upstream.redirect, "manual");
    assert.equal(options.cf.cacheTtl, 0);
    return new Response("saved", { status: 201, headers: { "x-request-id": "test-request" } });
  });
  assert.equal(calls, 1);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("x-request-id"), "test-request");
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("cloudflare-cdn-cache-control"), "no-store");
});

test("preserves multiple auth cookies, their flags and paths", async () => {
  const headers = new Headers();
  const cookies = [
    "access_token=test-access; HttpOnly; Secure; SameSite=Lax; Path=/",
    "refresh_token=test-refresh; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth",
    "csrf_token=test-csrf; Secure; SameSite=Lax; Path=/",
  ];
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  const response = await handleRequest(new Request("https://kovasuite.com/api/v1/auth/login",
    { method: "POST", body: "{}" }), {}, async () => new Response("{}", { headers }));
  assert.deepEqual(response.headers.getSetCookie(), cookies);
});

test("maps health endpoints and preserves upstream auth/billing failures", async () => {
  for (const [path, target, status] of [
    ["/api/health", "/health", 200], ["/api/health/db", "/health/db", 503],
    ["/api/v1/auth/me", "/api/v1/auth/me", 401],
    ["/api/v1/orders", "/api/v1/orders", 402],
  ]) {
    const response = await handleRequest(new Request(`https://kovasuite.com${path}`), {},
      async upstream => {
        assert.equal(new URL(upstream.url).pathname, target);
        return new Response("upstream", { status });
      });
    assert.equal(response.status, status);
    assert.equal(await response.text(), "upstream");
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
});

test("network failure returns an uncached 502 without retrying a write", async () => {
  let calls = 0;
  const response = await handleRequest(new Request("https://kovasuite.com/api/v1/orders",
    { method: "POST", body: "{}" }), {}, async () => {
    calls++;
    throw new Error("private upstream detail");
  });
  assert.equal(calls, 1);
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /private upstream detail/);
  assert.match(response.headers.get("cache-control"), /no-store/);
});

test("unknown API routes never fall back to HTML or forward to an arbitrary host", async () => {
  for (const path of ["/api", "/api/unknown", "/api//example.com"]) {
    const response = await handleRequest(new Request(`https://kovasuite.com${path}`), {},
      () => assert.fail("unexpected upstream request"));
    assert.equal(response.status, 404);
    assert.match(response.headers.get("content-type"), /application\/json/);
  }
});

test("public pages render their own HTML while application routes use an empty shell", async () => {
  const env = assets({ "/index.html": "landing", "/privacy/index.html": "privacy",
    "/app-shell.html": '<div id="root"></div>' });
  for (const [path, expected] of [["/", "landing"], ["/privacy", "privacy"],
    ["/privacy/", "privacy"], ["/register", '<div id="root"></div>'],
    ["/__proto__", '<div id="root"></div>']]) {
    const response = await worker.fetch(new Request(`https://kovasuite.com${path}`), env, {});
    assert.equal(await response.text(), expected);
    assert.equal(response.headers.get("cache-control"), "no-cache");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.ok(response.headers.get("content-security-policy"));
  }
});

test("missing JS, precache files and Vercel endpoints stay 404", async () => {
  const env = assets({ "/app-shell.html": "shell" });
  for (const path of ["/assets/missing.js", "/sw.js", "/_vercel/insights/script.js"]) {
    const response = await handleRequest(new Request(`https://kovasuite.com${path}`), env);
    assert.equal(response.status, 404);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
});

test("same-origin backend redirects remain on the frontend without following them", async () => {
  const response = await handleRequest(new Request("https://kovasuite.com/api/v1/orders"), {},
    async () => new Response(null, { status: 307,
      headers: { Location: "https://api.kovasuite.com/api/v1/orders/?page=1" } }));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://kovasuite.com/api/v1/orders/?page=1");
});

test("non-API writes are rejected instead of being served a successful app shell", async () => {
  const response = await handleRequest(new Request("https://kovasuite.com/register",
    { method: "POST", body: "{}" }), assets());
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
});

test("versioned public product images bypass repeat upstream calls while retaining security policy", async t => {
  const entries = new Map();
  const before = globalThis.caches;
  globalThis.caches = { default: {
    async match(key) {
      assert.deepEqual([...key.headers], []);
      return entries.get(key.url)?.clone();
    },
    async put(key, response) { entries.set(key.url, response.clone()); },
  } };
  t.after(() => { if (before === undefined) delete globalThis.caches; else globalThis.caches = before; });
  const url = "https://kovasuite.com/api/v1/catalog/products/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/image?v=123&w=160";
  let calls = 0;
  const fetcher = async request => {
    calls++;
    assert.equal(request.headers.has("cookie"), false);
    assert.equal(request.headers.has("authorization"), false);
    assert.equal(request.headers.has("x-kova-branch"), false);
    assert.equal(request.headers.get("cf-connecting-ip"), "192.0.2.20");
    assert.equal(request.headers.get("x-real-ip"), "192.0.2.20");
    assert.equal(request.headers.has("x-forwarded-for"), false);
    assert.equal(request.headers.has("x-kova-client-ip"), false);
    return new Response("synthetic-image", { headers: {
      "Content-Type": "image/webp", "Cache-Control": "public, max-age=86400",
    } });
  };
  const first = await handleRequest(new Request(url, { headers: {
    Cookie: "session=a", Authorization: "Bearer synthetic", "X-Kova-Branch": "synthetic",
    "CF-Connecting-IP": "192.0.2.20", "X-Real-IP": "198.51.100.99",
    "X-Forwarded-For": "198.51.100.99", "X-Kova-Client-IP": "198.51.100.99",
  } }), {}, fetcher);
  assert.equal(first.headers.get("x-kova-image-cache"), "MISS");
  const second = await handleRequest(new Request(url, { headers: {
    Cookie: "session=b", Authorization: "Bearer synthetic", "X-Kova-Branch": "synthetic",
  } }), {}, fetcher);
  assert.equal(calls, 1);
  assert.equal(second.headers.get("x-kova-image-cache"), "HIT");
  assert.match(second.headers.get("cache-control"), /^public, max-age=[1-9][0-9]{0,2}$/);
  assert.equal(second.headers.get("x-frame-options"), "DENY");
  assert.ok(second.headers.get("content-security-policy"));
  assert.equal(await second.text(), "synthetic-image");
  const privateResponse = await handleRequest(new Request("https://kovasuite.com/api/v1/auth/session?v=123", {
    headers: { Cookie: "session=private" },
  }), {}, async upstream => {
    assert.equal(upstream.headers.get("cookie"), "session=private");
    return new Response("must-not-cache", { headers: {
      "Content-Type": "image/png", "Cache-Control": "public, max-age=86400",
    } });
  });
  assert.match(privateResponse.headers.get("cache-control"), /no-store/);
  assert.equal(entries.size, 1);
});

test("the deployable frontend bundle embeds the shared image policy without unresolved local imports", async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL("./worker.mjs", import.meta.url))],
    bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022" });
  const bundled = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  const url = "https://kovasuite.com/api/v1/catalog/products/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/image?v=123&w=160";
  const response = await bundled.handleRequest(new Request(url), {}, async () => new Response("image", {
    headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=86400" },
  }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /^public, max-age=/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});
