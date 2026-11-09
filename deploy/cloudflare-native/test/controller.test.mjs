import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { nativeEnvironment, rateLimitBridge, jobsBridge, privateResponse, publicPath } from "../policy.mjs";
import { BOOT_CONTROLLER_HEADER, residentContainerClass } from "../lifecycle.mjs";
import { persistentRateLimitClass } from "../rate-limit.mjs";
import settingsKeys from "../settings-keys.json" with { type: "json" };

const sha = "a".repeat(40);
const settings = () => ({
  APP_DATABASE_URL: "postgresql://synthetic-runtime@localhost/test",
  MIGRATION_DATABASE_URL: "postgresql://synthetic-owner@localhost/test",
  SECRET_KEY: "synthetic-test-key-not-for-production",
  KOVA_BUILD_SHA: sha,
});
const healthyBoot = (env, release = env.KOVA_BUILD_SHA, boot = env.KOVA_BUILD_SHA) => Response.json({
  status: "ok", release_sha: release,
}, { headers: boot === null ? {} : { [BOOT_CONTROLLER_HEADER]: boot } });

test("native controller preserves public raster caching only for the narrow versioned image route", async () => {
  class FakeContainer {
    constructor(ctx, env) { this.ctx = ctx; this.env = env; }
    async containerFetch() { return healthyBoot(this.env); }
    async getState() { return { status: "healthy" }; }
    async fetch() { return this.env.testResponse; }
  }
  const Resident = residentContainerClass(FakeContainer);
  const env = { ...settings(), API: { idFromName: () => ({ toString: () => "resident" }) } };
  const controller = new Resident({ id: { toString: () => "resident" }, container: { running: true } }, env);
  const path = "https://api.test/api/v1/catalog/products/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/image?v=123";
  env.testResponse = new Response("synthetic-image", { headers: {
    "Content-Type": "image/webp", "Cache-Control": "public, max-age=86400",
  } });
  const allowed = await controller.fetch(new Request(path));
  assert.match(allowed.headers.get("cache-control"), /^public, max-age=[1-9][0-9]{0,2}$/);
  assert.equal(await allowed.text(), "synthetic-image");
  for (const [url, headers, status] of [
    [path, { "Set-Cookie": "session=synthetic" }, 200],
    [path, { Vary: "Cookie" }, 200],
    [path, {}, 404],
    [path.split("?")[0], {}, 200],
    ["https://api.test/api/v1/auth/session?v=123", {}, 200],
  ]) {
    env.testResponse = new Response("not-shared", { status, headers: {
      "Content-Type": "image/png", "Cache-Control": "public, max-age=86400", ...headers,
    } });
    assert.match((await controller.fetch(new Request(url))).headers.get("cache-control"), /no-store/);
  }
});

test("runtime projection excludes unrelated secrets/resources/Fly and pins safety flags", () => {
  const env = {
    ...settings(), STRIPE_SECRET_KEY: "synthetic-stripe-value", CLOUDFLARE_API_TOKEN: "do-not-pass",
    DB_APP: { opaque: true }, FLY_API_TOKEN: "do-not-pass", FLY_APP_NAME: "retired",
    ASSISTANT_INGEST_FLY_TOKEN: "do-not-pass", ASSISTANT_DOCUMENTS_ENABLED: "true",
    ASSISTANT_INGEST_ON_DEMAND: "true", CLOUDFLARE_CONTAINER_MODE: "false",
    TRUSTED_CLIENT_IP_HEADER: "spoofed", KOVA_RELEASE_SHA: "wrong", APP_ENV: "local",
    ASSISTANT_OPEN_ROUTE: "synthetic-legacy-provider-setting",
    BILLING_TIERED_PLANS_ENABLED: "false", BILLING_PORTAL_ENABLED: "false",
    KOVA_BOOT_CONTROLLER_SHA: "untrusted-binding",
    STRIPE_ESENCIAL_PRICE_ID: "price_Esencial123", STRIPE_GESTION_PRICE_ID: "price_Gestion123",
    STRIPE_STANDARD_PORTAL_CONFIGURATION_ID: "bpc_Basic123",
    STRIPE_TIERED_PORTAL_CONFIGURATION_ID: "bpc_Basic123",
    DATABASE_POOL_RECYCLE_SECONDS: "300",
  };
  const result = nativeEnvironment(env);
  assert.equal(result.STRIPE_SECRET_KEY, env.STRIPE_SECRET_KEY);
  assert.equal(result.ASSISTANT_OPEN_ROUTE, env.ASSISTANT_OPEN_ROUTE);
  for (const name of ["CLOUDFLARE_API_TOKEN", "DB_APP", "FLY_API_TOKEN", "FLY_APP_NAME", "ASSISTANT_INGEST_FLY_TOKEN"]) {
    assert.equal(Object.hasOwn(result, name), false);
  }
  assert.equal(result.APP_ENV, "production");
  assert.equal(result.DATABASE_URL, env.MIGRATION_DATABASE_URL);
  assert.equal(Object.hasOwn(result, "KOVA_RELEASE_SHA"), false);
  assert.equal(result.CLOUDFLARE_CONTAINER_MODE, "true");
  assert.equal(result.TRUSTED_CLIENT_IP_HEADER, "x-kova-client-ip");
  assert.equal(result.ASSISTANT_DOCUMENTS_ENABLED, "false");
  assert.equal(result.ASSISTANT_INGEST_ON_DEMAND, "false");
  assert.equal(result.BILLING_TIERED_PLANS_ENABLED, "true");
  assert.equal(result.BILLING_PORTAL_ENABLED, "true");
  assert.equal(result.KOVA_BOOT_CONTROLLER_SHA, sha);
  for (const name of ["STRIPE_ESENCIAL_PRICE_ID", "STRIPE_GESTION_PRICE_ID",
    "STRIPE_STANDARD_PORTAL_CONFIGURATION_ID", "STRIPE_TIERED_PORTAL_CONFIGURATION_ID"]) {
    assert.equal(result[name], env[name]);
  }
  assert.equal(result.DATABASE_POOL_RECYCLE_SECONDS, "1800");
  assert.equal(result.DATABASE_POOL_SIZE, "3");
  assert.equal(result.DATABASE_MAX_OVERFLOW, "0");
  for (const name of ["APP_DATABASE_URL", "MIGRATION_DATABASE_URL", "SECRET_KEY", "KOVA_BUILD_SHA"]) {
    const missing = { ...env }; delete missing[name];
    assert.throws(() => nativeEnvironment(missing));
  }
});

