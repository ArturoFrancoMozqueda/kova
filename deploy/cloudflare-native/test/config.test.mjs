import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAndParseConfig } from "@cloudflare/config";

test("candidate retains existing namespace contracts and permits exactly one lite process", async () => {
  process.env.KOVA_BUILD_SHA = "a".repeat(40);
  const { default: config } = await import("../cloudflare.config.ts");
  const parsed = await resolveAndParseConfig(config, { isPreview: false, mode: undefined });
  assert.equal(parsed.success, true);
  const { worker, containers } = parsed.data;
  assert.equal(worker.name, "kova-backend");
  assert.equal(worker.workersDev, false);
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
  assert.equal(containers[0].instanceType, "lite");
  assert.equal(containers[0].ssh.enabled, false);
  assert.equal(containers[0].image.buildVars.KOVA_RELEASE_SHA, process.env.KOVA_BUILD_SHA);
});
