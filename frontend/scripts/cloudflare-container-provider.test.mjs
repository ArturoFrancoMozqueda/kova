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

test("restoring an existing app rolls out only the captured image and keeps lite/one", async () => {
  const { result, calls } = provider(async args => args[0] === "get"
    ? application({ configuration: { image: newImage, instance_type: "lite" } }) : {});
  await result.restore(snapshot, { workersRestored: true });
  assert.deepEqual(calls, [["get", appId], ["rollouts", "create", appId, "--body",
    JSON.stringify({ description: "Restore captured Kova native API image",
      strategy: "rolling", kind: "full_auto", step_percentage: 100,
      target_configuration: { image: oldImage, instance_type: "lite" } })]]);
  assert.equal(JSON.stringify(calls).includes("environment"), false);
  assert.equal(JSON.stringify(calls).includes("max-instances"), false);
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
    { ...snapshot, instanceType: "basic" }, { ...snapshot, maxInstances: 2 },
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
    { configuration: { image: oldImage, instance_type: "basic" } },
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
