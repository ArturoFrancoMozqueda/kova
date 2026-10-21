// The only API cache exception: an explicitly public, versioned product image.
// This is shared by the frontend proxy, public API gateway and native controller.
// It never grants access to private API data or caches a session-bearing response.
const IMAGE_PATH = /^\/api\/v1\/catalog\/products\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/image$/i;
const WIDTHS = new Set(["160", "320", "400", "800"]);
const MAX_AGE = 300;

export function publicImageKey(request) {
  if (!request || request.method !== "GET" || request.headers.has("origin")) return null;
  const url = new URL(request.url);
  const match = IMAGE_PATH.exec(url.pathname);
  if (!match || !["http:", "https:"].includes(url.protocol)) return null;
  const versions = url.searchParams.getAll("v");
  const widths = url.searchParams.getAll("w");
  if (versions.length !== 1 || !/^[0-9]{1,20}$/.test(versions[0])
      || widths.length > 1 || (widths.length && !WIDTHS.has(widths[0]))) return null;
  if ([...url.searchParams.keys()].some(name => name !== "v" && name !== "w")) return null;
  url.pathname = `/api/v1/catalog/products/${match[1].toLowerCase()}/image`;
  url.search = "";
  url.searchParams.set("v", versions[0]);
  if (widths.length) url.searchParams.set("w", widths[0]);
  url.hash = "";
  // Both lookup and anonymous public-image subrequests omit all session,
  // authorization, branch, range and conditional headers from the cache key.
  return new Request(url, { method: "GET" });
}

export function publicImageResponse(request, response) {
  if (!publicImageKey(request) || response.status !== 200 || response.headers.has("set-cookie")
      || response.headers.has("www-authenticate") || response.headers.has("authorization")
      || !/^image\/(?:jpeg|png|webp)(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) return null;
  const vary = (response.headers.get("vary") || "").toLowerCase().split(",").map(name => name.trim());
  if (vary.some(name => name && name !== "accept-encoding")) return null;
  const control = (response.headers.get("cache-control") || "").toLowerCase()
    .split(",").map(value => value.trim());
  if (!control.includes("public")
      || control.some(value => /^(?:private|no-store|no-cache)(?:=|$)/.test(value))) return null;
  for (const header of ["cdn-cache-control", "cloudflare-cdn-cache-control"]) {
    if (/(?:^|,)\s*(?:private|no-store|no-cache)(?:\s*(?:=|,|$))/i.test(response.headers.get(header) || "")) return null;
  }
  const maxAge = control.filter(value => value.startsWith("max-age="));
  const sharedAge = control.filter(value => value.startsWith("s-maxage="));
  if (maxAge.length !== 1 || !/^max-age=[0-9]+$/.test(maxAge[0]) || sharedAge.length > 1
      || (sharedAge.length && !/^s-maxage=[0-9]+$/.test(sharedAge[0]))) return null;
  let ttl = Math.min(MAX_AGE, Number(maxAge[0].slice(8)),
    sharedAge.length ? Number(sharedAge[0].slice(9)) : MAX_AGE);
  const now = Date.now();
  const age = response.headers.get("age");
  if (age !== null) {
    if (!/^[0-9]+$/.test(age)) return null;
    ttl -= Number(age);
  }
  const expires = response.headers.get("expires");
  if (expires !== null) {
    const expiry = Date.parse(expires);
    if (!Number.isFinite(expiry)) return null;
    // Multiple edge hops must not restart the freshness window of a cached
    // image. Deactivation/removal can remain stale for at most five minutes.
    ttl = Math.min(ttl, Math.floor((expiry - now) / 1000));
  }
  if (!Number.isFinite(ttl) || ttl <= 0) return null;
  const result = new Response(response.body, response);
  const policy = `public, max-age=${ttl}`;
  result.headers.set("Cache-Control", policy);
  result.headers.set("CDN-Cache-Control", policy);
  result.headers.set("Cloudflare-CDN-Cache-Control", policy);
  result.headers.set("Expires", new Date(now + ttl * 1000).toUTCString());
  result.headers.delete("Age");
  return result;
}

export async function cachedPublicImage(request, load, ctx, cache = globalThis.caches?.default) {
  const key = publicImageKey(request);
  if (!key) return load(request);
  if (cache) {
    try {
      const stored = await cache.match(key);
      const hit = stored && publicImageResponse(key, stored);
      if (hit) {
        hit.headers.set("X-Kova-Image-Cache", "HIT");
        hit.headers.set("Server-Timing", 'image-cache;desc="hit"');
        return hit;
      }
    } catch {
      // An optional cache outage must not prevent the public image loading.
    }
  }
  const response = await load(key);
  const result = publicImageResponse(key, response);
  if (!result) return response;
  result.headers.set("X-Kova-Image-Cache", "MISS");
  if (cache) {
    const copy = result.clone();
    const write = Promise.resolve().then(() => cache.put(key, copy)).catch(() => {});
    if (ctx?.waitUntil) ctx.waitUntil(write);
    else await write;
  }
  return result;
}
