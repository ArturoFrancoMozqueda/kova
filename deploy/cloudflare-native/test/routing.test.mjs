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

test("the pinned CLI accepts the exact slot transition while keeping flags, CPU and other bindings strict", async () => {
  const directory = new URL("../node_modules/cf/dist/", import.meta.url);
  const scratch = mkdtempSync(join(tmpdir(), "kova-routing-comparator-"));
  const keys = ["KOVA_NATIVE_PREVIOUS_SLOT", "KOVA_NATIVE_ACTIVE_SLOT", "KOVA_NATIVE_CANDIDATE_SLOT", "KOVA_NATIVE_ROUTING_PHASE"];
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
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
    rmSync(scratch, { recursive: true, force: true });
  }
});
