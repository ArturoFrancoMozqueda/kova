import assert from "node:assert/strict";
import { test } from "node:test";
import { cloudflareContainerProvider, nativeContainerIdentity,
  validateNativeContainerSnapshot } from "./cloudflare-container-provider.mjs";

const appId = "a2495f58-56df-4f53-9437-59bcaf6dab94";
const account = nativeContainerIdentity.accountId;
const oldImage = `registry.cloudflare.com/${account}/kova-native-api@sha256:${"a".repeat(64)}`;
const newImage = `registry.cloudflare.com/${account}/kova-native-api:abcd1234`;
const snapshot = { name: nativeContainerIdentity.name,
  namespaceId: nativeContainerIdentity.namespaceId, applicationId: appId,
  image: oldImage, instanceType: "lite", maxInstances: 1 };
const absent = { ...snapshot, applicationId: null, image: null };
const env = { KOVA_CLOUDFLARE_BACKEND: "1", CLOUDFLARE_ACCOUNT_ID: account,
  CLOUDFLARE_API_TOKEN: "synthetic-not-a-real-token" };
const application = (override = {}) => ({ id: appId, name: nativeContainerIdentity.name,
  scheduling_policy: "default", max_instances: 1,
  durable_objects: { namespace_id: nativeContainerIdentity.namespaceId },
  configuration: { image: oldImage, instance_type: "lite",
    environment_variables: [{ name: "DO_NOT_CAPTURE", value: "synthetic-secret-value" }] },
  ...override });

function provider(handler) {
  const calls = [];
  const result = cloudflareContainerProvider({ env, run: async (_command, args, options) => {
    assert.equal(options.capture, true);
    assert.equal(args.includes(env.CLOUDFLARE_API_TOKEN), false);
    const operation = args.slice(3);
    calls.push(operation);
    return JSON.stringify(await handler(operation));
  } });
  return { result, calls };
}

test("capture persists only the exact non-secret native application identity and image", async () => {
  const { result, calls } = provider(async args => args[0] === "list"
    ? [application(), { id: "foreign", name: "another-application" }] : application());
  const value = await result.capture();
  assert.deepEqual(value, snapshot);
  assert.equal(JSON.stringify(value).includes("synthetic-secret"), false);
  assert.deepEqual(calls, [["list", "--name", "kova-native-api"], ["get", appId]]);
});

test("first cutover captures explicit absence instead of inventing an image", async () => {
  const { result } = provider(async () => []);
  assert.deepEqual(await result.capture(), absent);
});

test("expanded live lite resources capture canonically and restore only the image and named size", async () => {
  const expanded = application({ configuration: { image: oldImage, vcpu: 0.0625,
    memory_mib: 256, memory: "256MiB", disk: { size_mb: 2000, size: "2GB" },
    environment_variables: [{ name: "DO_NOT_CAPTURE", value: "synthetic-secret-value" }] } });
  const { result, calls } = provider(async args => args[0] === "list" ? [expanded] : expanded);
  const captured = await result.capture();
  assert.deepEqual(captured, snapshot);
  await result.restore(captured, { workersRestored: true });
  const rollout = calls.find(args => args[0] === "rollouts");
  assert.deepEqual(JSON.parse(rollout[4]).target_configuration,
    { image: oldImage, instance_type: "lite" });
  assert.equal(JSON.stringify(captured).includes("synthetic-secret"), false);
  assert.equal(JSON.stringify(rollout).includes("environment"), false);
  for (const resources of [
    { vcpu: 0.0625, memory_mib: 256, disk: { size_mb: 2000 } },
    { ...expanded.configuration, instance_type: "lite" },
  ]) {
    const { result: exact } = provider(async args => args[0] === "list" ? [application()]
      : application({ configuration: { image: oldImage, ...resources } }));
    assert.deepEqual(await exact.capture(), snapshot);
  }
});

