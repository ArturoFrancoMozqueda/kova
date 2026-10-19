// Keep the public HTTP handler small; Python and expensive password work run
// inside the API coordinators, within the Durable Objects Free compute budget.
import { createHash } from "node:crypto";

const dashboardChain = new Set([
  "/api/v1/settings/business-profile", "/api/v1/reports/business-story",
  "/api/v1/reports/sales-summary", "/api/v1/reports/sales-by-hour", "/api/v1/reports/dashboard",
]);
const parallelLanes = new Map([
  ["/api/v1/catalog/products", 1], ["/api/v1/onboarding/state", 1],
  ["/api/v1/branches", 1], ["/api/v1/assistant/capabilities", 1],
  ["/api/v1/inventory/stock", 2], ["/api/v1/billing/subscription", 2], ["/api/v1/shifts", 2],
  ["/api/v1/employees", 3], ["/api/v1/inventory/low-stock", 3], ["/api/v1/settings/receipt", 3],
]);

export function coordinatorShard(cookie, path) {
  const identity = cookie || "anonymous";
  const base = (createHash("sha256").update(identity).digest()[0] % 4) * 4;
  const normalized = path.replace(/\/+$/, "") || "/";
  // The dashboard's dependent reads reuse the coordinator warmed by /session.
  // Other reads retain three parallel lanes; cookies distribute groups across
  // the existing sixteen objects. This hint grants no identity or permissions.
  const lane = normalized.startsWith("/api/v1/auth/") || dashboardChain.has(normalized)
    ? 0 : parallelLanes.get(normalized)
      ?? (1 + createHash("sha256").update(`${identity}\n${normalized}`).digest()[0] % 3);
  return base + lane;
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path !== "/" && !path.startsWith("/api/v1/")
        && path !== "/health" && path !== "/health/"
        && path !== "/health/db" && path !== "/health/db/") {
      // Unknown public paths must not initialize Python or open database
      // connections. All application routes live under these prefixes.
      return Response.json({ detail: "Not Found" }, {
        status: 404, headers: { "Cache-Control": "private, no-store, max-age=0" },
      });
    }
    const headers = new Headers(request.headers);
    // This entrypoint is reached through Cloudflare's edge. Never trust a
    // caller-provided forwarding/IP header as a rate-limit identity.
    headers.set("x-kova-client-ip", request.headers.get("cf-connecting-ip") || "unknown");
    for (const name of ["fly-client-ip", "x-forwarded-for", "x-real-ip", "forwarded"]) {
      headers.delete(name);
    }
    const shard = coordinatorShard(headers.get("cookie"), path);
    try {
      const started = performance.now();
      const response = await env.API.getByName(`api-${shard}`).fetch(
        new Request(request, { headers }),
      );
      const result = new Response(response.body, response);
      result.headers.set("Server-Timing", `api;dur=${(performance.now() - started).toFixed(1)}`);
      result.headers.set("Cache-Control", "private, no-store, max-age=0");
      result.headers.set("CDN-Cache-Control", "no-store");
      result.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
      return result;
    } catch {
      console.error(JSON.stringify({ event: "backend_unavailable" }));
      return Response.json({ detail: "El servicio no está disponible temporalmente." }, {
        status: 503, headers: { "Cache-Control": "private, no-store" },
      });
    }
  },
};
