import settingsKeys from "./settings-keys.json" with { type: "json" };

export const NATIVE_INSTANCE = "api-0";
export const RATE_LIMIT_HOST = "rate-limit.kova.internal";
export const JOBS_HOST = "jobs.kova.internal";

// Explicit Settings projection: never enumerate arbitrary account secrets or
// serialize resource bindings. Values stay inside the Worker/container runtime.
export function nativeEnvironment(env) {
  const values = {};
  for (const name of settingsKeys) {
    if (typeof env[name] === "string") values[name] = env[name];
  }
  for (const name of ["APP_DATABASE_URL", "MIGRATION_DATABASE_URL", "SECRET_KEY"]) {
    if (!values[name]) throw new Error(`Missing native runtime setting: ${name}`);
  }
  if (!/^[a-f0-9]{40}$/i.test(env.KOVA_BUILD_SHA || "")) {
    throw new Error("Native runtime requires a full immutable build SHA");
  }
  return {
    ...values,
    APP_ENV: "production",
    DATABASE_URL: values.MIGRATION_DATABASE_URL,
    KOVA_RELEASE_SHA: env.KOVA_BUILD_SHA,
    CLOUDFLARE_CONTAINER_MODE: "true",
    TRUSTED_CLIENT_IP_HEADER: "x-kova-client-ip",
    ASSISTANT_DOCUMENTS_ENABLED: "false",
    ASSISTANT_INGEST_ON_DEMAND: "false",
    DATABASE_POOL_SIZE: "3",
    DATABASE_MAX_OVERFLOW: "0",
  };
}

export function publicPath(path) {
  return path === "/" || path.startsWith("/api/v1/")
    || ["/health", "/health/", "/health/db", "/health/db/"].includes(path);
}

export function privateResponse(response) {
  // Constructing from the original Response preserves distinct Set-Cookie
  // headers in Workers, as in the existing public gateway.
  const result = new Response(response.body, response);
  result.headers.set("Cache-Control", "private, no-store, max-age=0");
  result.headers.set("CDN-Cache-Control", "no-store");
  result.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  return result;
}

export function unavailable() {
  return privateResponse(Response.json({
    detail: "El servicio no está disponible temporalmente.",
  }, { status: 503 }));
}

export async function rateLimitBridge(request, env) {
  const url = new URL(request.url);
  if (url.protocol !== "http:" || url.hostname !== RATE_LIMIT_HOST
      || url.port || url.pathname !== "/allow" || url.search
      || request.method !== "POST") {
    return new Response(null, { status: 404 });
  }
  // This handler is installed only on the container's private outbound route.
  // No HTTP path in the public Worker can reach it. Bound the body even when
  // Content-Length is absent or untrusted.
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 512) {
        await reader.cancel();
        return new Response(null, { status: 413 });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let input;
    try {
      input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return new Response(null, { status: 400 });
    }
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).sort().join(",")
        !== "bucket,maximum,windowSeconds"
        || typeof input.bucket !== "string"
        || !/^[a-f0-9]{64}-[1-9][0-9]{0,4}$/.test(input.bucket)
        || !Number.isInteger(input.maximum) || input.maximum <= 0 || input.maximum > 1_000_000
        || !Number.isInteger(input.windowSeconds) || input.windowSeconds <= 0
        || input.windowSeconds > 86400
        || !input.bucket.endsWith(`-${input.windowSeconds}`)) {
      return new Response(null, { status: 400 });
    }
    const result = await env.RATE_LIMITS.getByName(input.bucket).allow(
      input.maximum, input.windowSeconds,
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Failure stays an error so native auth can apply its existing fail-closed
    // policy. Never include the body, bucket, settings, or exception in logs.
    return new Response(null, { status: 503 });
  } finally {
    reader.releaseLock();
  }
}

export async function jobsBridge(request, env) {
  const url = new URL(request.url);
  if (url.protocol !== "http:" || url.hostname !== JOBS_HOST || url.port
      || url.pathname !== "/wake" || url.search || request.method !== "POST") {
    return new Response(null, { status: 404 });
  }
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 512) {
        await reader.cancel();
        return new Response(null, { status: 413 });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let input;
    try {
      input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return new Response(null, { status: 400 });
    }
    if (!input || typeof input !== "object" || Array.isArray(input)
        || Object.keys(input).join(",") !== "tenantId"
        || typeof input.tenantId !== "string"
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.tenantId)) {
      return new Response(null, { status: 400 });
    }
    const scheduled = await env.JOBS.getByName(input.tenantId).wake(input.tenantId);
    return Response.json({ scheduled: scheduled === true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return new Response(null, { status: 503 });
  } finally {
    reader.releaseLock();
  }
}
