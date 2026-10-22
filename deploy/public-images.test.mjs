import assert from "node:assert/strict";
import { test } from "node:test";
import { cachedPublicImage, publicImageKey, publicImageResponse } from "./public-images.mjs";

const imagePath = "/api/v1/catalog/products/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/image";
const imageRequest = (suffix = "?v=123&w=160", options) => new Request(`https://app.test${imagePath}${suffix}`, options);
const image = (headers = {}, status = 200) => new Response("synthetic-image", {
  status, headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=86400", ...headers },
});

class MemoryCache {
  values = new Map();
  async match(key) {
    assert.deepEqual([...key.headers], [], "no private/conditional headers enter cache lookup");
    return this.values.get(key.url)?.clone();
  }
  async put(key, response) {
    assert.deepEqual([...key.headers], [], "cache keys remain anonymous");
    this.values.set(key.url, response.clone());
  }
}

test("public image keys canonicalize only the documented variants and omit session headers", () => {
  const request = imageRequest("?w=160&v=123", { headers: {
    Cookie: "access_token=synthetic", Authorization: "Bearer synthetic", "X-Kova-Branch": "synthetic",
    Range: "bytes=0-10", "If-None-Match": "synthetic", "X-CSRF-Token": "synthetic",
  } });
  const key = publicImageKey(request);
  assert.equal(key.url, `https://app.test${imagePath}?v=123&w=160`);
  assert.deepEqual([...key.headers], []);
  assert.equal(publicImageKey(imageRequest("?v=000123")).url, `https://app.test${imagePath}?v=000123`);
  for (const width of [160, 320, 400, 800]) assert.ok(publicImageKey(imageRequest(`?v=123&w=${width}`)));
});

test("private paths, unversioned images, unsupported methods and ambiguous queries never qualify", () => {
  for (const suffix of ["", "?w=160", "?v=", "?v=-1", "?v=1.2", "?v=1e2", "?v=123&v=123",
    "?v=123&w=160&w=160", "?v=123&w=161", "?v=123&w=160.0", "?v=123&token=secret",
    "?v=123&download=1", "?v=123&width=160", "?v=123456789012345678901"]) {
    assert.equal(publicImageKey(imageRequest(suffix)), null, suffix);
  }
  for (const method of ["HEAD", "POST", "PUT", "DELETE", "OPTIONS"]) {
    assert.equal(publicImageKey(imageRequest("?v=123", { method })), null, method);
  }
  for (const path of ["/api/v1/orders", "/api/v1/auth/session", imagePath + "/", imagePath + ".json",
    imagePath.replace("aaaaaaaa", "not-uuid"), imagePath.replace("aaaaaaaa", "%61aaaaaaa")]) {
    assert.equal(publicImageKey(new Request(`https://app.test${path}?v=123`)), null, path);
  }
  assert.equal(publicImageKey(imageRequest("?v=123", { headers: { Origin: "https://app.test" } })), null,
    "Origin-bearing requests retain the original CORS flow without sharing variants");
});

test("only a successful, explicitly public raster without private response metadata is cacheable", () => {
  const request = imageRequest();
  assert.ok(publicImageResponse(request, image()));
  for (const status of [201, 206, 304, 400, 401, 403, 404, 500]) {
    const response = status === 304 ? new Response(null, { status }) : image({}, status);
    assert.equal(publicImageResponse(request, response), null, `status ${status}`);
  }
  for (const headers of [
    { "Content-Type": "application/json" }, { "Content-Type": "text/html" },
    { "Content-Type": "image/svg+xml" }, { "Content-Type": "image/avif" },
    { "Set-Cookie": "" }, { "Set-Cookie": "session=synthetic" },
    { Vary: "Cookie" }, { Vary: "Authorization" }, { Vary: "*" }, { Vary: "Origin" },
    { "WWW-Authenticate": "Bearer" }, { Authorization: "synthetic" },
    { "Cache-Control": "" }, { "Cache-Control": "max-age=300" },
    { "Cache-Control": "public, private, max-age=300" }, { "Cache-Control": "public, no-store, max-age=300" },
    { "Cache-Control": "public, no-cache, max-age=300" }, { "Cache-Control": "public, max-age=0" },
    { "Cache-Control": "public, max-age=300, s-maxage=0" },
    { "Cache-Control": "public, max-age=300, max-age=86400" },
    { "Cloudflare-CDN-Cache-Control": "no-store" }, { "CDN-Cache-Control": "private" },
    { Age: "300" }, { Age: "invalid" }, { Expires: "invalid" }, { Expires: new Date(0).toUTCString() },
  ]) assert.equal(publicImageResponse(request, image(headers)), null, JSON.stringify(headers));
  assert.ok(publicImageResponse(request, image({ Vary: "Accept-Encoding" })));
  assert.equal(publicImageResponse(new Request("https://app.test/api/v1/orders?v=123"), image()), null);
});

