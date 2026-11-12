import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, symlinkSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { normalizeNativeGatewayDiff } from "../../native-gateway-transition.mjs";

const workers = { legacy: "kova-backend", blue: "kova-api-blue", green: "kova-api-green" };
const api = (name, slot) => ({ name, class_name: "KovaApi", script_name: workers[slot] });
function routing(active, candidate) {
  return { name: "kova-backend-gateway", workers_dev: false, preview_urls: false,
    vars: { KOVA_NATIVE_BACKEND: "1", ...(active === undefined ? {} : { KOVA_NATIVE_ACTIVE_SLOT: active }),
      ...(candidate === undefined ? {} : { KOVA_NATIVE_CANDIDATE_SLOT: candidate }) },
    durable_objects: { bindings: [api("API", active ?? "legacy"), ...(candidate === undefined ? [] : [api("CANDIDATE_API", candidate)])] } };
}
const env = (active, candidate, phase, previous = "legacy") => ({ KOVA_NATIVE_PREVIOUS_SLOT: previous,
  KOVA_NATIVE_ACTIVE_SLOT: active, KOVA_NATIVE_CANDIDATE_SLOT: candidate, KOVA_NATIVE_ROUTING_PHASE: phase });
const ids = { STRIPE_ESENCIAL_PRICE_ID: "price_Esencial123", STRIPE_GESTION_PRICE_ID: "price_Gestion123",
  STRIPE_STANDARD_PORTAL_CONFIGURATION_ID: "bpc_Basic123", STRIPE_TIERED_PORTAL_CONFIGURATION_ID: "bpc_Basic123" };
const previousSha = "a".repeat(40), targetSha = "b".repeat(40);
const settings = (service = "kova-native-signup-settings", entrypoint = "SignupSettings") =>
  ({ binding: "SETTINGS", service, entrypoint });
function slotConfig(slot) {
  return { name: `kova-api-${slot}`, workers_dev: false, preview_urls: false,
    vars: { KOVA_BUILD_SHA: targetSha, ...ids }, services: [settings(), { binding: "KEEP", service: "unchanged" }] };
}
const slotEnv = slot => ({ KOVA_NATIVE_TARGET_SLOT: slot, KOVA_NATIVE_TARGET_PREVIOUS_SHA: previousSha,
  KOVA_NATIVE_DEPLOY_SHA: targetSha, ...ids });

test("the private settings bridge requires the captured slot and exact old/new RPC descriptors", () => {
  const local = slotConfig("blue");
  const remote = structuredClone(local);
  remote.vars.KOVA_BUILD_SHA = previousSha;
  remote.services[0] = settings("kova-backend", "NativeSettings");
  const original = structuredClone(remote);
  const normalized = normalizeNativeGatewayDiff(remote, local, slotEnv("blue"));
  assert.deepEqual(normalized.services, local.services);
  assert.equal(normalized.vars.KOVA_BUILD_SHA, previousSha);
  assert.deepEqual(remote, original);
  for (const descriptor of [{ service: "foreign" }, { environment: "production" }, { extra: true }]) {
    const invalid = structuredClone(remote); Object.assign(invalid.services[0], descriptor);
    assert.throws(() => normalizeNativeGatewayDiff(invalid, local, slotEnv("blue")), /Unverified private/);
  }
  assert.throws(() => normalizeNativeGatewayDiff(remote, local, slotEnv("green")), /Unverified private/);
});

test("only the captured stage and promote transitions normalize, without mutating their input", () => {
  const original = routing();
  const staged = routing("legacy", "green");
  assert.deepEqual(normalizeNativeGatewayDiff(original, staged, env("legacy", "green", "stage")), staged);
  assert.deepEqual(original, routing());
  const promoted = routing("green", "legacy");
  assert.deepEqual(normalizeNativeGatewayDiff(staged, promoted, env("green", "legacy", "promote")), promoted);
  assert.deepEqual(normalizeNativeGatewayDiff(promoted, promoted, env("green", "legacy", "promote")), promoted);
});

