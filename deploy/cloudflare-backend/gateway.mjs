// Keep the public HTTP handler small; Python and expensive password work run
// inside the API coordinators, within the Durable Objects Free compute budget.
import { createHash } from "node:crypto";

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
    const identity = headers.get("cookie") || "anonymous";
    // Parallel dashboard reads should not queue behind every other endpoint
    // for the same cookie. This hint still grants no identity or permissions.
    const shard = createHash("sha256").update(`${identity}\n${path}`).digest()[0] % 16;
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
