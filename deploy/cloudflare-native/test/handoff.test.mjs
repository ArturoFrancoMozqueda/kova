import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeHandoff, normalizeNativeHandoffDiff, NATIVE_HANDOFF_MAX_MS } from "../../native-handoff.mjs";

const previousSha = "a".repeat(40), targetSha = "b".repeat(40), now = 1_800_000_000_000;
const lease = { previousSha, expiresAt: now + NATIVE_HANDOFF_MAX_MS };
const encoded = JSON.stringify(lease);

test("handoff accepts only a distinct captured SHA inside the original thirty minute lease", () => {
  assert.deepEqual(nativeHandoff(encoded, targetSha, now), lease);
  assert.equal(nativeHandoff(encoded, targetSha, lease.expiresAt), null);
  for (const input of [undefined, "", "{}", "null", "[]", "{", JSON.stringify({ ...lease, extra: true }),
    JSON.stringify({ ...lease, previousSha: targetSha }), JSON.stringify({ ...lease, previousSha: "short" }),
    JSON.stringify({ ...lease, expiresAt: String(lease.expiresAt) }),
    JSON.stringify({ ...lease, expiresAt: lease.expiresAt + 1 })]) {
    assert.equal(nativeHandoff(input, targetSha, now), null);
  }
});

test("comparator normalizes only the exact environment-verified handoff across the captured identity", () => {
  const remote = { name: "kova-backend", vars: { KOVA_BUILD_SHA: previousSha, KEEP: "original" } };
  const local = { name: "kova-backend", vars: { KOVA_BUILD_SHA: targetSha, KOVA_NATIVE_HANDOFF: encoded, KEEP: "different" } };
  const env = { KOVA_NATIVE_PREVIOUS_SHA: previousSha, KOVA_NATIVE_DEPLOY_SHA: targetSha, KOVA_NATIVE_HANDOFF: encoded };
  const result = normalizeNativeHandoffDiff(remote, local, env, now);
  assert.deepEqual(result, { ...remote, vars: { ...remote.vars, KOVA_NATIVE_HANDOFF: encoded } });
  assert.equal(remote.vars.KOVA_NATIVE_HANDOFF, undefined);
  for (const invalid of [{ ...env, KOVA_NATIVE_HANDOFF: undefined }, { ...env, KOVA_NATIVE_PREVIOUS_SHA: targetSha },
    { ...env, KOVA_NATIVE_DEPLOY_SHA: previousSha }]) {
    assert.throws(() => normalizeNativeHandoffDiff(remote, local, invalid, now), /bounded captured/);
  }
  assert.throws(() => normalizeNativeHandoffDiff(remote, local, env, lease.expiresAt), /bounded captured/);
  assert.throws(() => normalizeNativeHandoffDiff({ ...remote, name: "other" }, local, env, now), /bounded captured/);
  const sameBuild = { ...remote, vars: { ...remote.vars, KOVA_NATIVE_HANDOFF: encoded } };
  const unchanged = { ...remote, vars: { ...remote.vars } };
  assert.deepEqual(normalizeNativeHandoffDiff(sameBuild, unchanged,
    { KOVA_NATIVE_PREVIOUS_SHA: previousSha, KOVA_NATIVE_DEPLOY_SHA: previousSha }, now), unchanged);
  assert.equal(sameBuild.vars.KOVA_NATIVE_HANDOFF, encoded, "comparison never mutates captured metadata");
});