test("expanded or named lite resources reject partial responses, sizing drift and conflicting aliases", async () => {
  const lite = { image: oldImage, vcpu: 0.0625, memory_mib: 256,
    memory: "256MiB", disk: { size_mb: 2000, size: "2GB" } };
  for (const configuration of [
    { ...lite, vcpu: undefined }, { ...lite, memory_mib: undefined }, { ...lite, disk: undefined },
    { ...lite, vcpu: 0.25 }, { ...lite, vcpu: "0.0625" },
    { ...lite, memory_mib: 512 }, { ...lite, memory_mib: "256" },
    { ...lite, memory: "512MiB" }, { ...lite, disk: { size_mb: 4000, size: "2GB" } },
    { ...lite, disk: { size_mb: "2000" } }, { ...lite, disk: { size_mb: 2000, size: "4GB" } },
    { ...lite, disk: "2GB" }, { ...lite, instance_type: "basic" },
    { ...lite, instance_type: "lite", vcpu: 0.25 },
    { ...lite, instance_type: "lite", memory: "512MiB" },
    { ...lite, instance_type: "lite", disk: { size_mb: 4000 } },
  ]) {
    const { result, calls } = provider(async args => args[0] === "list" ? [application()]
      : application({ configuration }));
    await assert.rejects(result.capture(), /exact approved resources/);
    await assert.rejects(result.restore(snapshot, { workersRestored: true }), /exact approved resources/);
    assert.equal(calls.some(args => ["rollouts", "delete"].includes(args[0])), false);
  }
});

test("recovery reconciles all existing placements to the captured image and keeps lite/one", async () => {
  const { result, calls } = provider(async args => args[0] === "get"
    ? application({ configuration: { image: newImage, instance_type: "lite" } }) : {});
  await result.restore(snapshot, { workersRestored: true });
  assert.deepEqual(calls, [["get", appId], ["rollouts", "create", appId, "--body",
    JSON.stringify({ description: "Restore captured Kova native API image",
      strategy: "new_instances", kind: "full_manual", percentage: 100,
      target_configuration: { image: oldImage, instance_type: "lite" } })]]);
  assert.equal(JSON.stringify(calls).includes("environment"), false);
  assert.equal(JSON.stringify(calls).includes("max-instances"), false);
});

test("basic capture requires its exact named or expanded resources", async () => {
  const expected = { ...snapshot, instanceType: "basic" };
  const expanded = { vcpu: 0.25, memory_mib: 1024, memory: "1GiB",
    disk: { size_mb: 4000, size: "4GB" } };
  for (const resources of [{ instance_type: "basic" }, expanded,
    { ...expanded, instance_type: "basic" }]) {
    const live = application({ configuration: { image: oldImage, ...resources } });
    const { result } = provider(async args => args[0] === "list" ? [live] : live);
    assert.deepEqual(await result.capture(), expected);
  }
  for (const resources of [
    { ...expanded, vcpu: undefined }, { ...expanded, memory_mib: undefined },
    { ...expanded, disk: undefined }, { ...expanded, instance_type: "lite" },
    { ...expanded, vcpu: 1 }, { ...expanded, memory: "256MiB" },
    { ...expanded, instance_type: "basic", memory_mib: 256 },
    { ...expanded, disk: { size_mb: 2000, size: "4GB" } },
    { ...expanded, disk: { size_mb: 4000, size: "2GB" } },
  ]) {
    const live = application({ configuration: { image: oldImage, ...resources } });
    const { result, calls } = provider(async args => args[0] === "list" ? [live] : live);
    await assert.rejects(result.capture(), /exact approved resources/);
    assert.equal(calls.some(args => ["rollouts", "delete"].includes(args[0])), false);
  }
});

test("rollback restores the captured size when moving between lite and basic", async () => {
  for (const [previous, live] of [["lite", "basic"], ["basic", "lite"]]) {
    const { result, calls } = provider(async args => args[0] === "get"
      ? application({ configuration: { image: newImage, instance_type: live } }) : {});
    await result.restore({ ...snapshot, instanceType: previous }, { workersRestored: true });
    const rollout = calls.find(args => args[0] === "rollouts");
    assert.deepEqual(JSON.parse(rollout[4]).target_configuration,
      { image: oldImage, instance_type: previous });
    assert.equal(JSON.stringify(rollout).includes("environment"), false);
  }
});

