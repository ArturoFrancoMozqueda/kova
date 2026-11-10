import assert from "node:assert/strict";
import { test } from "node:test";
import { STRIPE_RUNTIME_ID_RULES, stripeRuntimeIds, normalizeStripeRuntimeIdDiff } from "./stripe-runtime-ids.mjs";

const ids = {
  STRIPE_ESENCIAL_PRICE_ID: "price_Esencial123",
  STRIPE_GESTION_PRICE_ID: "price_Gestion123",
  STRIPE_STANDARD_PORTAL_CONFIGURATION_ID: "bpc_Standard123",
  STRIPE_TIERED_PORTAL_CONFIGURATION_ID: "bpc_Tiered123",
};
const previous = "a".repeat(40), target = "b".repeat(40);
const release = { ...ids, KOVA_NATIVE_PREVIOUS_SHA: previous, KOVA_NATIVE_DEPLOY_SHA: target };
const local = { name: "kova-backend", vars: { KOVA_BUILD_SHA: target, ...ids, KEEP: "unchanged" } };
const remote = { ...local, vars: { KOVA_BUILD_SHA: previous, KEEP: "unchanged" } };

test("only four public identifiers are read and no flags or credentials are projected", () => {
  const environment = { ...ids };
  for (const name of ["STRIPE_SECRET_KEY", "BILLING_PORTAL_ENABLED", "BILLING_TIERED_PLANS_ENABLED",
    "APP_DATABASE_URL", "CLOUDFLARE_API_TOKEN"]) {
    Object.defineProperty(environment, name, { get: () => assert.fail("Unrelated setting was read") });
  }
  assert.deepEqual(stripeRuntimeIds(environment), ids);
  assert.deepEqual(stripeRuntimeIds({}), {});
  assert.deepEqual(stripeRuntimeIds(Object.fromEntries(Object.keys(ids).map(name => [name, ""]))), {});
  assert.equal(Object.keys(STRIPE_RUNTIME_ID_RULES).length, 4);
});

test("configuration is all-or-none and rejects malformed or credential-shaped values without echoing them", () => {
  for (const name of Object.keys(ids)) {
    const partial = { ...ids }; delete partial[name];
    assert.throws(() => stripeRuntimeIds(partial), /all four/);
    for (const value of [null, {}, 123, "price_", "bpc_", "https://private.invalid",
      "sk_" + "live_syntheticForbidden", "price_../unsafe", "price_Invalid?x=1", " ", "x".repeat(256)]) {
      assert.throws(() => stripeRuntimeIds({ ...ids, [name]: value }), error => {
        assert.equal(error.message, `Invalid public Stripe identifier: ${name}`);
        return true;
      });
    }
  }
  assert.throws(() => stripeRuntimeIds({ ...ids, STRIPE_GESTION_PRICE_ID: ids.STRIPE_ESENCIAL_PRICE_ID }), /distinct/);
  assert.deepEqual(stripeRuntimeIds({ ...ids,
    STRIPE_TIERED_PORTAL_CONFIGURATION_ID: ids.STRIPE_STANDARD_PORTAL_CONFIGURATION_ID,
  }), { ...ids, STRIPE_TIERED_PORTAL_CONFIGURATION_ID: ids.STRIPE_STANDARD_PORTAL_CONFIGURATION_ID });
});

test("comparison changes exactly the captured identity and four verified public IDs without mutating inputs", () => {
  const before = structuredClone(remote);
  const normalized = normalizeStripeRuntimeIdDiff(remote, local, release, STRIPE_RUNTIME_ID_RULES);
  assert.deepEqual(normalized, local);
  assert.deepEqual(remote, before);
  const keep = { ...remote, unsafe: { bindings: [{ name: "SEALED", type: "secret_text" }] },
    hyperdrive: [{ binding: "DB_APP", id: "synthetic-runtime" }] };
  const preserved = normalizeStripeRuntimeIdDiff(keep, local, release, STRIPE_RUNTIME_ID_RULES);
  assert.deepEqual(preserved.unsafe, keep.unsafe);
  assert.deepEqual(preserved.hyperdrive, keep.hyperdrive);
  assert.equal(preserved.vars.KEEP, "unchanged");
  const rotation = { ...remote, vars: { ...remote.vars, ...ids,
    STRIPE_ESENCIAL_PRICE_ID: "price_PreviousEsencial123" } };
  assert.deepEqual(normalizeStripeRuntimeIdDiff(rotation, local, release, STRIPE_RUNTIME_ID_RULES), local);
});

test("staged native image publication permits only the identical verified public identifiers", () => {
  assert.deepEqual(normalizeStripeRuntimeIdDiff(local, local, release, STRIPE_RUNTIME_ID_RULES), local);
  for (const name of Object.keys(ids)) {
    const changed = structuredClone(local);
    changed.vars[name] = name.includes("PRICE") ? "price_Different123" : "bpc_Different123";
    assert.throws(() => normalizeStripeRuntimeIdDiff(changed, local, release, STRIPE_RUNTIME_ID_RULES), /captured release/);
  }
  assert.throws(() => normalizeStripeRuntimeIdDiff(local, local,
    { ...release, STRIPE_ESENCIAL_PRICE_ID: "price_Unreviewed123" }, STRIPE_RUNTIME_ID_RULES), /Unverified/);
});

test("comparison requires the exact captured transition, complete desired values and matching release inputs", () => {
  for (const changes of [{ KOVA_NATIVE_PREVIOUS_SHA: undefined }, { KOVA_NATIVE_DEPLOY_SHA: "short" },
    { KOVA_NATIVE_PREVIOUS_SHA: "c".repeat(40) }, { KOVA_NATIVE_DEPLOY_SHA: "d".repeat(40) }]) {
    assert.throws(() => normalizeStripeRuntimeIdDiff(remote, local, { ...release, ...changes }, STRIPE_RUNTIME_ID_RULES), /captured/);
  }
  for (const name of Object.keys(ids)) {
    const partial = structuredClone(local); delete partial.vars[name];
    assert.throws(() => normalizeStripeRuntimeIdDiff(remote, partial, release, STRIPE_RUNTIME_ID_RULES), /Incomplete/);
    assert.throws(() => normalizeStripeRuntimeIdDiff(remote, local,
      { ...release, [name]: "invalid-synthetic-value" }, STRIPE_RUNTIME_ID_RULES), /Unverified/);
    const changedRemote = { ...remote, vars: { ...remote.vars, [name]: "unverified-old-value" } };
    assert.throws(() => normalizeStripeRuntimeIdDiff(changedRemote, local, release, STRIPE_RUNTIME_ID_RULES), /Unverified/);
  }
  const absent = { ...local, vars: { KOVA_BUILD_SHA: target } };
  assert.deepEqual(normalizeStripeRuntimeIdDiff(remote, absent, release, STRIPE_RUNTIME_ID_RULES), remote);
  const other = { ...local, name: "foreign-worker" };
  assert.deepEqual(normalizeStripeRuntimeIdDiff(remote, other, release, STRIPE_RUNTIME_ID_RULES), remote);
});
