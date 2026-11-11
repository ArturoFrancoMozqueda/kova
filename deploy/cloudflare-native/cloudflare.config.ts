import { bindings, defineConfig, defineContainer, exports } from "cf/config";
import { stripeRuntimeIds } from "../stripe-runtime-ids.mjs";
import { nativeHandoff } from "../native-handoff.mjs";

const release = process.env.KOVA_BUILD_SHA;
if (!release || !/^[a-f0-9]{40}$/i.test(release)) {
  throw new Error("Full native build SHA is required");
}
const handoff = process.env.KOVA_NATIVE_HANDOFF;
if (handoff !== undefined && !nativeHandoff(handoff, release)) {
  throw new Error("Invalid native release handoff");
}
const coreImage = process.env.KOVA_NATIVE_CORE_IMAGE;
if (process.env.KOVA_NATIVE_CORE_SOURCE_SHA !== undefined
    && !/^[a-f0-9]{40}$/i.test(process.env.KOVA_NATIVE_CORE_SOURCE_SHA)) {
  throw new Error("Full private settings source SHA is required");
}
if (coreImage !== undefined && !/^registry\.cloudflare\.com\/47d850c847503be3597dc7165cfea177\/kova-native-api(?:@sha256:[a-f0-9]{64}|:[a-f0-9]{8,64})$/.test(coreImage)) {
  throw new Error("Core bootstrap requires the captured approved image");
}

const api = defineContainer({
  name: "kova-native-api",
  image: coreImage ? { reference: coreImage } : {
    dockerfile: "../../backend/Dockerfile.api",
    buildContext: "../../backend",
    buildVars: { KOVA_RELEASE_SHA: release },
  },
  instanceType: "basic",
  maxInstances: 1,
  ssh: { enabled: false },
  observability: { enabled: true, logs: { enabled: true } },
});

export default defineConfig({
  worker: {
    name: "kova-backend",
    entrypoint: "./entry.mjs",
    compatibilityDate: "2026-10-20",
    compatibilityFlags: ["nodejs_compat"],
    workersDev: false,
    previewUrls: false,
    // A resident controller never hibernates. Cloudflare's deferred default
    // otherwise keeps its old boot environment for up to 300s while the image
    // rollout is already running. The bounded handoff preserves the already
    // running, verified previous process until the platform replaces its image.
    unsafe: { metadata: { code_update_strategy: coreImage
      ? { mode: "deferred", max_delay: 86400 } : { mode: "immediate" } } },
    limits: { cpuMs: 30_000 },
    exports: {
      KovaApi: exports.durableObject({ storage: "sqlite", container: api }),
      KovaRateLimit: exports.durableObject({ storage: "sqlite" }),
      ContainerProxy: exports.worker(),
      NativeSettings: exports.worker(),
    },
    env: {
      KOVA_BUILD_SHA: bindings.text(release),
      ...(process.env.KOVA_NATIVE_CORE_SOURCE_SHA === undefined ? {} : {
        KOVA_NATIVE_CORE_SOURCE_SHA: bindings.text(process.env.KOVA_NATIVE_CORE_SOURCE_SHA),
      }),
      ...(handoff === undefined ? {} : { KOVA_NATIVE_HANDOFF: bindings.text(handoff) }),
      ...Object.fromEntries(Object.entries(stripeRuntimeIds(process.env))
        .map(([name, value]) => [name, bindings.text(value)])),
      ...(process.env.KOVA_HYPERDRIVE_APP_ID ? {
        DB_APP: bindings.hyperdrive({ id: process.env.KOVA_HYPERDRIVE_APP_ID }),
      } : {}),
      ...(process.env.KOVA_HYPERDRIVE_PRIVILEGED_ID ? {
        DB_PRIVILEGED: bindings.hyperdrive({ id: process.env.KOVA_HYPERDRIVE_PRIVILEGED_ID }),
      } : {}),
      API: bindings.durableObject({ worker: "kova-backend", exportName: "KovaApi" }),
      GATEWAY_STATUS: bindings.worker({ worker: "kova-backend-gateway", exportName: "NativeReleaseStatus" }),
      RATE_LIMITS: bindings.durableObject({ worker: "kova-backend", exportName: "KovaRateLimit" }),
      JOBS: bindings.durableObject({ worker: "kova-backend-jobs", exportName: "KovaJobs" }),
      ASSISTANT_STORAGE: bindings.r2({ name: "kova-assistant" }),
    },
    observability: {
      enabled: true, redactQueryString: true,
      logs: { enabled: true, invocationLogs: false },
      traces: { enabled: true, headSamplingRate: 0.05 },
    },
  },
  containers: [api],
});