test("WhatsApp pilot configuration is explicit and disabled when absent", () => {
  const disabled = nativeEnvironment(settings());
  assert.equal(Object.hasOwn(disabled, "KOVA_WHATSAPP_ENABLED"), false);
  assert.equal(Object.hasOwn(disabled, "WHATSAPP_CONNECTIONS"), false);
  const supplied = {
    ...settings(), KOVA_WHATSAPP_ENABLED: "true", WHATSAPP_GRAPH_API_VERSION: "v26.0",
    WHATSAPP_APP_SECRET: "synthetic-app-secret", WHATSAPP_WEBHOOK_VERIFY_TOKEN: "synthetic-verify-token",
    WHATSAPP_CONNECTIONS: "synthetic-secret-registry",
  };
  const configured = nativeEnvironment(supplied);
  for (const key of ["KOVA_WHATSAPP_ENABLED", "WHATSAPP_GRAPH_API_VERSION", "WHATSAPP_APP_SECRET", "WHATSAPP_WEBHOOK_VERIFY_TOKEN", "WHATSAPP_CONNECTIONS"]) {
    assert.equal(configured[key], supplied[key]);
  }
});

test("image identities cannot be overridden even by future Settings allowlist entries", () => {
  const originalKeys = [...settingsKeys];
  try {
    // Simulate Settings later exposing either image-owned field. Neither may
    // ever become a container.start env override, regardless of its value.
    settingsKeys.push("KOVA_IMAGE_SHA", "KOVA_RELEASE_SHA", "KOVA_BOOT_CONTROLLER_SHA");
    for (const value of ["malicious", "b".repeat(40), sha]) {
      const projected = nativeEnvironment({
        ...settings(), KOVA_RELEASE_SHA: value, KOVA_IMAGE_SHA: value, KOVA_BOOT_CONTROLLER_SHA: value,
      });
      assert.equal(Object.hasOwn(projected, "KOVA_RELEASE_SHA"), false);
      assert.equal(Object.hasOwn(projected, "KOVA_IMAGE_SHA"), false);
      assert.equal(projected.KOVA_BOOT_CONTROLLER_SHA, sha);
    }
  } finally {
    settingsKeys.splice(0, settingsKeys.length, ...originalKeys);
  }
});

test("rolling image keeps baked identities but readiness requires the controller's expected SHA", async () => {
  const imageSha = "b".repeat(40);
  let processEnvironment;
  let databaseReads = 0;
  class FakeContainer {
    constructor(ctx, env) { this.ctx = ctx; this.env = env; }
    async getState() { return { status: this.ctx.container.running ? "healthy" : "stopped" }; }
    async startAndWaitForPorts() {
      // The SDK forwards envVars as container.start({env}); start overrides
      // image defaults. Exercise that merge with an old Worker and new image.
      processEnvironment = { KOVA_RELEASE_SHA: imageSha, KOVA_IMAGE_SHA: imageSha, ...this.envVars };
      assert.equal(processEnvironment.KOVA_RELEASE_SHA, imageSha);
      assert.equal(processEnvironment.KOVA_IMAGE_SHA, imageSha);
      this.ctx.container.running = true;
    }
    async containerFetch(url) {
      if (url.endsWith("/db")) { databaseReads++; return new Response(null); }
      return healthyBoot(this.env, processEnvironment.KOVA_RELEASE_SHA, processEnvironment.KOVA_BOOT_CONTROLLER_SHA);
    }
  }
  const Resident = residentContainerClass(FakeContainer);
  const env = { ...settings(), KOVA_RELEASE_SHA: "malicious", KOVA_IMAGE_SHA: "malicious",
    API: { idFromName: () => ({ toString: () => "resident" }) } };
  const context = () => ({ id: { toString: () => "resident" }, container: { running: false } });
  const oldController = new Resident(context(), env);
  await assert.rejects(() => oldController.ready(), /release identity mismatch/);
  assert.equal(databaseReads, 0, "mismatching image must not pass readiness");
  const matchingController = new Resident(context(), { ...env, KOVA_BUILD_SHA: imageSha });
  assert.equal((await matchingController.ready()).release_sha, imageSha);
  assert.equal(databaseReads, 1, "matching image still must prove database readiness");
});