test("foreign workers/classes/environments, duplicate routes and uncaptured changes are rejected", () => {
  const stage = routing("legacy", "green");
  for (const descriptor of [{ script_name: "other-site" }, { class_name: "OtherApi" }, { environment: "production" }]) {
    const remote = routing(); Object.assign(remote.durable_objects.bindings[0], descriptor);
    assert.throws(() => normalizeNativeGatewayDiff(remote, stage, env("legacy", "green", "stage")));
  }
  const duplicate = routing(); duplicate.durable_objects.bindings.push(api("API", "legacy"));
  assert.throws(() => normalizeNativeGatewayDiff(duplicate, stage, env("legacy", "green", "stage")));
  for (const environment of [{}, env("green", "legacy", "stage"), env("legacy", "green", "promote"),
    env("legacy", "__proto__", "stage"), env("legacy", "green", "stage", "blue")]) {
    assert.throws(() => normalizeNativeGatewayDiff(routing(), stage, environment));
  }
});

test("the pinned CLI accepts the exact slot transition while preserving other resource guards", async () => {
  const directory = new URL("../node_modules/cf/dist/", import.meta.url);
  const scratch = mkdtempSync(join(tmpdir(), "kova-routing-comparator-"));
  const keys = ["KOVA_NATIVE_PREVIOUS_SLOT", "KOVA_NATIVE_ACTIVE_SLOT", "KOVA_NATIVE_CANDIDATE_SLOT", "KOVA_NATIVE_ROUTING_PHASE",
    "KOVA_NATIVE_TARGET_SLOT", "KOVA_NATIVE_TARGET_PREVIOUS_SHA", "KOVA_NATIVE_DEPLOY_SHA", ...Object.keys(ids)];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    symlinkSync(realpathSync(new URL("../node_modules", import.meta.url)), join(scratch, "node_modules"));
    const comparator = "containers-BtcOgwm5.mjs";
    for (const name of readdirSync(directory)) {
      if (name === comparator) writeFileSync(join(scratch, name), readFileSync(new URL(name, directory), "utf8")
        + "\nexport { xE as compareForTest };\n");
      else symlinkSync(fileURLToPath(new URL(name, directory)), join(scratch, name));
    }
    const { compareForTest } = await import(pathToFileURL(join(scratch, comparator)));
    const stage = routing("legacy", "green");
    Object.assign(process.env, env("legacy", "green", "stage"));
    assert.equal(compareForTest(routing(), stage).diff, null);
    for (const remote of [
      { ...routing(), limits: { cpu_ms: 500 } },
      { ...routing(), vars: { KOVA_NATIVE_BACKEND: "0" } },
      { ...routing(), unsafe: { bindings: [{ type: "secret_text", name: "UNREVIEWED" }] } },
    ]) assert.equal(compareForTest(remote, stage).nonDestructive, false);
    Object.assign(process.env, env("green", "legacy", "promote"));
    assert.equal(compareForTest(stage, routing("green", "legacy")).diff, null);
    for (const slot of ["blue", "green", "recovery"]) {
      Object.assign(process.env, slotEnv(slot));
      const local = slotConfig(slot);
      const remote = structuredClone(local);
      remote.vars.KOVA_BUILD_SHA = previousSha;
      remote.services[0] = settings("kova-backend", "NativeSettings");
      assert.equal(compareForTest(remote, local).diff, null, slot);
      assert.equal(compareForTest(local, local).diff, null, `${slot} idempotent`);
      for (const altered of [
        { ...local, limits: { cpu_ms: 500 } },
        { ...local, services: [settings(), { binding: "KEEP", service: "foreign" }] },
        { ...local, unsafe: { bindings: [{ type: "secret_text", name: "UNREVIEWED" }] } },
      ]) assert.equal(compareForTest(altered, local).nonDestructive, false, slot);
      const withFlags = { ...local, compatibility_flags: ["nodejs_compat", "enable_request_signal"] };
      assert.deepEqual(normalizeNativeGatewayDiff(remote, withFlags, slotEnv(slot)).compatibility_flags,
        remote.compatibility_flags, "this bridge must not normalize compatibility metadata");
      if (slot === "recovery") {
        const altered = structuredClone(local); altered.vars.STRIPE_ESENCIAL_PRICE_ID = "price_Other123";
        assert.throws(() => compareForTest(remote, altered), /Unverified private/);
      }
    }
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
    rmSync(scratch, { recursive: true, force: true });
  }
});
