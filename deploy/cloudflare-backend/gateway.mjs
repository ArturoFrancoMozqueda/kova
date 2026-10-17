// Keep the public HTTP handler small; Python and expensive password work run
// inside the API coordinators, within the Durable Objects Free compute budget.
import { createHash } from "node:crypto";

export default {
  async fetch(request, env) {
    const headers = new Headers(request.headers);
    // This entrypoint is reached through Cloudflare's edge. Never trust a
    // caller-provided forwarding/IP header as a rate-limit identity.
    headers.set("x-kova-client-ip", request.headers.get("cf-connecting-ip") || "unknown");
    for (const name of ["fly-client-ip", "x-forwarded-for", "x-real-ip", "forwarded"]) {
      headers.delete(name);
    }
    const identity = headers.get("cookie") || "anonymous";
    const shard = createHash("sha256").update(identity).digest()[0] % 16;
    try {
      const response = await env.API.getByName(`api-${shard}`).fetch(
        new Request(request, { headers }),
      );
      const result = new Response(response.body, response);
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