test("only api-0 starts the process; all other existing API objects proxy there", async () => {
  let starts = 0;
  let proxyCalls = 0;
  let proxiedRequest;
  class FakeContainer {
    constructor(ctx, env) { this.ctx = ctx; this.env = env; }
    async containerFetch() { return healthyBoot(this.env); }
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
        [BOOT_CONTROLLER_HEADER]: "spoofed",
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
    assert.equal(proxiedRequest.headers.has(BOOT_CONTROLLER_HEADER), false);
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
      return healthyBoot(this.env, release);
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
    async containerFetch() { return healthyBoot(this.env); }
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

function bootHandoffFixture({ image = "b".repeat(40), boot = "a".repeat(40),
  running = true, markerOverride, beforeHealth, requestReadiness = { readinessWaitMs: 0 } } = {}) {
  const process = { image, boot, tiered: "false", portal: "false" };
  const counts = { starts: 0, stops: 0, probes: 0, health: 0, database: 0, forwarded: [] };
  const ctx = { id: { toString: () => "resident" }, container: { running } };
  class FakeSdk {
    constructor(context, env) { this.ctx = context; this.env = env; }
    async getState() { return { status: this.ctx.container.running ? "healthy" : "stopped" }; }
    async startAndWaitForPorts(options) {
      counts.probes++;
      assert.deepEqual(options, { cancellationOptions: {
        instanceGetTimeoutMS: 60_000, portReadyTimeoutMS: 120_000,
      } });
      // Match SDK 0.3.7: probing a running container cannot replace its env.
      if (this.ctx.container.running) return;
      counts.starts++;
      process.boot = this.envVars.KOVA_BOOT_CONTROLLER_SHA;
      process.tiered = this.envVars.BILLING_TIERED_PLANS_ENABLED;
      process.portal = this.envVars.BILLING_PORTAL_ENABLED;
      this.ctx.container.running = true;
    }
    async stop() { counts.stops++; /* SIGTERM is sent; process exit is asynchronous. */ }
    async schedule() { /* Existing SDK scheduler owns the later restart. */ }
    async containerFetch(url, init) {
      if (url.endsWith("/db")) { counts.database++; return new Response(null); }
      counts.health++;
      assert.ok(init === undefined || init.signal instanceof AbortSignal);
      if (beforeHealth) await beforeHealth();
      return healthyBoot(this.env, process.image, markerOverride === undefined ? process.boot : markerOverride);
    }
    async fetch(request) {
      counts.forwarded.push({ method: request.method, body: await request.text() });
      if (new URL(request.url).pathname === "/health") return healthyBoot(this.env, process.image, process.boot);
      return new Response("application-response");
    }
  }
  // Denial fixtures use an exhausted request-wait budget. Dedicated cases below
  // exercise a real bounded handoff wait with a controllable clock and stop.
  const Resident = residentContainerClass(FakeSdk, requestReadiness);
  return { process, counts, ctx,
    controller(expected = image, tiered = "false") {
      const controller = new Resident(ctx, { ...settings(), KOVA_BUILD_SHA: expected,
        API: { idFromName: () => ({ toString: () => "resident" }) } });
      // Model two reviewed Worker policies on the same runtime, independently
      // of the OFF pinning asserted by the projection test above.
      controller.envVars.BILLING_TIERED_PLANS_ENABLED = tiered;
      controller.envVars.BILLING_PORTAL_ENABLED = tiered;
      return controller;
    },
    async finishStop(controller) { ctx.container.running = false; await controller.onStop(); },
  };
}

test("forward and rollback handoffs replace stale boot settings once, without replaying blocked writes", async t => {
  t.mock.method(console, "error", () => {});
  const oldSha = "a".repeat(40), newSha = "b".repeat(40);
  const fixture = bootHandoffFixture();
  const next = fixture.controller(newSha, "true");
  const write = body => new Request("https://api.test/api/v1/orders", { method: "POST", body });
  const blocked = await next.fetch(write("first-write-not-replayed"));
  assert.equal(blocked.status, 503);
  assert.match(blocked.headers.get("cache-control"), /no-store/);
  assert.equal(fixture.ctx.container.running, true, "stop does not imply that SIGTERM has finished");
  const draining = await Promise.all(Array.from({ length: 8 }, () => next.fetch(write("draining-write"))));
  assert.ok(draining.every(response => response.status === 503));
  assert.equal(fixture.counts.stops, 1);
  assert.equal(fixture.counts.starts, 0);
  assert.equal(fixture.counts.forwarded.length, 0);
  assert.equal(fixture.process.tiered, "false");
  await fixture.finishStop(next);
  const admitted = await Promise.all(Array.from({ length: 8 }, (_, index) => next.fetch(write(`new-write-${index}`))));
  assert.ok(admitted.every(response => response.status === 200));
  assert.equal(fixture.counts.starts, 1);
  assert.equal(fixture.counts.stops, 1);
  assert.equal(fixture.counts.health, 2, "concurrent requests share one check per boot");
  assert.equal(fixture.process.tiered, "true");
  assert.equal(fixture.process.portal, "true");
  assert.equal(fixture.process.boot, newSha);
  assert.equal(fixture.counts.forwarded.length, 8);
  assert.ok(fixture.counts.forwarded.every(call => call.body.startsWith("new-write-")));
  assert.equal((await next.ready()).release_sha, newSha);
  assert.equal(fixture.counts.database, 1);

  // Provider restores the old image while the newer Worker is still present.
  // Its process keeps the newer startup settings until the old Worker checks it.
  fixture.process.image = oldSha;
  const restored = fixture.controller(oldSha, "false");
  assert.equal((await restored.fetch(write("rollback-write-not-replayed"))).status, 503);
  assert.equal(fixture.counts.stops, 2);
  assert.equal(fixture.process.tiered, "true");
  await fixture.finishStop(restored);
  assert.equal((await restored.ready()).release_sha, oldSha);
  assert.equal(fixture.counts.starts, 2);
  assert.equal(fixture.process.tiered, "false");
  assert.equal(fixture.process.portal, "false");
  assert.equal(fixture.process.boot, oldSha);
  assert.equal(fixture.counts.forwarded.length, 8);
});

test("missing, malformed or foreign boot identities cannot cause repeated stop loops or false readiness", async () => {
  for (const marker of [null, "", "not-a-sha", "c".repeat(39), "c".repeat(40)]) {
    const fixture = bootHandoffFixture({ markerOverride: marker });
    const controller = fixture.controller();
    await assert.rejects(() => controller.ready(), /boot reconfiguration pending/);
    assert.equal(fixture.counts.stops, 1);
    await assert.rejects(() => controller.ready(), /boot reconfiguration pending/);
    assert.equal(fixture.counts.stops, 1, "a draining process is never signalled again");
    await fixture.finishStop(controller);
    for (let attempt = 0; attempt < 3; attempt++) {
      await assert.rejects(() => controller.ready(), /boot reconfiguration pending/);
    }
    assert.equal(fixture.counts.starts, 1);
    assert.equal(fixture.counts.stops, 1, "a defective replacement must fail without a blind restart loop");
    assert.equal(fixture.counts.database, 0);
    assert.equal(fixture.counts.forwarded.length, 0);
  }
});

test("a matching running process survives Worker eviction without a forced restart", async () => {
  const fixture = bootHandoffFixture({ boot: "b".repeat(40) });
  const first = fixture.controller();
  await Promise.all([first.ensureReady(), first.ensureReady(), first.ensureReady()]);
  await first.ensureReady();
  assert.equal(fixture.counts.health, 1);
  const afterEviction = fixture.controller();
  await afterEviction.ensureReady();
  await afterEviction.ensureReady();
  assert.equal(fixture.counts.health, 2, "a replacement controller verifies the actual process once");
  assert.equal(fixture.counts.starts, 0);
  assert.equal(fixture.counts.stops, 0);
});

test("an overlapping image cannot pass readiness or trigger an application-controlled restart", async () => {
  const fixture = bootHandoffFixture({ image: "a".repeat(40), boot: null });
  const controller = fixture.controller("b".repeat(40));
  await assert.rejects(() => controller.ready(), /release identity mismatch/);
  assert.equal(fixture.counts.stops, 0);
  assert.equal(fixture.counts.database, 0);
  assert.equal(fixture.counts.forwarded.length, 0);
});

test("bounded handoff serves an already healthy captured image with its original policy, without declaring readiness", async t => {
  t.mock.method(console, "error", () => {});
  const previous = "a".repeat(40), target = "b".repeat(40);
  const fixture = bootHandoffFixture({ image: previous, boot: previous });
  const controller = fixture.controller(target, "true");
  controller.env.KOVA_NATIVE_HANDOFF = JSON.stringify({ previousSha: previous, expiresAt: Date.now() + 60_000 });
  const writes = Array.from({ length: 8 }, (_, index) => controller.fetch(new Request("https://api.test/api/v1/orders", {
    method: "POST", body: `original-${index}`,
  })));
  assert.ok((await Promise.all(writes)).every(response => response.status === 200));
  assert.equal(fixture.counts.forwarded.length, 8);
  assert.equal(new Set(fixture.counts.forwarded.map(call => call.body)).size, 8, "no write is replayed");
  assert.equal(fixture.process.tiered, "false", "old process keeps its own reviewed startup policy");
  assert.equal(controller.bootVerified, false, "previous-image exception must never be cached");
  assert.equal(fixture.counts.starts, 0);
  assert.equal(fixture.counts.stops, 0);
  const publicHealth = await controller.fetch(new Request("https://api.test/health"));
  assert.equal((await publicHealth.json()).release_sha, previous);
  assert.equal(publicHealth.headers.get(BOOT_CONTROLLER_HEADER), previous, "health never relabels the old process");
  await assert.rejects(() => controller.ready(), /release identity mismatch/);
  assert.equal(fixture.counts.database, 0, "the old release cannot pass candidate acceptance");
  await controller.ensureReady();
  assert.ok(fixture.counts.health >= 3, "baseline identity is reprobed after each shared request batch");

  // The platform completes its image replacement; the new process captures
  // only the new controller environment and must prove both identities.
  fixture.process.image = target;
  await fixture.finishStop(controller);
  assert.equal((await controller.ready()).release_sha, target);
  assert.equal(fixture.process.boot, target);
  assert.equal(fixture.process.tiered, "true");
  assert.equal(fixture.counts.starts, 1);
  assert.equal(controller.bootVerified, true);
});

test("handoff cannot admit expired, cold, foreign, or incorrectly booted old processes", async t => {
  t.mock.method(console, "error", () => {});
  const previous = "a".repeat(40), target = "b".repeat(40);
  for (const change of [{ expiresAt: Date.now() - 1 }, { boot: null }, { boot: target },
    { image: "c".repeat(40) }, { running: false }, { unhealthy: true }, { portProbeRequired: true }]) {
    const fixture = bootHandoffFixture({ image: previous, boot: previous, ...change });
    const controller = fixture.controller(target);
    controller.env.KOVA_NATIVE_HANDOFF = JSON.stringify({ previousSha: previous,
      expiresAt: change.expiresAt ?? Date.now() + 60_000 });
    if (change.unhealthy) controller.getState = async () => ({ status: "starting" });
    if (change.portProbeRequired) controller.portProbeRequired = true;
    const response = await controller.fetch(new Request("https://api.test/api/v1/orders", { method: "POST", body: "never-replayed" }));
    assert.equal(response.status, 503, JSON.stringify(change));
    assert.equal(fixture.counts.forwarded.length, 0);
    assert.equal(fixture.counts.stops, 0, "a foreign image cannot be restarted by application logic");
  }
});

test("handoff deadline and concurrent stop are rechecked without extending the lease", async t => {
  t.mock.method(console, "error", () => {});
  t.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const previous = "a".repeat(40), target = "b".repeat(40);
  const fixture = bootHandoffFixture({ image: previous, boot: previous });
  const controller = fixture.controller(target);
  controller.env.KOVA_NATIVE_HANDOFF = JSON.stringify({ previousSha: previous, expiresAt: Date.now() + 10 });
  await controller.ensureReady();
  t.mock.timers.tick(11);
  await assert.rejects(() => controller.ensureReady(), /release identity mismatch/);
  assert.equal(fixture.counts.forwarded.length, 0);
  assert.equal(fixture.counts.starts, 0);
  assert.equal(fixture.counts.stops, 0);
  const interrupted = bootHandoffFixture({ image: previous, boot: previous,
    beforeHealth: () => { interrupted.ctx.container.running = false; } });
  const racing = interrupted.controller(target);
  racing.env.KOVA_NATIVE_HANDOFF = JSON.stringify({ previousSha: previous, expiresAt: Date.now() + 10_000 });
  await assert.rejects(() => racing.ensureReady(), /previous image handoff pending/);
  assert.equal(interrupted.counts.forwarded.length, 0);
});

test("request headers cannot grant an old-image handoff or rewrite its boot environment", async t => {
  t.mock.method(console, "error", () => {});
  const previous = "a".repeat(40), target = "b".repeat(40);
  const fixture = bootHandoffFixture({ image: previous, boot: previous });
  const controller = fixture.controller(target);
  const response = await controller.fetch(new Request("https://api.test/api/v1/orders", {
    method: "POST", body: "blocked", headers: {
      "x-kova-native-handoff": JSON.stringify({ previousSha: previous, expiresAt: Date.now() + 60_000 }),
      [BOOT_CONTROLLER_HEADER]: target,
    },
  }));
  assert.equal(response.status, 503);
  assert.equal(fixture.counts.forwarded.length, 0);
  assert.equal(fixture.process.boot, previous);
});

test("requests share a bounded pre-forward stop wait and each write is sent exactly once after verified restart", async () => {
  let clock = Date.now(), waits = 0, controller;
  const fixture = bootHandoffFixture({ requestReadiness: { now: () => clock, wait: async ms => {
    waits++; clock += ms;
    assert.equal(fixture.counts.forwarded.length, 0, "business payloads must remain unsent while draining");
    await fixture.finishStop(controller);
  } } });
  controller = fixture.controller("b".repeat(40), "true");
  controller.env.KOVA_NATIVE_HANDOFF = JSON.stringify({ previousSha: "a".repeat(40), expiresAt: clock + 60_000 });
  const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => controller.fetch(new Request(
    "https://api.test/api/v1/orders", { method: "POST", body: `single-${index}` }))));
  assert.ok(responses.every(response => response.status === 200));
  assert.equal(waits, 1, "concurrent callers share the same original wait budget");
  assert.equal(fixture.counts.stops, 1);
  assert.equal(fixture.counts.starts, 1);
  assert.equal(fixture.counts.forwarded.length, 8);
  assert.equal(new Set(fixture.counts.forwarded.map(call => call.body)).size, 8);
  assert.equal(fixture.process.boot, "b".repeat(40));
  assert.equal(fixture.process.tiered, "true");
});

test("a draining captured old image waits for replacement and never receives a business write", async () => {
  let clock = Date.now(), controller;
  const fixture = bootHandoffFixture({ image: "a".repeat(40), boot: "a".repeat(40),
    requestReadiness: { now: () => clock, wait: async ms => {
      clock += ms;
      assert.equal(fixture.counts.forwarded.length, 0);
      fixture.process.image = "b".repeat(40);
      await fixture.finishStop(controller);
    } } });
  controller = fixture.controller("b".repeat(40));
  const state = controller.getState.bind(controller);
  controller.getState = async () => fixture.process.image === "a".repeat(40) ? { status: "stopping" } : state();
  controller.env.KOVA_NATIVE_HANDOFF = JSON.stringify({ previousSha: "a".repeat(40), expiresAt: clock + 60_000 });
  const response = await controller.fetch(new Request("https://api.test/api/v1/orders", { method: "POST", body: "once" }));
  assert.equal(response.status, 200);
  assert.equal(fixture.counts.forwarded.length, 1);
  assert.equal(fixture.counts.forwarded[0].body, "once");
  assert.equal(fixture.counts.starts, 1);
  assert.equal(fixture.counts.stops, 0, "only the platform initiates the image rollout stop");
});

test("startup failure during an active handoff can wait before the first business dispatch", async () => {
  let clock = Date.now(), waits = 0;
  const fixture = bootHandoffFixture({ image: "b".repeat(40), boot: "a".repeat(40), running: false,
    requestReadiness: { now: () => clock, wait: async ms => { clock += ms; waits++; } } });
  const controller = fixture.controller();
  const start = controller.startAndWaitForPorts.bind(controller);
  controller.startAndWaitForPorts = async options => {
    if (waits === 0) throw new Error("synthetic-private-provider-startup");
    return start(options);
  };
  controller.env.KOVA_NATIVE_HANDOFF = JSON.stringify({ previousSha: "a".repeat(40), expiresAt: clock + 60_000 });
  assert.equal((await controller.fetch(new Request("https://api.test/health"))).status, 200);
  assert.equal(waits, 1);
  assert.equal(fixture.counts.forwarded.length, 1);
});

test("pre-forward wait expires without extending the lease, repeating SIGTERM or dispatching a write", async t => {
  t.mock.method(console, "error", () => {});
  for (const leaseMs of [10_000, 60_000]) {
    const started = Date.now(); let clock = started;
    const fixture = bootHandoffFixture({ requestReadiness: { now: () => clock,
      wait: async ms => { clock += ms; } } });
    const controller = fixture.controller();
    controller.env.KOVA_NATIVE_HANDOFF = JSON.stringify({ previousSha: "a".repeat(40), expiresAt: started + leaseMs });
    const responses = await Promise.all(Array.from({ length: 3 }, () => controller.fetch(new Request(
      "https://api.test/api/v1/orders", { method: "POST", body: "never-dispatched" }))));
    assert.ok(responses.every(response => response.status === 503));
    assert.equal(clock - started, Math.min(leaseMs, 30_000));
    assert.equal(fixture.counts.stops, 1);
    assert.equal(fixture.counts.starts, 0);
    assert.equal(fixture.counts.forwarded.length, 0);
  }
});

test("malformed or unknown image/boot identities fail immediately even inside the handoff window", async t => {
  t.mock.method(console, "error", () => {});
  for (const change of [{ image: "c".repeat(40), boot: "c".repeat(40) }, { image: "a".repeat(40), boot: null }]) {
    const fixture = bootHandoffFixture({ ...change, requestReadiness: { wait: assert.fail } });
    const controller = fixture.controller("b".repeat(40));
    controller.env.KOVA_NATIVE_HANDOFF = JSON.stringify({ previousSha: "a".repeat(40), expiresAt: Date.now() + 60_000 });
    assert.equal((await controller.fetch(new Request("https://api.test/api/v1/orders", {
      method: "POST", body: "blocked" }))).status, 503);
    assert.equal(fixture.counts.forwarded.length, 0);
    assert.equal(fixture.counts.stops, 0);
  }
});

test("cold startup and an observed stop revalidate the new process instead of reusing stale readiness", async () => {
  const fixture = bootHandoffFixture({ running: false });
  const controller = fixture.controller();
  await Promise.all([controller.ensureReady(), controller.ensureReady()]);
  assert.equal(fixture.counts.starts, 1);
  assert.equal(fixture.counts.health, 1);
  await fixture.finishStop(controller);
  await Promise.all([controller.ensureReady(), controller.ensureReady()]);
  assert.equal(fixture.counts.starts, 2);
  assert.equal(fixture.counts.health, 2);
  assert.equal(fixture.counts.stops, 0);
});

test("a stop during the boot check invalidates its result before any business request is forwarded", async t => {
  t.mock.method(console, "error", () => {});
  let releaseHealth;
  let blockHealth = true;
  const healthBlocked = new Promise(resolve => { releaseHealth = resolve; });
  const fixture = bootHandoffFixture({ boot: "b".repeat(40), beforeHealth: () => blockHealth ? healthBlocked : undefined });
  const controller = fixture.controller();
  const pending = controller.fetch(new Request("https://api.test/api/v1/orders", { method: "POST", body: "not-replayed" }));
  await new Promise(resolve => setImmediate(resolve));
  await fixture.finishStop(controller);
  releaseHealth();
  assert.equal((await pending).status, 503);
  assert.equal(fixture.counts.forwarded.length, 0);
  blockHealth = false;
  await controller.ensureReady();
  assert.equal(fixture.counts.starts, 1);
  assert.equal(fixture.counts.stops, 0);
  assert.equal(fixture.counts.health, 2);
});

test("failed or malformed boot health never permits traffic, exposes its body or initiates a restart", async t => {
  const logs = [];
  t.mock.method(console, "error", value => logs.push(value));
  for (const health of [
    () => new Response("synthetic-private-health", { status: 503 }),
    () => new Response("synthetic-private-not-json", { headers: { [BOOT_CONTROLLER_HEADER]: sha } }),
    () => Response.json({ status: "bad", release_sha: sha }, { headers: { [BOOT_CONTROLLER_HEADER]: sha } }),
    () => Response.json(null, { headers: { [BOOT_CONTROLLER_HEADER]: sha } }),
  ]) {
    let forwarded = 0, stops = 0;
    class FakeSdk {
      constructor(ctx, env) { this.ctx = ctx; this.env = env; }
      async getState() { return { status: "healthy" }; }
      async containerFetch() { return health(); }
      async stop() { stops++; }
      async fetch() { forwarded++; return new Response("must-not-forward"); }
    }
    const Resident = residentContainerClass(FakeSdk);
    const controller = new Resident({ id: { toString: () => "resident" }, container: { running: true } }, {
      ...settings(), API: { idFromName: () => ({ toString: () => "resident" }) },
    });
    const response = await controller.fetch(new Request("https://api.test/api/v1/orders", { method: "POST", body: "test-write" }));
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes("synthetic-private"), false);
    assert.equal(forwarded, 0);
    assert.equal(stops, 0);
  }
  assert.deepEqual(logs, Array(4).fill(JSON.stringify({ event: "native_backend_unavailable" })));
});

