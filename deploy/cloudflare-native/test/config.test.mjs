import { test } from "node:test";
import assert from "node:assert/strict";
import { convertToWranglerConfig, resolveAndParseConfig } from "@cloudflare/config";
import { stripeRuntimeIds } from "../../stripe-runtime-ids.mjs";

test("candidate retains existing namespace contracts and permits exactly one basic process", async () => {
  process.env.KOVA_BUILD_SHA = "a".repeat(40);
  const { default: config } = await import("../cloudflare.config.ts");
  const parsed = await resolveAndParseConfig(config, { isPreview: false, mode: undefined });
  assert.equal(parsed.success, true);
  const { worker, containers } = parsed.data;
  assert.equal(worker.name, "kova-backend");
  assert.equal(worker.workersDev, false);
  assert.equal(worker.previewUrls, false);
  assert.deepEqual(worker.unsafe.metadata.code_update_strategy, { mode: "immediate" });
  assert.equal(worker.domains, undefined);
  assert.deepEqual(Object.keys(worker.exports).sort(), ["ContainerProxy", "KovaApi", "KovaRateLimit"]);
  assert.equal(worker.exports.KovaApi.container, "kova-native-api");
  assert.equal(worker.exports.KovaApi.storage, "sqlite");
  assert.equal(worker.exports.KovaRateLimit.storage, "sqlite");
  assert.equal(worker.env.API.exportName, "KovaApi");
  assert.equal(worker.env.RATE_LIMITS.exportName, "KovaRateLimit");
  assert.equal(worker.env.JOBS.worker, "kova-backend-jobs");
  assert.equal(containers.length, 1);
  assert.equal(containers[0].maxInstances, 1);
  assert.equal(containers[0].instanceType, "basic");
  assert.equal(containers[0].ssh.enabled, false);
  assert.equal(containers[0].image.buildVars.KOVA_RELEASE_SHA, process.env.KOVA_BUILD_SHA);
});

test("native code update strategy reaches the pinned CLI's actual upload metadata", async () => {
  process.env.KOVA_BUILD_SHA = "a".repeat(40);
  const { default: config } = await import("../cloudflare.config.ts");
  const parsed = await resolveAndParseConfig(config, { isPreview: false, mode: undefined });
  assert.equal(parsed.success, true);
  const converted = convertToWranglerConfig(parsed.data);
  const { t: createWorkerUploadForm } = await import("../node_modules/cf/dist/chunk-DSGVRFIS-C5SqiTOz.mjs");
  const form = createWorkerUploadForm({ main: { name: "entry.mjs", content: "export default {}", type: "esm" } },
    {}, { unsafe: converted.unsafe });
  const metadata = JSON.parse(form.get("metadata"));
  assert.deepEqual(metadata.code_update_strategy, { mode: "immediate" });
  assert.equal(Object.hasOwn(metadata, "migrations"), false);
});

test("native handoff is a validated versioned binding, never an image environment override", async () => {
  const saved = process.env.KOVA_NATIVE_HANDOFF;
  try {
    process.env.KOVA_BUILD_SHA = "a".repeat(40);
    process.env.KOVA_NATIVE_HANDOFF = JSON.stringify({ previousSha: "b".repeat(40), expiresAt: Date.now() + 600_000 });
    const { default: config } = await import("../cloudflare.config.ts?handoff");
    const parsed = await resolveAndParseConfig(config, { isPreview: false, mode: undefined });
    assert.equal(parsed.success, true);
    assert.deepEqual(parsed.data.worker.env.KOVA_NATIVE_HANDOFF, { type: "text", value: process.env.KOVA_NATIVE_HANDOFF });
    assert.deepEqual(parsed.data.containers[0].image.buildVars, { KOVA_RELEASE_SHA: "a".repeat(40) });
    process.env.KOVA_NATIVE_HANDOFF = "{}";
    await assert.rejects(() => import("../cloudflare.config.ts?invalid-handoff"), /Invalid native release handoff/);
  } finally {
    if (saved === undefined) delete process.env.KOVA_NATIVE_HANDOFF; else process.env.KOVA_NATIVE_HANDOFF = saved;
  }
});

test("public Stripe IDs are text bindings only on API and jobs with no rollout flags", async () => {
  const ids = {
    STRIPE_ESENCIAL_PRICE_ID: "price_Esencial123", STRIPE_GESTION_PRICE_ID: "price_Gestion123",
    STRIPE_STANDARD_PORTAL_CONFIGURATION_ID: "bpc_Basic123",
    STRIPE_TIERED_PORTAL_CONFIGURATION_ID: "bpc_Basic123",
  };
  const saved = Object.fromEntries(Object.keys(ids).map(name => [name, process.env[name]]));
  try {
    Object.assign(process.env, ids, { KOVA_BUILD_SHA: "a".repeat(40) });
    const { default: native } = await import("../cloudflare.config.ts?public-identifiers");
    const { default: python, jobs, gateway } = await import("../../cloudflare-backend/cloudflare.config.ts?public-identifiers");
    for (const config of [native, python, jobs]) {
      for (const [name, value] of Object.entries(stripeRuntimeIds(ids))) {
        assert.deepEqual(config.worker.env[name], { type: "text", value });
      }
      assert.equal(config.worker.env.BILLING_TIERED_PLANS_ENABLED, undefined);
      assert.equal(config.worker.env.BILLING_PORTAL_ENABLED, undefined);
    }
    for (const name of Object.keys(ids)) assert.equal(gateway.worker.env[name], undefined);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
