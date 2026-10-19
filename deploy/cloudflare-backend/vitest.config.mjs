import { readFileSync, cpSync } from "node:fs";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;
const profile = process.env.KOVA_WORKERS_TEST_PROFILE || "runtime";
if (!["runtime", "compatibility", "jobs"].includes(profile)) throw new Error("Unknown test profile");
const apiBundle = `${root}/.cloudflare/output/v0/workers/default/bundle`;
const config = JSON.parse(readFileSync(`${apiBundle}/../worker.config.json`, "utf8"));
let bundle = profile === "jobs" ? apiBundle.replace("/default/", "/jobs/") : apiBundle;
if (profile === "compatibility") {
  bundle = `${root}/.cloudflare/test-crypto`;
  cpSync(apiBundle, bundle, { recursive: true });
  cpSync(`${root}/test/compatibility_worker.py`, `${bundle}/entry.py`);
}
const types = { python: "PythonModule", data: "Data", esm: "ESModule" };
const modules = Object.entries(config.manifest.modules).map(([name, meta]) => ({
  type: types[meta.type], path: `${bundle}/${name}`,
}));
const database = new URL(process.env.KOVA_WORKERS_TEST_DATABASE_URL
  || "postgresql://pos:pos@127.0.0.1:5438/pos");
if (!["127.0.0.1", "localhost"].includes(database.hostname)) {
  throw new Error("Workers integration tests require disposable local Postgres");
}
const runtimeDatabase = new URL(database);
runtimeDatabase.username = "kova_app";
runtimeDatabase.password = "kova_app";
const runtime = profile === "runtime";
const jobs = profile === "jobs";
const durableObjects = runtime ? {
  API: { className: "KovaApi", useSQLite: true },
  RATE_LIMITS: { className: "KovaRateLimit", useSQLite: true },
} : jobs ? { JOBS: { className: "KovaJobs", useSQLite: true } } : {};

export default defineConfig({
  plugins: [cloudflareTest({
    main: "./gateway.mjs",
    miniflare: {
      compatibilityDate: "2026-10-17", compatibilityFlags: ["nodejs_compat"],
      serviceBindings: { TEST_MAILBOX: "test-outbound", TEST_CRYPTO: "backend-python" },
      r2Buckets: { TEST_STORAGE: "assistant-test-storage" },
      bindings: profile === "compatibility" ? {
        TEST_FIXTURES: JSON.parse(readFileSync(`${root}/.cloudflare/test-fixtures.json`, "utf8")),
      } : {},
      durableObjects: runtime ? {
        API: { ...durableObjects.API, scriptName: "backend-python" },
        TEST_RATES: { ...durableObjects.RATE_LIMITS, scriptName: "backend-python" },
      } : jobs ? { TEST_JOBS: { ...durableObjects.JOBS, scriptName: "backend-python" } } : {},
      workers: [{
        name: "backend-python", modules, modulesRoot: bundle,
        compatibilityDate: "2026-10-17", compatibilityFlags: ["python_workers", "nodejs_compat"],
        outboundService: "test-outbound", durableObjects,
        r2Buckets: { ASSISTANT_STORAGE: "assistant-test-storage" },
        bindings: {
          APP_ENV: "production", SECRET_KEY: "synthetic-workers-test-key-32-bytes-minimum",
          RESEND_API_KEY: "re_synthetic_test_only", EMAIL_FROM: "Kova QA <qa@example.com>",
          FRONTEND_URL: "https://app.test", TRUSTED_CLIENT_IP_HEADER: "x-kova-client-ip",
          KOVA_RELEASE_SHA: "workers-integration-test", SENTRY_DSN: "https://synthetic-public@sentry.test/1",
          ASSISTANT_ENABLED: "true", ASSISTANT_TENANT_IDS: "00000000-0000-4000-8000-000000000001",
          ASSISTANT_CLOUDFLARE_ACCOUNT_ID: "00000000000000000000000000000001",
          ASSISTANT_R2_ACCESS_KEY: "synthetic-test-only",
          ASSISTANT_R2_SECRET_KEY: "synthetic-test-only",
        },
        hyperdrives: { DB_APP: runtimeDatabase.href, ...(runtime ? { DB_PRIVILEGED: database.href } : {}) },
      }, {
        name: "test-outbound", modules: true, scriptPath: `${root}/outbound.test-worker.mjs`,
        compatibilityDate: "2026-10-17",
      }],
    },
  })],
  test: { include: [`${profile}.test.mjs`], testTimeout: 30000, hookTimeout: 60000 },
});
