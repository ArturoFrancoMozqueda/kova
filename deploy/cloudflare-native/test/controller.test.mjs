import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { nativeEnvironment, rateLimitBridge, jobsBridge, privateResponse, publicPath } from "../policy.mjs";
import { residentContainerClass } from "../lifecycle.mjs";
import { persistentRateLimitClass } from "../rate-limit.mjs";

const sha = "a".repeat(40);
const settings = () => ({
  APP_DATABASE_URL: "postgresql://synthetic-runtime@localhost/test",
  MIGRATION_DATABASE_URL: "postgresql://synthetic-owner@localhost/test",
  SECRET_KEY: "synthetic-test-key-not-for-production",
  KOVA_BUILD_SHA: sha,
});

test("runtime projection excludes unrelated secrets/resources/Fly and pins safety flags", () => {
  const env = {
    ...settings(), STRIPE_SECRET_KEY: "synthetic-stripe-value", CLOUDFLARE_API_TOKEN: "do-not-pass",
    DB_APP: { opaque: true }, FLY_API_TOKEN: "do-not-pass", FLY_APP_NAME: "retired",
    ASSISTANT_INGEST_FLY_TOKEN: "do-not-pass", ASSISTANT_DOCUMENTS_ENABLED: "true",
    ASSISTANT_INGEST_ON_DEMAND: "true", CLOUDFLARE_CONTAINER_MODE: "false",
    TRUSTED_CLIENT_IP_HEADER: "spoofed", KOVA_RELEASE_SHA: "wrong", APP_ENV: "local",
    ASSISTANT_OPEN_ROUTE: "synthetic-legacy-provider-setting",
  };
  const result = nativeEnvironment(env);
  assert.equal(result.STRIPE_SECRET_KEY, env.STRIPE_SECRET_KEY);
  assert.equal(result.ASSISTANT_OPEN_ROUTE, env.ASSISTANT_OPEN_ROUTE);
  for (const name of ["CLOUDFLARE_API_TOKEN", "DB_APP", "FLY_API_TOKEN", "FLY_APP_NAME", "ASSISTANT_INGEST_FLY_TOKEN"]) {
    assert.equal(Object.hasOwn(result, name), false);
  }
  assert.equal(result.APP_ENV, "production");
  assert.equal(result.DATABASE_URL, env.MIGRATION_DATABASE_URL);
  assert.equal(result.KOVA_RELEASE_SHA, sha);
  assert.equal(result.CLOUDFLARE_CONTAINER_MODE, "true");
  assert.equal(result.TRUSTED_CLIENT_IP_HEADER, "x-kova-client-ip");
  assert.equal(result.ASSISTANT_DOCUMENTS_ENABLED, "false");
  assert.equal(result.ASSISTANT_INGEST_ON_DEMAND, "false");
  for (const name of ["APP_DATABASE_URL", "MIGRATION_DATABASE_URL", "SECRET_KEY", "KOVA_BUILD_SHA"]) {
    const missing = { ...env }; delete missing[name];
    assert.throws(() => nativeEnvironment(missing));
  }
});

test("only api-0 starts the process; all other existing API objects proxy there", async () => {
  let starts = 0;
  let proxyCalls = 0;
  let proxiedRequest;
  class FakeContainer {
    constructor(ctx, env) { this.ctx = ctx; this.env = env; }
    async startAndWaitForPorts() { starts++; this.ctx.container.running = true; }
    async getState() { return { status: this.ctx.container.running ? "healthy" : "stopped" }; }
    async fetch(request) {
      proxiedRequest = request;
      return new Response(await request.text(), { headers: { "Set-Cookie": "session=synthetic; HttpOnly; Secure" } });
    }
  }
  const Resident = residentContainerClass(FakeContainer);
  const env = { ...settings() };
  const objects = new Map();
  env.API = {
    idFromName(name) { return { toString: () => `id-${name}` }; },
    getByName(name) { proxyCalls++; return objects.get(name); },
  };
  for (let index = 0; index < 16; index++) {
    const id = `api-${index}`;
    objects.set(id, new Resident({ id: env.API.idFromName(id), container: { running: false } }, env));
  }
  for (let index = 0; index < 16; index++) {
    const request = new Request("https://api.test/api/v1/auth/login", {
      method: "POST", body: "synthetic-request-body",
      headers: { Cookie: "csrf=synthetic", Origin: "https://app.test", "x-kova-client-ip": "192.0.2.9",
        "x-forwarded-for": "spoofed", Forwarded: "spoofed", "x-forwarded-proto": "http",
        "x-forwarded-host": "spoofed", Host: "spoofed" },
    });
    const response = await objects.get(`api-${index}`).fetch(request);
    assert.equal(await response.text(), "synthetic-request-body");
    assert.match(response.headers.get("set-cookie"), /session=synthetic; HttpOnly; Secure/);
    assert.match(response.headers.get("cache-control"), /private, no-store/);
    assert.equal(proxiedRequest.headers.get("cookie"), "csrf=synthetic");
    assert.equal(proxiedRequest.headers.get("origin"), "https://app.test");
    assert.equal(proxiedRequest.headers.get("x-kova-client-ip"), "192.0.2.9");
    assert.equal(proxiedRequest.headers.get("x-forwarded-proto"), "https");
    assert.equal(proxiedRequest.headers.get("host"), "api.test");
    for (const name of ["x-forwarded-for", "forwarded", "x-forwarded-host"]) {
      assert.equal(proxiedRequest.headers.has(name), false);
    }
  }
  assert.equal(starts, 1);
  assert.equal(proxyCalls, 15);
});

