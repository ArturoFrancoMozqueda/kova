import { bindings, defineConfig, defineContainer, exports } from "cf/config";

const release = process.env.KOVA_BUILD_SHA;
if (!release || !/^[a-f0-9]{40}$/i.test(release)) {
  throw new Error("Full native build SHA is required");
}

const api = defineContainer({
  name: "kova-native-api",
  image: {
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
    limits: { cpuMs: 30_000 },
    exports: {
      KovaApi: exports.durableObject({ storage: "sqlite", container: api }),
      KovaRateLimit: exports.durableObject({ storage: "sqlite" }),
      ContainerProxy: exports.worker(),
    },
    env: {
      KOVA_BUILD_SHA: bindings.text(release),
      ...(process.env.KOVA_HYPERDRIVE_APP_ID ? {
        DB_APP: bindings.hyperdrive({ id: process.env.KOVA_HYPERDRIVE_APP_ID }),
      } : {}),
      ...(process.env.KOVA_HYPERDRIVE_PRIVILEGED_ID ? {
        DB_PRIVILEGED: bindings.hyperdrive({ id: process.env.KOVA_HYPERDRIVE_PRIVILEGED_ID }),
      } : {}),
      API: bindings.durableObject({ worker: "kova-backend", exportName: "KovaApi" }),
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
