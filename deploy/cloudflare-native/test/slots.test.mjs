import assert from "node:assert/strict";
import { test } from "node:test";
import { runtimeSettingsClass } from "../runtime-settings.mjs";
import { slotContainerClass } from "../slot-lifecycle.mjs";
import { nativeEnvironment } from "../policy.mjs";
import { slotWorker, nextSlot, SLOT_DRAIN_MS } from "../slots.mjs";

const sha = "a".repeat(40);
const publicIds = { STRIPE_ESENCIAL_PRICE_ID: "price_Esencial123", STRIPE_GESTION_PRICE_ID: "price_Gestion123",
  STRIPE_STANDARD_PORTAL_CONFIGURATION_ID: "bpc_Portal123", STRIPE_TIERED_PORTAL_CONFIGURATION_ID: "bpc_Portal123" };
const source = { KOVA_BUILD_SHA: "b".repeat(40), APP_DATABASE_URL: "synthetic-runtime",
  MIGRATION_DATABASE_URL: "synthetic-owner", SECRET_KEY: "synthetic-key", STRIPE_SECRET_KEY: "synthetic-stripe",
  CLOUDFLARE_API_TOKEN: "never-project", ...publicIds };

test("private settings RPC projects only native settings and requires a complete reviewed public offer", () => {
  class Entrypoint { constructor(env) { this.env = env; } }
  const Settings = runtimeSettingsClass(Entrypoint);
  const settings = new Settings(source);
  const result = settings.getRuntimeEnvironment({ sha, publicIds });
  assert.equal(result.KOVA_BOOT_CONTROLLER_SHA, sha);
  assert.equal(result.APP_DATABASE_URL, source.APP_DATABASE_URL);
  assert.equal(result.MIGRATION_DATABASE_URL, source.MIGRATION_DATABASE_URL);
  assert.equal(result.STRIPE_SECRET_KEY, source.STRIPE_SECRET_KEY);
  assert.equal(result.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(source.KOVA_BUILD_SHA, "b".repeat(40));
  for (const input of [null, {}, { sha: "short", publicIds }, { sha, publicIds: {} },
    { sha, publicIds: { ...publicIds, SECRET_KEY: "injected" } }, { sha, publicIds, SECRET_KEY: "injected" }]) {
    assert.throws(() => settings.getRuntimeEnvironment(input));
  }
});

function controllerFixture({ settingsFailure = false, badOffer = false, body = () => new Response("unchanged") } = {}) {
  let time = 1_000_000;
  const persisted = new Map();
  let configCalls = 0;
  let dispatches = 0;
  const waits = [];
  const scheduled = new Map();
  const lifecycle = { starts: 0, stops: 0 };
  const routing = { active: "green" };
  const env = { KOVA_BUILD_SHA: sha, ...publicIds,
    KOVA_NATIVE_SLOT: "green", GATEWAY_STATUS: { async getActiveSlot() { return routing.active; } },
    SETTINGS: { async getRuntimeEnvironment(input) {
      configCalls++;
      if (settingsFailure) { settingsFailure = false; throw new Error("private failure details must remain private"); }
      return nativeEnvironment({ ...source, ...input.publicIds, KOVA_BUILD_SHA: input.sha });
    } },
    API: { idFromName: () => ({ toString: () => "resident" }) },
  };
  const ctx = { id: { toString: () => "resident" }, container: { running: true },
    storage: { async get(key) { return persisted.get(key); }, async put(key, value) { persisted.set(key, value); },
      async delete(key) { persisted.delete(key); } },
    waitUntil(promise) { waits.push(promise); } };
  class Container {
    constructor(ctx, env) { this.ctx = ctx; this.env = env; }
    deleteSchedules(callback) { scheduled.delete(callback); }
    async schedule(seconds, callback) { scheduled.set(callback, seconds); }
    async stop() { lifecycle.stops++; ctx.container.running = false; await this.onStop(); }
    async startAndWaitForPorts() { lifecycle.starts++; ctx.container.running = true; }
    async getState() { return { status: "healthy" }; }
    async containerFetch(url) {
      if (url.endsWith("/billing/plans")) {
        const core = ["pos", "inventory", "sales_reports", "public_catalog"];
        return Response.json({ tiered_pricing_enabled: true,
          offer_revision: "offer-v1-4b30bf116e40f700f618fc38146bf3583f34311a8e87624ee57427f2446ce685",
          available_plans: [
            { code: "esencial", name: "Esencial", amount_minor_units: badOffer ? 40000 : 39900,
              currency: "MXN", interval: "month", tax_inclusive: true, features: core,
              limits: { branches: 1, product_image_bytes: 250_000_000 } },
            { code: "gestion", name: "Gestión", amount_minor_units: 69900,
              currency: "MXN", interval: "month", tax_inclusive: true,
              features: [...core, "purchasing", "advanced_reports", "loyalty", "customer_orders", "quotes"],
              limits: { branches: 1, product_image_bytes: 1_073_741_824 } },
          ] });
      }
      return url.endsWith("/health/db") ? Response.json({ status: "ok", db: "reachable" })
        : Response.json({ status: "ok", release_sha: sha }, { headers: {
          "x-kova-boot-controller-sha": sha, "x-kova-process-id": "a".repeat(32),
        } });
    }
    async fetch(request) { dispatches++; return body(request); }
  }
  const Slot = slotContainerClass(Container, { now: () => time });
  return { controller: new Slot(ctx, env), env, ctx, Slot, persisted, waits,
    scheduled, lifecycle, routing,
    calls: () => ({ configCalls, dispatches }), advance: ms => { time += ms; } };
}

test("concurrent requests share private bootstrap and each write is dispatched once", async () => {
  const fixture = controllerFixture();
  const responses = await Promise.all([1, 2, 3].map(() => fixture.controller.fetch(new Request(
    "https://api.test/api/v1/sales", { method: "POST", headers: { "Idempotency-Key": "unchanged-key" }, body: "original" }))));
  for (const response of responses) assert.equal(await response.text(), "unchanged");
  await Promise.all(fixture.waits);
  assert.deepEqual(fixture.calls(), { configCalls: 1, dispatches: 3 });
  assert.equal(await fixture.controller.replaceable(), false);
  fixture.advance(SLOT_DRAIN_MS);
  assert.equal(await fixture.controller.replaceable(), true);
});

test("inactive slots park after their lease and warm before being reused, while the active slot stays resident", async () => {
  const f = controllerFixture();
  await f.controller.probe();
  await f.controller.onActivityExpired();
  assert.equal(f.persisted.has("native_slot_park_after"), false);
  assert.equal(f.lifecycle.stops, 0);
  f.routing.active = "blue";
  await f.controller.onActivityExpired();
  f.advance(1_800_000);
  await f.controller.parkIfInactive();
  assert.equal(f.lifecycle.stops, 1);
  await f.controller.ensureRunning();
  assert.equal(f.lifecycle.starts, 0);
  await f.controller.probe();
  assert.equal(f.lifecycle.starts, 1);
  assert.equal(f.scheduled.size, 1);
  await f.controller.probe();
  assert.equal(f.scheduled.size, 1, "readiness retries must not accumulate scheduled callbacks");
});

test("a rollback readiness probe cancels an overlapping parking decision", async () => {
  const f = controllerFixture(); f.routing.active = "blue";
  await f.controller.onActivityExpired(); f.advance(1_800_000);
  let releaseStatus;
  const status = new Promise(resolve => { releaseStatus = resolve; });
  f.env.GATEWAY_STATUS.getActiveSlot = () => status;
  const parking = f.controller.parkIfInactive();
  await f.controller.probe();
  releaseStatus("blue"); await parking;
  assert.equal(f.lifecycle.stops, 0);
});

test("private bootstrap failure dispatches no write, exposes no details and may recover on a later request", async () => {
  const fixture = controllerFixture({ settingsFailure: true });
  const request = () => new Request("https://api.test/api/v1/sales", { method: "POST", body: "original" });
  const failed = await fixture.controller.fetch(request());
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /private failure/);
  assert.equal(fixture.calls().dispatches, 0);
  const recovered = await fixture.controller.fetch(request());
  assert.equal(await recovered.text(), "unchanged");
  assert.deepEqual(fixture.calls(), { configCalls: 2, dispatches: 1 });
});