test("idle expiry leaves process resident; restart scheduling uses SDK and readiness checks identity and DB", async () => {
  const schedules = [];
  let starts = 0;
  let release = sha;
  let databaseOK = true;
  class FakeContainer {
    constructor(ctx, env) { this.ctx = ctx; this.env = env; }
    async schedule(...args) { schedules.push(args); }
    async startAndWaitForPorts(options) {
      assert.deepEqual(options, { cancellationOptions: {
        instanceGetTimeoutMS: 60_000, portReadyTimeoutMS: 120_000,
      } });
      starts++;
      this.ctx.container.running = true;
    }
    async getState() { return { status: this.ctx.container.running ? "healthy" : "stopped" }; }
    async containerFetch(url) {
      if (url.endsWith("/db")) return new Response(null, { status: databaseOK ? 200 : 503 });
      return Response.json({ status: "ok", release_sha: release });
    }
    stop() { assert.fail("idle callback must not stop the resident process"); }
    destroy() { assert.fail("idle callback must not destroy the resident process"); }
  }
  const Resident = residentContainerClass(FakeContainer);
  const env = { ...settings(), API: { idFromName: () => ({ toString: () => "resident" }) } };
  const resident = new Resident({ id: { toString: () => "resident" }, container: { running: false } }, env);
  await resident.onActivityExpired();
  assert.deepEqual(schedules, []);
  await resident.onStop();
  assert.deepEqual(schedules, [[5, "ensureRunning"]]);
  await resident.ensureRunning();
  assert.equal(starts, 1);
  assert.equal((await resident.ready()).release_sha, sha);
  release = "b".repeat(40);
  await assert.rejects(() => resident.ready(), /identity mismatch/);
  release = sha; databaseOK = false;
  await assert.rejects(() => resident.ready(), /database failed/);
  const nonresident = new Resident({ id: { toString: () => "proxy" } }, env);
  const before = starts;
  await nonresident.ensureRunning();
  await nonresident.onStop();
  assert.equal(starts, before);
  assert.equal(schedules.length, 1);
});

test("a running but unready process receives the full startup budget only once", async () => {
  let starts = 0;
  let status = "running";
  class FakeContainer {
    constructor(ctx, env) { this.ctx = ctx; this.env = env; }
    async getState() { return { status }; }
    async startAndWaitForPorts(options) {
      assert.deepEqual(options, { cancellationOptions: {
        instanceGetTimeoutMS: 60_000, portReadyTimeoutMS: 120_000,
      } });
      starts++;
      status = "healthy";
    }
  }
  const Resident = residentContainerClass(FakeContainer);
  const env = { ...settings(), API: { idFromName: () => ({ toString: () => "resident" }) } };
  const resident = new Resident({ id: { toString: () => "resident" }, container: { running: true } }, env);
  await resident.ensureReady();
  await resident.ensureReady();
  assert.equal(starts, 1, "steady requests must not repeat startup port checks");
});

test("scanners and private bridge paths never start the native process through public routing", () => {
  for (const path of ["/.env", "/allow", "/ready", "/docs", "/api/v10/auth/login"]) {
    assert.equal(publicPath(path), false);
  }
  for (const path of ["/", "/health", "/health/db", "/api/v1/auth/login"]) {
    assert.equal(publicPath(path), true);
  }
  const headers = new Headers();
  headers.append("Set-Cookie", "access=synthetic; Secure; HttpOnly");
  headers.append("Set-Cookie", "refresh=synthetic; Secure; HttpOnly");
  const response = privateResponse(new Response(null, { headers }));
  assert.deepEqual(response.headers.getSetCookie(), headers.getSetCookie());
});

