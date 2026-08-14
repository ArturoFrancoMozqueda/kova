import { defineConfig, devices } from "@playwright/test";
import baseConfig from "./playwright.config";

if (!process.env.PLAYWRIGHT_BASE_URL) {
  throw new Error("PLAYWRIGHT_BASE_URL is required for production-smoke");
}
if (process.env.PRODUCTION_SMOKE !== "1") {
  throw new Error("PRODUCTION_SMOKE=1 is required; production smoke cannot be skipped");
}
if (!process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
  throw new Error("VERCEL_AUTOMATION_BYPASS_SECRET is required for the protected candidate");
}

process.env.PLAYWRIGHT_SUITE = "production-smoke";

export default defineConfig({
  ...baseConfig,
  testMatch: /production-smoke\.spec\.ts/,
  reporter: [
    ["list"],
    ["./e2e/production-smoke-reporter.ts"],
  ],
  retries: 0,
  use: {
    ...baseConfig.use,
    extraHTTPHeaders: {
      "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
      "x-vercel-set-bypass-cookie": "true",
    },
  },
  projects: [
    {
      name: "production-smoke-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: undefined,
});
