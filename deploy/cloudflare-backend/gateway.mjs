// Keep the public HTTP handler small; Python and expensive password work run
// inside the API coordinators, within the Durable Objects Free compute budget.
import { createHash } from "node:crypto";
import { cachedPublicImage, publicImageResponse } from "../public-images.mjs";
import { CONTROLLER_FAILURE_HEADER, fetchWithControllerUpdateRecovery } from "../controller-update-recovery.mjs";

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

// Public image diagnostics contain bounded numbers only: never forward an
// arbitrary upstream metric name, description or private request metadata.
function publicImageTimings(value) {
  if (!value || value.length > 512) return [];
  const timings = new Map();
  for (const part of value.split(",")) {
    const match = /^(image-db|image-cache|image-resize);dur=([0-9]{1,6}(?:\.[0-9]{1,3})?)$/.exec(part.trim());
    if (!match) continue;
    const duration = Number(match[2]);
    if (duration > 300000 || timings.has(match[1])) return [];
    timings.set(match[1], duration);
  }
  return ["image-db", "image-cache", "image-resize"]
    .filter(name => timings.has(name))
    .map(name => `${name};dur=${timings.get(name)}`);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/health/candidate" || path === "/health/candidate/drain") {
      // Operational readiness only: no caller-chosen slot, path, cookies or
      // body reaches the candidate. It never forwards a business request.
      if (request.method !== "GET" || url.search || !env.CANDIDATE_API) {
        return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
      }
      try {
        const stub = env.CANDIDATE_API.getByName("api-0");
        if (path.endsWith("/drain")) {
          if (env.KOVA_NATIVE_CANDIDATE_SLOT === "legacy") {
            return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
          }
          const state = await stub.drainState();
          if (!/^[a-f0-9]{40}$/i.test(state?.release_sha ?? "") || typeof state?.replaceable !== "boolean") {
            throw new Error("Invalid candidate drain state");
          }
          return Response.json({ release_sha: state.release_sha, replaceable: state.replaceable }, {
            headers: { "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store" },
          });
        }
        let probe;
        if (env.KOVA_NATIVE_CANDIDATE_SLOT === "legacy") {
          // The first migration retains a legacy controller that may still
          // be running its original class code. Its fixed public health
          // contract is sufficient; no new RPC is required to keep rollback.
          const response = await stub.fetch(new Request("https://api.kovasuite.com/health"));
          const database = await stub.fetch(new Request("https://api.kovasuite.com/health/db"));
          const body = await response.json();
          const db = await database.json();
          if (!response.ok || !database.ok || db?.status !== "ok" || db?.db !== "reachable") {
            throw new Error("Legacy rollback API is unavailable");
          }
          probe = { ...body, processId: response.headers.get("x-kova-process-id"),
            boot: response.headers.get("x-kova-boot-controller-sha"),
            controller: response.headers.get("x-kova-controller-sha"), replaceable: false };
        } else probe = await stub.probe();
        if (probe?.status !== "ok" || !/^[a-f0-9]{40}$/i.test(probe.release_sha ?? "")
            || !/^[a-f0-9]{32}$/.test(probe.processId ?? "")
            || probe.boot !== probe.release_sha || probe.controller !== probe.release_sha
            || typeof probe.replaceable !== "boolean"
            || (env.KOVA_NATIVE_CANDIDATE_SLOT !== "legacy" && (probe.offerVerified !== true
              || !/^offer-v1-[a-f0-9]{64}$/.test(probe.offerRevision ?? "")))) throw new Error("Invalid candidate probe");
        return Response.json({ status: "ok", release_sha: probe.release_sha,
          db: "reachable", replaceable: probe.replaceable,
          offer_verified: probe.offerVerified === true,
          ...(probe.offerVerified ? { offer_revision: probe.offerRevision } : {}) }, { headers: {
          "Cache-Control": "private, no-store, max-age=0", "CDN-Cache-Control": "no-store",
          "x-kova-runtime": "native-resident", "x-kova-process-id": probe.processId,
          "x-kova-boot-controller-sha": probe.boot, "x-kova-controller-sha": probe.controller,
        } });
      } catch {
        return Response.json({ detail: "Candidato no disponible." }, {
          status: 503, headers: { "Cache-Control": "no-store" },
        });
      }
    }
    if (path !== "/" && !path.startsWith("/api/v1/")
        && path !== "/health" && path !== "/health/"
        && path !== "/health/db" && path !== "/health/db/") {
      // Unknown public paths must not initialize Python or open database
      // connections. All application routes live under these prefixes.
      return Response.json({ detail: "Not Found" }, {
        status: 404, headers: { "Cache-Control": "private, no-store, max-age=0" },
      });
    }
    return cachedPublicImage(request, async anonymousRequest => {
      const headers = new Headers(anonymousRequest.headers);
      headers.delete(CONTROLLER_FAILURE_HEADER);
      // This entrypoint is reached through Cloudflare's edge. Never trust a
      // caller-provided forwarding/IP header as a rate-limit identity.
      headers.set("x-kova-client-ip", request.headers.get("cf-connecting-ip") || "unknown");
      for (const name of ["fly-client-ip", "x-forwarded-for", "x-real-ip", "forwarded"]) {
        headers.delete(name);
      }
      // Resident native traffic shares one process. Avoid keeping compatibility
      // proxy objects awake (and billed) for every former Python shard.
      const shard = env.KOVA_NATIVE_BACKEND === "1" ? 0 : coordinatorShard(headers.get("cookie"), path);
      try {
        const started = performance.now();
        const upstream = new Request(anonymousRequest, { headers });
        const getStub = () => env.API.getByName(`api-${shard}`);
        const response = env.KOVA_NATIVE_BACKEND === "1"
          ? await fetchWithControllerUpdateRecovery(upstream, getStub)
          : await getStub().fetch(upstream);
        const image = publicImageResponse(anonymousRequest, response);
        const result = image || new Response(response.body, response);
        result.headers.delete(CONTROLLER_FAILURE_HEADER);
        const timings = image ? publicImageTimings(response.headers.get("server-timing")) : [];
        timings.push(`api;dur=${(performance.now() - started).toFixed(1)}`);
        result.headers.set("Server-Timing", timings.join(", "));
        if (!image) {
          result.headers.set("Cache-Control", "private, no-store, max-age=0");
          result.headers.set("CDN-Cache-Control", "no-store");
          result.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
        }
        return result;
      } catch {
        console.error(JSON.stringify({ event: "backend_unavailable" }));
        return Response.json({ detail: "El servicio no está disponible temporalmente." }, {
          status: 503, headers: { "Cache-Control": "private, no-store" },
        });
      }
    }, ctx);
  },
};
