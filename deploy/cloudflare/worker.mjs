import { publicPages, securityHeaders } from "./policy.mjs";

const API_ORIGIN = "https://api.kovasuite.com";
const NO_STORE = "private, no-store, max-age=0";

function secure(response, { api = false, html = false } = {}) {
  const result = new Response(response.body, response);
  for (const [name, value] of Object.entries(securityHeaders)) result.headers.set(name, value);
  if (html) result.headers.set("Cache-Control", "no-cache");
  if (api) {
    result.headers.set("Cache-Control", NO_STORE);
    result.headers.set("CDN-Cache-Control", "no-store");
    result.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  }
  return result;
}

async function proxy(request, path, fetcher) {
  const source = new URL(request.url);
  // Construct the destination from a fixed origin; paths can never select a host.
  const destination = new URL(API_ORIGIN);
  destination.pathname = path;
  destination.search = source.search;
  const headers = new Headers(request.headers);
  for (const name of ["host", "forwarded", "x-forwarded-for", "x-forwarded-host",
    "x-forwarded-proto", "fly-client-ip", "x-real-ip"]) headers.delete(name);
  // Fly supplies its own trusted client IP. Do not let a browser forge it.
  headers.set("X-Forwarded-Host", source.host);
  headers.set("X-Forwarded-Proto", source.protocol.slice(0, -1));
  const upstream = new Request(destination, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    redirect: "manual",
    duplex: "half",
  });
  try {
    const response = secure(await fetcher(upstream, {
      cf: { cacheEverything: false, cacheTtl: 0 },
    }), { api: true });
    const location = response.headers.get("Location");
    if (location) {
      const redirect = new URL(location, destination);
      if (redirect.origin === API_ORIGIN) {
        redirect.host = source.host;
        redirect.protocol = source.protocol;
        response.headers.set("Location", redirect.href);
      }
    }
    return response;
  } catch {
    // Never log request URLs, cookies, credentials or upstream response bodies.
    return secure(Response.json({ detail: "El servicio no está disponible. Intenta de nuevo." },
      { status: 502 }), { api: true });
  }
}

export async function handleRequest(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/api/health" || path === "/api/health/db") {
    return proxy(request, path.slice(4), fetcher);
  }
  if (path === "/api/v1" || path.startsWith("/api/v1/")) {
    return proxy(request, path, fetcher);
  }
  if (path === "/api" || path.startsWith("/api/")) {
    return secure(Response.json({ detail: "Not Found" }, { status: 404 }), { api: true });
  }
  if (!["GET", "HEAD"].includes(request.method)) {
    return secure(new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } }));
  }
  const canonical = path === "/" ? path : path.replace(/\/$/, "");
  const page = Object.hasOwn(publicPages, canonical) ? publicPages[canonical] : undefined;
  if (page) {
    url.pathname = page;
    return secure(await env.ASSETS.fetch(new Request(url, request)), { html: true });
  }
  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 404) return secure(asset, { html: path.endsWith(".html") });
  // Missing assets must stay 404. Returning HTML would break module loading
  // and can poison a service worker precache during a release.
  if (/\.[^/]+$/.test(path) || path.startsWith("/_vercel/")) return secure(asset);
  url.pathname = "/app-shell.html";
  const shell = secure(await env.ASSETS.fetch(new Request(url, request)), { html: true });
  shell.headers.set("X-Robots-Tag", "noindex, nofollow");
  return shell;
}

export default { fetch(request, env) { return handleRequest(request, env); } };