test("boot health has a bounded abort signal and a timed-out check can be retried without replaying a write", async t => {
  t.mock.method(console, "error", () => {});
  const abort = new AbortController();
  t.mock.method(AbortSignal, "timeout", timeout => {
    assert.equal(timeout, 10_000);
    return abort.signal;
  });
  let health = 0, forwarded = 0;
  class FakeSdk {
    constructor(ctx, env) { this.ctx = ctx; this.env = env; }
    async getState() { return { status: "healthy" }; }
    async containerFetch(url, init) {
      health++;
      if (health > 1) return healthyBoot(this.env);
      assert.equal(url, "http://container/health");
      return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    }
    async fetch() { forwarded++; return new Response("ok"); }
    async stop() { assert.fail("a health timeout is not evidence of configuration drift"); }
  }
  const Resident = residentContainerClass(FakeSdk);
  const controller = new Resident({ id: { toString: () => "resident" }, container: { running: true } }, {
    ...settings(), API: { idFromName: () => ({ toString: () => "resident" }) },
  });
  const pending = controller.fetch(new Request("https://api.test/api/v1/orders", { method: "POST", body: "not-replayed" }));
  await new Promise(resolve => setImmediate(resolve));
  abort.abort(new DOMException("synthetic-private-timeout", "TimeoutError"));
  const timedOut = await pending;
  assert.equal(timedOut.status, 503);
  assert.equal((await timedOut.text()).includes("synthetic-private"), false);
  assert.equal(forwarded, 0);
  assert.equal((await controller.fetch(new Request("https://api.test/health"))).status, 200);
  assert.equal(health, 2);
  assert.equal(forwarded, 1);
});