test("first-cutover recovery removes only the new approved application after Workers restore", async () => {
  let deleted = false;
  const { result, calls } = provider(async args => {
    if (args[0] === "list") return deleted ? [] : [application()];
    if (args[0] === "get") return application();
    assert.deepEqual(args, ["delete", appId, "--force"]);
    deleted = true;
    return {};
  });
  await result.restore(absent, { workersRestored: true });
  assert.deepEqual(calls, [["list", "--name", "kova-native-api"], ["get", appId],
    ["delete", appId, "--force"], ["list", "--name", "kova-native-api"]]);
  assert.equal(JSON.stringify(calls).includes("namespace"), false);
});

test("first-cutover recovery with no created app makes no mutations", async () => {
  const { result, calls } = provider(async () => []);
  await result.restore(absent, { workersRestored: true });
  assert.deepEqual(calls, [["list", "--name", "kova-native-api"]]);
});

test("deletion must actually remove the new application", async () => {
  const { result } = provider(async args => args[0] === "list"
    ? [application()] : args[0] === "get" ? application() : {});
  await assert.rejects(result.restore(absent, { workersRestored: true }), /was not removed/);
});

test("restore requires explicit completion of the captured Worker restoration", async () => {
  const { result, calls } = provider(assert.fail);
  await assert.rejects(result.restore(snapshot), /Worker versions before/);
  await assert.rejects(result.restore(absent, { workersRestored: "true" }), /Worker versions before/);
  assert.deepEqual(calls, []);
});

test("artifact validation refuses foreign IDs/images, unsupported sizing and extra metadata", () => {
  for (const value of [null, [], {}, { ...snapshot, applicationId: "--other-id" },
    { ...snapshot, name: "foreign-app" }, { ...snapshot, namespaceId: "a".repeat(32) },
    { ...snapshot, image: oldImage.replace(account, "b".repeat(32)) },
    { ...snapshot, image: oldImage.replace("kova-native-api", "another-app") },
    { ...snapshot, image: `registry.cloudflare.com/${account}/kova-native-api:latest` },
    { ...snapshot, image: "https://untrusted.example/image" },
    { ...snapshot, image: oldImage + "?token=synthetic" },
    { ...snapshot, instanceType: "standard-1" }, { ...snapshot, maxInstances: 2 },
    { ...snapshot, environment: "synthetic-secret" }, { ...absent, image: oldImage },
    { ...snapshot, image: null }]) {
    assert.throws(() => validateNativeContainerSnapshot(value));
  }
  assert.deepEqual(validateNativeContainerSnapshot({ ...snapshot, image: newImage }),
    { ...snapshot, image: newImage });
});

test("live application mismatch refuses every rollout and deletion", async () => {
  for (const override of [{ name: "foreign-app" },
    { durable_objects: { namespace_id: "b".repeat(32) } },
    { id: "2ddd6376-e20a-44fb-8491-a8d7216e68f1" }, { max_instances: 2 },
    { configuration: { image: oldImage, instance_type: "standard-1" } },
    { scheduling_policy: "durable_object" }]) {
    const { result, calls } = provider(async args => args[0] === "list"
      ? [application()] : application(override));
    await assert.rejects(result.restore(snapshot, { workersRestored: true }));
    assert.equal(calls.some(args => ["rollouts", "delete"].includes(args[0])), false);
  }
});

test("capture rejects ambiguous inventory, malformed results and foreign matching namespace", async () => {
  for (const response of [{ result: [] }, [application(), application()],
    [application({ id: "not-an-id" })]]) {
    const { result } = provider(async () => response);
    await assert.rejects(result.capture());
  }
  const { result } = provider(async args => args[0] === "list" ? [application()]
    : application({ durable_objects: { namespace_id: "f".repeat(32) } }));
  await assert.rejects(result.capture());
});

test("provider is opt-in and rejects unapproved account credentials before remote calls", () => {
  assert.equal(cloudflareContainerProvider({ env: {}, run: assert.fail }), undefined);
  for (const configuration of [{ ...env, CLOUDFLARE_API_TOKEN: "" },
    { ...env, CLOUDFLARE_ACCOUNT_ID: "b".repeat(32) }]) {
    assert.throws(() => cloudflareContainerProvider({ env: configuration, run: assert.fail }));
  }
});
