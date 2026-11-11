import { bindings, defineConfig, defineContainer, exports } from "cf/config";
import { stripeRuntimeIds } from "../stripe-runtime-ids.mjs";
import { slotWorker, SLOT_APPLICATIONS } from "./slots.mjs";

const slot = process.env.KOVA_NATIVE_TARGET_SLOT;
if (slot !== "blue" && slot !== "green") throw new Error("A replacement API slot is required");
const worker = slotWorker(slot);
const release = process.env.KOVA_BUILD_SHA;
if (!/^[a-f0-9]{40}$/i.test(release ?? "")) throw new Error("Full slot build SHA is required");
const ids = stripeRuntimeIds(process.env);
if (Object.keys(ids).length !== 4) throw new Error("API slot requires the complete reviewed offer");
const api = defineContainer({
  name: SLOT_APPLICATIONS[slot],
  image: { dockerfile: "../../backend/Dockerfile.api", buildContext: "../../backend",
    buildVars: { KOVA_RELEASE_SHA: release } },
  instanceType: "basic", maxInstances: 1, ssh: { enabled: false },
  observability: { enabled: true, logs: { enabled: true } },
});

export default defineConfig({
  worker: {
    name: worker, entrypoint: "./slot-entry.mjs", compatibilityDate: "2026-11-10",
    compatibilityFlags: ["nodejs_compat"], workersDev: false, previewUrls: false,
    limits: { cpuMs: 30_000 },
    // Only the drained inactive Worker is published. The serving Worker and
    // its Durable Object never receive an image or controller update.
    unsafe: { metadata: { code_update_strategy: { mode: "immediate" } } },
    exports: { KovaApi: exports.durableObject({ storage: "sqlite", container: api }),
      ContainerProxy: exports.worker() },
    env: {
      KOVA_BUILD_SHA: bindings.text(release),
      KOVA_NATIVE_SLOT: bindings.text(slot),
      ...Object.fromEntries(Object.entries(ids).map(([name, value]) => [name, bindings.text(value)])),
      API: bindings.durableObject({ worker, exportName: "KovaApi" }),
      RATE_LIMITS: bindings.durableObject({ worker: "kova-backend", exportName: "KovaRateLimit" }),
      SETTINGS: bindings.worker({ worker: "kova-backend", exportName: "NativeSettings" }),
      GATEWAY_STATUS: bindings.worker({ worker: "kova-backend-gateway", exportName: "NativeReleaseStatus" }),
      JOBS: bindings.durableObject({ worker: "kova-backend-jobs", exportName: "KovaJobs" }),
      ASSISTANT_STORAGE: bindings.r2({ name: "kova-assistant" }),
    },
    observability: { enabled: true, redactQueryString: true,
      logs: { enabled: true, invocationLogs: false },
      traces: { enabled: true, headSamplingRate: 0.05 } },
  },
  containers: [api],
});
