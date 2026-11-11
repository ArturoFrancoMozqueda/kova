import { nativeEnvironment } from "./policy.mjs";
import { stripeRuntimeIds } from "../stripe-runtime-ids.mjs";

// Private WorkerEntrypoint RPC only. No HTTP route exposes this projection.
// Credentials stay sealed in the original Worker and travel only over a
// service binding into the replacement Container's startup environment.
export function runtimeSettingsClass(WorkerEntrypoint) {
  return class extends WorkerEntrypoint {
    getRuntimeEnvironment(input) {
      if (!input || Array.isArray(input) || Object.keys(input).sort().join(",") !== "publicIds,sha"
          || !/^[a-f0-9]{40}$/i.test(input.sha ?? "")
          || !input.publicIds || Array.isArray(input.publicIds)
          || typeof input.publicIds !== "object") {
        throw new Error("Invalid private runtime configuration request");
      }
      const ids = stripeRuntimeIds(input.publicIds);
      if (Object.keys(ids).length !== 4 || Object.keys(input.publicIds).length !== 4) {
        throw new Error("Private runtime configuration requires the reviewed public offer");
      }
      return nativeEnvironment({ ...this.env, ...ids, KOVA_BUILD_SHA: input.sha });
    }
  };
}
