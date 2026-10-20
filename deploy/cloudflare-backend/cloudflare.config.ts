import { bindings, defineConfig, exports, triggers } from "cf/config";

const database = process.env.KOVA_HYPERDRIVE_APP_ID;
const privileged = process.env.KOVA_HYPERDRIVE_PRIVILEGED_ID;
const release = process.env.KOVA_BUILD_SHA;
if (release && !/^[a-f0-9]{40}$/i.test(release)) throw new Error("Full Workers build SHA is required");
const metadata = release ? { KOVA_BUILD_SHA: bindings.text(release) } : {};
const databaseBindings = database ? { DB_APP: bindings.hyperdrive({ id: database }) } : {};
export const observability = {
  enabled: true, redactQueryString: true,
  logs: { enabled: true, invocationLogs: false },
  traces: { enabled: true, headSamplingRate: 0.05 },
};

export const jobs = defineConfig({ worker: {
  name: "kova-backend-jobs", entrypoint: "./jobs.py",
  compatibilityDate: "2026-10-17", compatibilityFlags: ["python_workers", "nodejs_compat"],
  workersDev: false,
  exports: { KovaJobs: exports.durableObject({ storage: "sqlite" }) },
  env: {
    ...metadata,
    ...databaseBindings,
    ASSISTANT_STORAGE: bindings.r2({ name: "kova-assistant" }),
    JOBS: bindings.durableObject({ worker: "kova-backend-jobs", exportName: "KovaJobs" }),
  },
  triggers: [triggers.scheduled({ schedule: "*/5 * * * *" })],
  observability,
} });

export const gateway = defineConfig({ worker: {
  name: "kova-backend-gateway", entrypoint: "./gateway.mjs",
  // Preserve the existing remote ceiling so strict uploads do not erase it.
  // This metadata does not activate or change an account subscription.
  limits: { cpuMs: 100 },
  compatibilityDate: "2026-10-17", compatibilityFlags: ["nodejs_compat"],
  workersDev: false,
  domains: process.env.KOVA_CLOUDFLARE_BACKEND === "1"
    ? ["api-preview.kovasuite.com", "api.kovasuite.com"] : ["api-preview.kovasuite.com"],
  env: { API: bindings.durableObject({ worker: "kova-backend", exportName: "KovaApi" }) },
  observability,
} });

export default defineConfig({
  worker: {
    name: "kova-backend",
    entrypoint: "./entry.py",
    compatibilityDate: "2026-10-17",
    compatibilityFlags: ["python_workers", "nodejs_compat"],
    workersDev: false,
    // Public production routing is added only after full acceptance.
    exports: {
      KovaApi: exports.durableObject({ storage: "sqlite" }),
      KovaRateLimit: exports.durableObject({ storage: "sqlite" }),
    },
    env: {
      ...metadata,
      ...databaseBindings,
      ASSISTANT_STORAGE: bindings.r2({ name: "kova-assistant" }),
      ...(privileged ? { DB_PRIVILEGED: bindings.hyperdrive({ id: privileged }) } : {}),
      API: bindings.durableObject({ worker: "kova-backend", exportName: "KovaApi" }),
      RATE_LIMITS: bindings.durableObject({ worker: "kova-backend", exportName: "KovaRateLimit" }),
      JOBS: bindings.durableObject({ worker: "kova-backend-jobs", exportName: "KovaJobs" }),
    },
    observability,
  },
});
