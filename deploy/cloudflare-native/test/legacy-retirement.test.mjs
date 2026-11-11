import assert from "node:assert/strict";
import { test } from "node:test";
import { residentContainerClass } from "../lifecycle.mjs";

function fixture() {
  let time = 1_000_000;
  const values = new Map();
  const events = [];
  const state = { active: "legacy", fail: false };
  const env = { KOVA_BUILD_SHA: "a".repeat(40), APP_DATABASE_URL: "synthetic-runtime",
    MIGRATION_DATABASE_URL: "synthetic-owner", SECRET_KEY: "synthetic-key",
    API: { idFromName: () => ({ toString: () => "resident" }) },
    GATEWAY_STATUS: { async getActiveSlot() { if (state.fail) throw new Error("private failure"); return state.active; } },
  };
  const ctx = { id: { toString: () => "resident" }, container: { running: true }, storage: {
    async get(key) { return values.get(key); }, async put(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
  } };
  class Container {
    constructor(ctx, env) { this.ctx = ctx; this.env = env; }
    async schedule(seconds, callback) { events.push({ seconds, callback }); }
    async stop() { events.push({ stop: true }); ctx.container.running = false; await this.onStop(); }
    async getState() { return { status: "healthy" }; }
    async containerFetch() { return Response.json({ status: "ok", release_sha: env.KOVA_BUILD_SHA },
      { headers: { "x-kova-boot-controller-sha": env.KOVA_BUILD_SHA } }); }
    async fetch() { return new Response("original"); }
  }
  const Resident = residentContainerClass(Container, { now: () => time, retirement: true });
  return { controller: new Resident(ctx, env), state, values, events,
    advance: ms => { time += ms; } };
}

test("legacy remains resident while routing is active, unavailable or unknown", async () => {
  const f = fixture();
  await f.controller.onActivityExpired();
  f.state.fail = true; await f.controller.onActivityExpired();
  f.state.fail = false; f.state.active = "unknown"; await f.controller.onActivityExpired();
  assert.deepEqual(f.events, []);
  assert.equal(f.values.size, 0);
});

test("verified legacy retirement waits thirty minutes and never schedules an automatic restart", async () => {
  const f = fixture();
  f.state.active = "green";
  await f.controller.onActivityExpired();
  assert.deepEqual(f.events, [{ seconds: 1800, callback: "retireIfUnused" }]);
  f.advance(1_799_999); await f.controller.retireIfUnused();
  assert.equal(f.events.some(event => event.stop), false);
  f.advance(1); await f.controller.retireIfUnused();
  assert.deepEqual(f.events, [{ seconds: 1800, callback: "retireIfUnused" }, { stop: true }]);
  await f.controller.ensureRunning();
  assert.equal(f.events.length, 2);
});

test("routing a real request back to legacy cancels retirement and preserves its response", async () => {
  const f = fixture(); f.state.active = "green";
  await f.controller.onActivityExpired();
  f.state.active = "legacy";
  const response = await f.controller.fetch(new Request("https://api.test/api/v1/auth/session"));
  assert.equal(await response.text(), "original");
  assert.equal(f.values.has("native_retire_after"), false);
  f.advance(1_800_001); await f.controller.retireIfUnused();
  assert.equal(f.events.some(event => event.stop), false);
});