test("a cache hit reuses the anonymous public image across cookies without another upstream call", async () => {
  const cache = new MemoryCache();
  const writes = [];
  const ctx = { waitUntil(promise) { writes.push(promise); } };
  let calls = 0;
  const load = async request => {
    calls++;
    assert.deepEqual([...request.headers], []);
    return image({ "X-Content-Type-Options": "nosniff" });
  };
  const first = await cachedPublicImage(imageRequest("?v=123", { headers: { Cookie: "session=a" } }), load, ctx, cache);
  assert.equal(first.headers.get("x-kova-image-cache"), "MISS");
  await Promise.all(writes);
  const second = await cachedPublicImage(imageRequest("?v=123", { headers: { Cookie: "session=b", Authorization: "Bearer b" } }), load, ctx, cache);
  assert.equal(second.headers.get("x-kova-image-cache"), "HIT");
  assert.equal(second.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await second.text(), "synthetic-image");
  assert.equal(await first.text(), "synthetic-image");
  assert.equal(calls, 1);
  await cachedPublicImage(imageRequest("?v=124"), load, ctx, cache);
  assert.equal(calls, 2, "a new image version never reuses the prior image");
  await Promise.all(writes);
});

test("nonpublic requests preserve their original credentials and cannot touch the cache", async () => {
  const request = new Request("https://app.test/api/v1/orders", { headers: { Cookie: "session=synthetic" } });
  const response = await cachedPublicImage(request, async original => {
    assert.equal(original, request);
    assert.equal(original.headers.get("cookie"), "session=synthetic");
    return Response.json({ private: true });
  }, null, { match() { assert.fail("private lookup"); }, put() { assert.fail("private write"); } });
  assert.deepEqual(await response.json(), { private: true });
});

test("bad upstream responses and unsafe stored entries never produce a shared cache hit", async () => {
  const cache = new MemoryCache();
  const request = imageRequest();
  cache.values.set(publicImageKey(request).url, image({ "Set-Cookie": "session=synthetic" }));
  let calls = 0;
  const result = await cachedPublicImage(request, async () => { calls++; return image(); }, null, cache);
  assert.equal(calls, 1);
  assert.equal(result.headers.get("x-kova-image-cache"), "MISS");
  assert.equal(result.headers.has("set-cookie"), false);
  const empty = new MemoryCache();
  const denied = await cachedPublicImage(request, async () => image({ "Cache-Control": "no-store" }), null, empty);
  assert.equal(denied.headers.get("cache-control"), "no-store");
  assert.equal(empty.values.size, 0);
});

test("cache failures do not prevent image delivery or consume its response body", async () => {
  const cache = {
    match() { throw new Error("synthetic lookup outage"); },
    put() { throw new Error("synthetic storage outage"); },
  };
  const response = await cachedPublicImage(imageRequest(), async () => image(), null, cache);
  assert.equal(await response.text(), "synthetic-image");
  assert.equal(response.status, 200);
});

test("freshness remains bounded across multiple hops and respects a shorter upstream lifetime", t => {
  const now = Math.floor(Date.now() / 1000) * 1000;
  t.mock.method(Date, "now", () => now);
  const first = publicImageResponse(imageRequest(), image());
  assert.equal(first.headers.get("cache-control"), "public, max-age=300");
  t.mock.method(Date, "now", () => now + 120_000);
  const next = publicImageResponse(imageRequest(), first);
  assert.equal(next.headers.get("cache-control"), "public, max-age=180");
  assert.equal(next.headers.get("expires"), first.headers.get("expires"));
  assert.equal(publicImageResponse(imageRequest(), image({ "Cache-Control": "public, max-age=20", Age: "21" })), null);
  t.mock.method(Date, "now", () => now + 301_000);
  assert.equal(publicImageResponse(imageRequest(), next), null);
});
