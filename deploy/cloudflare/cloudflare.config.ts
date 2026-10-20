import { bindings, defineConfig, triggers } from "cf/config";

// Domain routing is applied only after the candidate passes acceptance.
// No database, billing or authentication credentials belong in this Worker.
export default defineConfig({
  worker: {
    name: "kova-frontend",
    compatibilityDate: "2026-10-17",
    entrypoint: "./worker.mjs",
    workersDev: false,
    // CPU only; network wait does not consume this allowance. Not a billing cap.
    limits: { cpuMs: 100 },
    domains: ["preview.kovasuite.com"],
    triggers: process.env.KOVA_CLOUDFLARE_FRONTEND === "1" ? [
      triggers.fetch({ pattern: "kovasuite.com/*", zone: "kovasuite.com" }),
      triggers.fetch({ pattern: "www.kovasuite.com/*", zone: "kovasuite.com" }),
    ] : [],
    assets: { htmlHandling: "none", notFoundHandling: "none" },
    env: { ASSETS: bindings.assets() },
    observability: {
      enabled: true,
      redactQueryString: true,
      logs: { enabled: true, invocationLogs: false },
      traces: { enabled: true, headSamplingRate: 0.05 },
    },
  },
});