test("readiness RPC rechecks the boot marker even after a successful cached verification", async () => {
  const fixture = bootHandoffFixture({ boot: "b".repeat(40) });
  const controller = fixture.controller();
  await controller.ensureReady();
  fixture.process.boot = "a".repeat(40);
  await assert.rejects(() => controller.ready(), /boot identity mismatch/);
  assert.equal(fixture.counts.database, 0);
  await assert.rejects(() => controller.ensureReady(), /boot reconfiguration pending/);
  assert.equal(fixture.counts.stops, 1, "failed RPC readiness invalidates the cached boot check");
});

test("SDK transport responses become redacted 503s and force the next port probe without replaying writes", async t => {
  const logs = [];
  const originalLog = console.error;
  console.error = value => logs.push(value);
  t.after(() => { console.error = originalLog; });
  for (const message of ["Failed to start container: synthetic-private-detail",
    "Container suddenly disconnected, try again",
    "Error proxying request to container: synthetic-private-detail"]) {
    let probes = 0;
    const calls = [];
    let failed = true;
    class FakeContainer {
      constructor(ctx, env) { this.ctx = ctx; this.env = env; }
      async containerFetch() { return healthyBoot(this.env); }
      async getState() { return { status: "healthy" }; }
      async startAndWaitForPorts(options) {
        probes++;
        assert.equal(options.cancellationOptions.portReadyTimeoutMS, 120_000);
      }
      async fetch(request) {
        calls.push({ method: request.method, body: await request.text() });
        return failed ? new Response(message, { status: 500 })
          : Response.json({ status: "ok", release_sha: sha }, {
            headers: { "X-Kova-Runtime": "native-resident", "X-Kova-Process-Id": "b".repeat(32) },
          });
      }
    }
    const Resident = residentContainerClass(FakeContainer);
    const env = { ...settings(), API: { idFromName: () => ({ toString: () => "resident" }) },
      KOVA_NATIVE_HANDOFF: JSON.stringify({ previousSha: "c".repeat(40), expiresAt: Date.now() + 60_000 }) };
    const resident = new Resident({ id: { toString: () => "resident" }, container: { running: true } }, env);
    const unavailable = await resident.fetch(new Request("https://api.test/api/v1/orders", {
      method: "POST", body: "synthetic-write",
    }));
    assert.equal(unavailable.status, 503);
    assert.match(unavailable.headers.get("cache-control"), /no-store/);
    assert.equal((await unavailable.text()).includes(message), false);
    assert.deepEqual(calls, [{ method: "POST", body: "synthetic-write" }]);
    assert.equal(probes, 0);
    failed = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const healthy = await resident.fetch(new Request("https://api.test/health"));
      assert.equal(healthy.status, 200);
      assert.equal(healthy.headers.get("x-kova-runtime"), "native-resident");
    }
    assert.equal(probes, 1, "the next request refreshes readiness; later healthy requests reuse it");
    assert.equal(calls.length, 3, "a failed write is never automatically replayed");
  }
  assert.equal(logs.length, 3);
  assert.ok(logs.every(value => value === JSON.stringify({ event: "native_backend_unavailable" })));
});

