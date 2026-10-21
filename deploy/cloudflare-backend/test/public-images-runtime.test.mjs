import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("real workerd Cache API serves repeat public images before the API and preserves private traffic", async () => {
  const bundle = async path => (await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022",
    external: ["node:*"],
  })).outputFiles[0].text;
  const mf = new Miniflare(convertV4MiniflareOptions({
    workers: [{
      name: "frontend", modules: true, script: await bundle("../../cloudflare/worker.mjs"),
      compatibilityDate: "2026-10-17", compatibilityFlags: ["nodejs_compat"],
      outboundService: "gateway",
    }, {
      name: "gateway", modules: true, script: await bundle("../gateway.mjs"),
      compatibilityDate: "2026-10-17", compatibilityFlags: ["nodejs_compat"],
      bindings: { KOVA_NATIVE_BACKEND: "1" },
      durableObjects: { API: { className: "SyntheticImageApi", scriptName: "synthetic-api" } },
    }, {
      name: "synthetic-api", modules: true,
      compatibilityDate: "2026-10-17", compatibilityFlags: ["nodejs_compat"],
      durableObjects: { API: { className: "SyntheticImageApi", useSQLite: true } },
      script: `import { DurableObject } from "cloudflare:workers";
        export class SyntheticImageApi extends DurableObject {
          count = 0;
          async fetch(request) {
            const path = new URL(request.url).pathname;
            if (path === "/_test-count") return Response.json({ count: this.count });
            this.count++;
            if (path.endsWith("/image")) {
              if (request.headers.has("cookie") || request.headers.has("authorization")) {
                throw new Error("Public image forwarded private credentials");
              }
              return new Response("synthetic-raster", { headers: {
                "Content-Type": "image/webp", "Cache-Control": "public, max-age=86400",
              } });
            }
            return Response.json({ authenticated: request.headers.has("cookie") });
          }
        }
        export default { fetch() { return new Response(null, { status: 404 }); } };`,
    }],
  }));
  try {
    const url = "https://kovasuite.com/api/v1/catalog/products/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/image?v=123&w=160";
    const first = await mf.dispatchFetch(url, { headers: { Cookie: "session=synthetic-a" } });
    assert.equal(first.headers.get("x-kova-image-cache"), "MISS");
    assert.equal(await first.text(), "synthetic-raster");
    const caches = await mf.getCaches();
    for (let attempt = 0; attempt < 30; attempt++) {
      if (await caches.default.match(url)) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const second = await mf.dispatchFetch(url, { headers: {
      Cookie: "session=synthetic-b", Authorization: "Bearer synthetic-b",
    } });
    assert.equal(second.headers.get("x-kova-image-cache"), "HIT");
    assert.equal(second.headers.get("x-frame-options"), "DENY");
    assert.equal(await second.text(), "synthetic-raster");
    const api = (await mf.getDurableObjectNamespace("API", "gateway")).getByName("api-0");
    assert.deepEqual(await (await api.fetch("https://api.test/_test-count")).json(), { count: 1 });
    const privateUrl = "https://kovasuite.com/api/v1/orders";
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await mf.dispatchFetch(privateUrl, { headers: { Cookie: "session=synthetic" } });
      assert.match(response.headers.get("cache-control"), /no-store/);
      assert.deepEqual(await response.json(), { authenticated: true });
    }
    assert.deepEqual(await (await api.fetch("https://api.test/_test-count")).json(), { count: 3 });
  } finally {
    await mf.dispose();
  }
});