test("private outbound limiter accepts only bounded hashed requests and fails closed on backend outages", async () => {
  let calls = 0;
  const payload = { bucket: `${"b".repeat(64)}-60`, maximum: 20, windowSeconds: 60 };
  const env = { RATE_LIMITS: { getByName(name) {
    assert.equal(name, payload.bucket);
    return { async allow(maximum, window) { calls++; assert.equal(maximum, 20); assert.equal(window, 60);
      return { allowed: false, retryAfter: 23 }; } };
  } } };
  const request = (body = payload, url = "http://rate-limit.kova.internal/allow", method = "POST") => new Request(url, {
    method, ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
  const response = await rateLimitBridge(request(), env);
  assert.deepEqual(await response.json(), { allowed: false, retryAfter: 23 });
  assert.equal(calls, 1);
  for (const input of [{ ...payload, bucket: "raw-user@example.test" }, { ...payload, maximum: 0 },
    { ...payload, windowSeconds: 86401 }, { ...payload, bucket: `${"b".repeat(64)}-30` },
    { ...payload, extra: "unexpected" }, "not-json"]) {
    assert.equal((await rateLimitBridge(request(input), env)).status, 400);
  }
  for (const url of ["https://rate-limit.kova.internal/allow", "http://public.test/allow",
    "http://rate-limit.kova.internal/allow?extra=1", "http://rate-limit.kova.internal:8000/allow"]) {
    assert.equal((await rateLimitBridge(request(payload, url), env)).status, 404);
  }
  assert.equal((await rateLimitBridge(request(payload, undefined, "GET"), env)).status, 404);
  assert.equal((await rateLimitBridge(request("x".repeat(513)), env)).status, 413);
  assert.equal(calls, 1);
  env.RATE_LIMITS.getByName = () => { throw new Error("synthetic outage"); };
  assert.equal((await rateLimitBridge(request(), env)).status, 503);
});

test("existing SQLite buckets survive controller changes and blocked attempts do not extend the window", async () => {
  const database = new DatabaseSync(":memory:");
  const values = new Map();
  let alarm;
  let deleted = false;
  const ctx = { storage: {
    sql: { exec(sql, ...args) { const statement = database.prepare(sql); return sql.startsWith("SELECT")
      ? { one: () => statement.get(...args) } : statement.run(...args); } },
    async put(key, value) { values.set(key, value); },
    async get(key) { return values.get(key); },
    async setAlarm(value) { alarm = value; },
    async deleteAll() { deleted = true; database.exec("DELETE FROM hits"); values.clear(); },
  } };
  class FakeDurableObject { constructor(ctx) { this.ctx = ctx; } }
  const Limiter = persistentRateLimitClass(FakeDurableObject);
  const original = new Limiter(ctx);
  assert.deepEqual(await original.allow(1, 60), { allowed: true, retryAfter: 0 });
  const expiry = alarm;
  const replacement = new Limiter(ctx);
  assert.equal((await replacement.allow(1, 60)).allowed, false);
  assert.equal(alarm, expiry);
  database.exec("UPDATE hits SET at = at - 61000");
  assert.equal((await replacement.allow(1, 60)).allowed, true);
  await replacement.alarm();
  assert.equal(deleted, false);
  values.set("expires", Date.now() - 1);
  await replacement.alarm();
  assert.equal(deleted, true);
  for (const args of [[0, 60], [1, 0], [1.5, 60], [1, 86401]]) {
    await assert.rejects(() => replacement.allow(...args), /Invalid rate limit/);
  }
  database.close();
});

test("private job wake preserves tenant routing, scheduler cohort refusal and bounded input", async () => {
  const tenantId = "59ab823b-003c-4354-84ce-71031527988a";
  let calls = 0;
  let accepted = true;
  const env = { JOBS: { getByName(name) {
    assert.equal(name, tenantId);
    return { async wake(value) { assert.equal(value, tenantId); calls++; return accepted; } };
  } } };
  const request = (body = { tenantId }, url = "http://jobs.kova.internal/wake", method = "POST") => new Request(url, {
    method, ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
  assert.deepEqual(await (await jobsBridge(request(), env)).json(), { scheduled: true });
  accepted = false;
  assert.deepEqual(await (await jobsBridge(request(), env)).json(), { scheduled: false });
  for (const input of [{ tenantId: tenantId.toUpperCase() }, { tenantId: "not-a-uuid" },
    { tenantId, extra: "unexpected" }, {}, null, "not-json"]) {
    assert.equal((await jobsBridge(request(input), env)).status, 400);
  }
  for (const url of ["https://jobs.kova.internal/wake", "http://public.test/wake",
    "http://jobs.kova.internal/wake?extra=1", "http://jobs.kova.internal:8000/wake"]) {
    assert.equal((await jobsBridge(request({ tenantId }, url), env)).status, 404);
  }
  assert.equal((await jobsBridge(request({ tenantId }, undefined, "GET"), env)).status, 404);
  assert.equal((await jobsBridge(request("x".repeat(513)), env)).status, 413);
  assert.equal(calls, 2);
  env.JOBS.getByName = () => { throw new Error("synthetic scheduler outage"); };
  assert.equal((await jobsBridge(request(), env)).status, 503);
});