test("real application errors and unrecognized 500 responses stay failures without being reclassified", async () => {
  let probes = 0;
  class FakeContainer {
    constructor(ctx, env) { this.ctx = ctx; this.env = env; }
    async containerFetch() { return healthyBoot(this.env); }
    async getState() { return { status: "healthy" }; }
    async startAndWaitForPorts() { probes++; }
    async fetch() { return this.env.response; }
  }
  const Resident = residentContainerClass(FakeContainer);
  const env = { ...settings(), API: { idFromName: () => ({ toString: () => "resident" }) } };
  const resident = new Resident({ id: { toString: () => "resident" }, container: { running: true } }, env);
  const sdkMessage = "Container suddenly disconnected, try again";
  for (const [body, headers] of [
    [sdkMessage, { "X-Kova-Runtime": "native-resident" }],
    [sdkMessage, { "X-Kova-Process-Id": "b".repeat(32) }],
    [sdkMessage, { "Content-Type": "application/json" }],
    ["Unrecognized application error".repeat(100), {}],
  ]) {
    env.response = new Response(body, { status: 500, headers });
    const response = await resident.fetch(new Request("https://api.test/health"));
    assert.equal(response.status, 500);
    assert.equal(await response.text(), body);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
  assert.equal(probes, 0);
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

function diagnosticResident({ running = true, ready = Promise.resolve(), response,
  resident = true, forwarded } = {}) {
  class FakeContainer {
    constructor(ctx, env) { this.ctx = ctx; this.env = env; }
    async containerFetch() { return healthyBoot(this.env); }
    async getState() { return { status: "healthy" }; }
    async startAndWaitForPorts() { await ready; this.ctx.container.running = true; }
    async fetch(request) { return typeof response === "function" ? response(request) : await response; }
  }
  const Resident = residentContainerClass(FakeContainer);
  return new Resident({ id: { toString: () => resident ? "resident" : "proxy" }, container: { running } }, {
    ...settings(), API: { idFromName: () => ({ toString: () => "resident" }),
      getByName: () => ({ fetch: forwarded ?? (() => Response.json({ ok: true })) }) },
  });
}

function captureDiagnostic(t) {
  const events = [];
  t.mock.method(console, "info", value => events.push(JSON.parse(value)));
  return events;
}

const diagnosticRequest = (path = "/health", init = {}) => new Request(`https://api.test${path}`, {
  ...init, headers: { "X-Kova-Resident-Diagnostic": "1", ...init.headers },
});

test("acceptance diagnostics locate blocked readiness versus blocked upstream without altering responses", async t => {
  const events = captureDiagnostic(t);
  let ready, headers;
  const readyPromise = new Promise(resolve => { ready = resolve; });
  const responsePromise = new Promise(resolve => { headers = resolve; });
  const controller = diagnosticResident({ running: false, ready: readyPromise, response: responsePromise });
  const pending = controller.fetch(diagnosticRequest());
  assert.deepEqual(events.map(event => event.phase), ["ensure_ready"]);
  ready();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events.map(event => event.phase), ["ensure_ready", "start_fetch"]);
  headers(new Response("unchanged", { status: 200 }));
  const result = await pending;
  assert.equal(await result.text(), "unchanged");
  assert.match(result.headers.get("cache-control"), /no-store/);
  assert.deepEqual(events.map(event => event.phase), ["ensure_ready", "start_fetch", "response"]);
  for (const event of events) {
    assert.equal(event.event, "resident_acceptance_stage");
    assert.equal(event.route, "health");
    assert.ok(Number.isFinite(event.elapsed_ms) && event.elapsed_ms >= 0 && event.elapsed_ms <= 300000);
    assert.deepEqual(Object.keys(event).sort(), (event.phase === "response"
      ? ["event", "route", "phase", "elapsed_ms", "status"]
      : ["event", "route", "phase", "elapsed_ms"]).sort());
  }
  assert.equal(events.at(-1).status, 200);
});

test("acceptance diagnostic marker only traces the exact known contract method and path", async t => {
  const events = captureDiagnostic(t);
  const controller = diagnosticResident({ response: () => Response.json({ ok: true }) });
  for (const request of [new Request("https://api.test/health"),
    diagnosticRequest("/health", { headers: { "X-Kova-Resident-Diagnostic": "synthetic-private" } }),
    diagnosticRequest("/health", { method: "POST" }), diagnosticRequest("/health?secret=synthetic-private"),
    diagnosticRequest("/api/v1/orders/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"),
  ]) await controller.fetch(request);
  const proxy = diagnosticResident({ resident: false });
  await proxy.fetch(diagnosticRequest());
  assert.deepEqual(events, []);
  for (const [method, path, route] of [["GET", "/health", "health"],
    ["GET", "/health/db", "database_health"], ["GET", "/api/v1/auth/session", "session"],
    ["GET", "/api/v1/catalog/products", "catalog"], ["GET", "/api/v1/reports/dashboard", "dashboard"],
    ["GET", "/api/v1/purchasing/orders", "purchasing"], ["POST", "/api/v1/auth/login", "login_validation"],
  ]) {
    await controller.fetch(diagnosticRequest(path, { method }));
    assert.equal(events.at(-1).route, route);
  }
  assert.equal(events.length, 21);
  assert.doesNotMatch(JSON.stringify(events), /synthetic-private|secret|aaaaaaaa|https:/);
});

test("acceptance diagnostics cap events per resident and never expose failures or change application errors", async t => {
  const events = captureDiagnostic(t);
  t.mock.method(console, "error", () => {});
  const controller = diagnosticResident({ response: () => new Response("synthetic-private-body", {
    status: 500, headers: { "X-Kova-Runtime": "native-resident", "X-Kova-Process-Id": "synthetic-process" },
  }) });
  for (let index = 0; index < 100; index++) {
    const result = await controller.fetch(diagnosticRequest());
    assert.equal(result.status, 500);
    assert.equal(await result.text(), "synthetic-private-body");
  }
  assert.equal(events.length, 256);
  assert.doesNotMatch(JSON.stringify(events), /synthetic-private|synthetic-process/);
  const failed = diagnosticResident({ response: () => { throw new Error("synthetic-private-exception"); } });
  assert.equal((await failed.fetch(diagnosticRequest())).status, 503);
  assert.equal(events.at(-1).phase, "failed");
  assert.doesNotMatch(JSON.stringify(events), /synthetic-private/);
});

test("diagnostic logging failure cannot change a normal application response", async t => {
  t.mock.method(console, "info", () => { throw new Error("synthetic-logger-failure"); });
  const controller = diagnosticResident({ response: () => new Response("unchanged", { status: 200 }) });
  const response = await controller.fetch(diagnosticRequest());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "unchanged");
});

test("only the exact code-update reset marks a private controller failure and never replays inside the DO", async t => {
  const previous = console.error;
  console.error = () => {};
  t.after(() => { console.error = previous; });
  let calls = 0;
  class FakeContainer {
    constructor(ctx, env) { this.ctx = ctx; this.env = env; }
    async containerFetch() { return healthyBoot(this.env); }
    async getState() { return { status: "healthy" }; }
    async fetch() { calls++; throw this.env.error; }
  }
  const Resident = residentContainerClass(FakeContainer);
  const env = { ...settings(), API: { idFromName: () => ({ toString: () => "resident" }) } };
  const resident = new Resident({ id: { toString: () => "resident" }, container: { running: true } }, env);
  for (const [error, marked] of [
    [new Error("Durable Object reset because its code was updated."), true],
    [Object.assign(new Error("Durable Object reset because its code was updated."), { overloaded: true }), false],
    [new Error("Durable Object is overloaded."), false],
    [new Error("Durable Object reset because its code was updated. extra"), false],
    [new Error("synthetic-private-failure"), false],
  ]) {
    env.error = error;
    const before = calls;
    const response = await resident.fetch(new Request("https://api.test/api/v1/quotes"));
    assert.equal(calls, before + 1);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("x-kova-controller-failure"), marked ? "code-update-reset" : null);
    assert.match(response.headers.get("cache-control"), /private, no-store/);
    assert.equal((await response.text()).includes(error.message), false);
  }
});

