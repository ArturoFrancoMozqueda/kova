import path from "node:path";
import { fileURLToPath } from "node:url";

// Existing production account/DO identity. These are public resource IDs, not
// credentials. Never let a downloaded artifact select another application.
export const nativeContainerIdentity = Object.freeze({
  accountId: "47d850c847503be3597dc7165cfea177",
  name: "kova-native-api",
  namespaceId: "c7c99df616bf49cbae83367e944a8617",
});

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  "../../deploy/cloudflare-backend");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const image = new RegExp(`^registry\\.cloudflare\\.com/${nativeContainerIdentity.accountId}`
  + "/kova-native-api(?:@sha256:[a-f0-9]{64}|:[a-f0-9]{8,64})$");
const snapshotKeys = ["name", "namespaceId", "applicationId", "image", "instanceType", "maxInstances"];
const approvedResources = Object.freeze({
  lite: { cpu: 0.0625, memoryMiB: 256, memory: "256MiB", diskMB: 2000, disk: "2GB" },
  basic: { cpu: 0.25, memoryMiB: 1024, memory: "1GiB", diskMB: 4000, disk: "4GB" },
});

export function validateNativeContainerSnapshot(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).length !== snapshotKeys.length
      || !snapshotKeys.every(key => Object.hasOwn(input, key))
      || input.name !== nativeContainerIdentity.name
      || input.namespaceId !== nativeContainerIdentity.namespaceId
      || !Object.hasOwn(approvedResources, input.instanceType) || input.maxInstances !== 1
      || (input.applicationId === null ? input.image !== null
        : !uuid.test(input.applicationId ?? "") || !image.test(input.image ?? ""))) {
    throw new Error("Invalid native Container rollback identity or configuration");
  }
  return Object.fromEntries(snapshotKeys.map(key => [key, input[key]]));
}

function absentSnapshot() {
  return validateNativeContainerSnapshot({ name: nativeContainerIdentity.name,
    namespaceId: nativeContainerIdentity.namespaceId, applicationId: null,
    image: null, instanceType: "lite", maxInstances: 1 });
}

function exactResourceType(configuration) {
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) return undefined;
  const declared = configuration.instance_type;
  if (declared !== undefined && !Object.hasOwn(approvedResources, declared)) return undefined;
  // The applications API can return expanded resources instead of the named
  // instance type. Accept only either approved tuple, including consistent
  // human-readable aliases; never infer sizing from a partial response.
  const { vcpu, memory_mib: memoryMiB, memory, disk } = configuration;
  for (const [name, expected] of Object.entries(approvedResources)) {
    if (declared !== undefined && declared !== name) continue;
    if ((vcpu !== undefined && vcpu !== expected.cpu)
        || (memoryMiB !== undefined && memoryMiB !== expected.memoryMiB)
        || (memory !== undefined && memory !== expected.memory)) continue;
    if (disk !== undefined && (!disk || typeof disk !== "object" || Array.isArray(disk)
        || (disk.size_mb !== undefined && disk.size_mb !== expected.diskMB)
        || (disk.size !== undefined && disk.size !== expected.disk))) continue;
    if (declared === name
        || (vcpu === expected.cpu && memoryMiB === expected.memoryMiB
          && disk?.size_mb === expected.diskMB)) return name;
  }
  return undefined;
}

function applicationSnapshot(application) {
  // Select only non-secret configuration. In particular, never persist the
  // API's environment_variables, registry credentials, command or entrypoint.
  if (application?.scheduling_policy !== "default") {
    throw new Error("Native Container rollback requires the default scheduling policy");
  }
  const instanceType = exactResourceType(application.configuration);
  if (!instanceType) {
    throw new Error("Native Container rollback requires exact approved resources (lite or basic)");
  }
  return validateNativeContainerSnapshot({ name: application.name,
    namespaceId: application.durable_objects?.namespace_id,
    applicationId: application.id, image: application.configuration?.image,
    instanceType,
    maxInstances: application.max_instances });
}

/** Worker versions and application image rollouts are independent:
 * https://developers.cloudflare.com/containers/configuration/rollouts/
 * Restore the three captured Worker versions before calling restore(). The
 * first native cutover has no previous app: remove only that new application,
 * retaining the original DO namespace, PostgreSQL, R2, and registry image.
 */
export function cloudflareContainerProvider({ run, env }) {
  if (env.KOVA_CLOUDFLARE_BACKEND !== "1") return undefined;
  if (!env.CLOUDFLARE_API_TOKEN
      || env.CLOUDFLARE_ACCOUNT_ID !== nativeContainerIdentity.accountId) {
    throw new Error("Native Container rollback requires the approved Cloudflare account credentials");
  }
  const cf = async args => {
    const result = await run(process.execPath,
      [path.join(directory, "node_modules/cf/bin/cf"), "containers", "applications", ...args],
      { cwd: directory, env, capture: true, label: "Cloudflare Container rollback" });
    // Mutations can return an empty body. Their exit status is checked by run;
    // discard their output so no incidental application settings reach logs.
    if (!["get", "list"].includes(args[0])) return;
    try { return JSON.parse(result); }
    catch { throw new Error("Invalid Cloudflare Container operation response"); }
  };
  const get = async id => {
    if (!uuid.test(id ?? "")) throw new Error("Invalid Container application ID");
    const current = applicationSnapshot(await cf(["get", id]));
    if (current.applicationId !== id) throw new Error("Container application ID changed unexpectedly");
    return current;
  };
  const find = async () => {
    const applications = await cf(["list", "--name", nativeContainerIdentity.name]);
    if (!Array.isArray(applications)) throw new Error("Invalid Container application inventory");
    const matches = applications.filter(app => app?.name === nativeContainerIdentity.name);
    if (matches.length > 1) throw new Error("Ambiguous native Container application inventory");
    if (!matches.length) return absentSnapshot();
    return get(matches[0].id);
  };
  return {
    capture: find,
    async restore(input, { workersRestored = false } = {}) {
      const previous = validateNativeContainerSnapshot(input);
      if (workersRestored !== true) {
        throw new Error("Restore the captured backend Worker versions before the Container application");
      }
      if (previous.applicationId === null) {
        const current = await find();
        if (current.applicationId === null) return;
        // The exact name, namespace, account, image repository and approved size/1
        // configuration were checked immediately before this deletion.
        await cf(["delete", current.applicationId, "--force"]);
        const remaining = await find();
        if (remaining.applicationId !== null) {
          throw new Error("New native Container application was not removed");
        }
        return;
      }
      await get(previous.applicationId);
      // Cloudflare's verified API applies image changes through rollouts,
      // not an application PATCH. Pass only the captured image plus the same
      // size; never replay unreviewed environment/entrypoint configuration.
      // cf's individual flags default observability.logs.enabled to false.
      // A complete --body was verified with --dry-run to preserve omitted
      // configuration rather than silently switching application logs off.
      await cf(["rollouts", "create", previous.applicationId, "--body", JSON.stringify({
        description: "Restore captured Kova native API image",
        strategy: "rolling", kind: "full_auto", step_percentage: 100,
        target_configuration: { image: previous.image, instance_type: previous.instanceType },
      })]);
      // A rollout response acknowledges initiation. The release recovery path
      // must subsequently verify health, runtime and exact original release SHA.
    },
  };
}