test("a streaming response prevents replacement after the drain lease until its body closes", async () => {
  let streamController;
  const fixture = controllerFixture({ body: () => new Response(new ReadableStream({
    start(controller) { streamController = controller; controller.enqueue(new TextEncoder().encode("first")); },
  }), { headers: [["Set-Cookie", "one=synthetic; HttpOnly"], ["Set-Cookie", "two=synthetic; Secure"]] }) });
  const response = await fixture.controller.fetch(new Request("https://api.test/api/v1/assistant/chat"));
  assert.equal(response.headers.getSetCookie().length, 2);
  fixture.advance(SLOT_DRAIN_MS + 1);
  assert.equal(await fixture.controller.replaceable(), false);
  const reading = response.text();
  streamController.enqueue(new TextEncoder().encode("second"));
  streamController.close();
  assert.equal(await reading, "firstsecond");
  await Promise.all(fixture.waits);
  assert.equal(await fixture.controller.replaceable(), true);
});

test("the drain lease survives a controller restart and candidate probes never accept caller-selected paths", async () => {
  const fixture = controllerFixture();
  const response = await fixture.controller.fetch(new Request("https://api.test/health"));
  await response.text();
  const restarted = new fixture.Slot(fixture.ctx, fixture.env);
  assert.equal(await restarted.replaceable(), false);
  const ready = await restarted.probe();
  assert.equal(ready.release_sha, sha);
  assert.equal(ready.boot, sha);
  assert.equal(ready.processId, "a".repeat(32));
  assert.equal(ready.replaceable, false);
  assert.equal(ready.offerVerified, true);
  fixture.advance(SLOT_DRAIN_MS);
  assert.equal(await restarted.replaceable(), true);
  assert.equal(fixture.calls().dispatches, 1);
});

test("a healthy candidate with an incorrect commercial offer cannot pass readiness", async () => {
  const fixture = controllerFixture({ badOffer: true });
  await assert.rejects(fixture.controller.probe(), /billing offer differs/);
  assert.equal(fixture.calls().dispatches, 0);
});

test("only the two reviewed slots and the original legacy Worker can be selected", () => {
  assert.equal(slotWorker("legacy"), "kova-backend");
  assert.equal(nextSlot("legacy"), "green");
  assert.equal(nextSlot("blue"), "green");
  assert.equal(nextSlot("green"), "blue");
  for (const input of [undefined, "other-account", "__proto__"]) assert.throws(() => slotWorker(input));
});