test("an application cannot forge the controller reset marker", async () => {
  class FakeContainer {
    constructor(ctx, env) { this.ctx = ctx; this.env = env; }
    async containerFetch() { return healthyBoot(this.env); }
    async getState() { return { status: "healthy" }; }
    async fetch() { return new Response("app failure", { status: 503, headers: {
      "x-kova-controller-failure": "code-update-reset", "x-kova-runtime": "native-resident",
    } }); }
  }
  const Resident = residentContainerClass(FakeContainer);
  const env = { ...settings(), API: { idFromName: () => ({ toString: () => "resident" }) } };
  const resident = new Resident({ id: { toString: () => "resident" }, container: { running: true } }, env);
  const response = await resident.fetch(new Request("https://api.test/api/v1/quotes"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("x-kova-controller-failure"), null);
  assert.equal(await response.text(), "app failure");
});

test("only a proved code-update reset adds a fixed reason to the existing unavailable event", async t => {
  const previous = console.error;
  t.after(() => { console.error = previous; });
  const events = [];
  console.error = value => events.push(value);
  class FakeContainer {
    constructor(ctx, env) { this.ctx = ctx; this.env = env; }
    async containerFetch() { return healthyBoot(this.env); }
    async getState() { return { status: "healthy" }; }
    async fetch() { throw this.env.error; }
  }
  const Resident = residentContainerClass(FakeContainer);
  const env = { ...settings(), API: { idFromName: () => ({ toString: () => "resident" }) } };
  const resident = new Resident({ id: { toString: () => "resident" }, container: { running: true } }, env);
  env.error = new Error("Durable Object reset because its code was updated.");
  assert.equal((await resident.fetch(new Request("https://api.test/api/v1/quotes?secret=synthetic-private"))).status, 503);
  env.error = new Error("synthetic-private-failure");
  assert.equal((await resident.fetch(new Request("https://api.test/api/v1/quotes"))).status, 503);
  assert.deepEqual(events, [
    JSON.stringify({ event: "native_backend_unavailable", reason: "code_update_reset" }),
    JSON.stringify({ event: "native_backend_unavailable" }),
  ]);
  assert.equal(events.join("").includes("synthetic-private"), false);
  console.error = () => { throw new Error("synthetic-logger-failure"); };
  env.error = new Error("Durable Object reset because its code was updated.");
  const response = await resident.fetch(new Request("https://api.test/api/v1/quotes"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("x-kova-controller-failure"), "code-update-reset");
});
