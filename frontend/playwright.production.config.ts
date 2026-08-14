import { defineConfig, devices } from "@playwright/test";
import baseConfig from "./playwright.config";

if (!process.env.PLAYWRIGHT_BASE_URL) {
  throw new Error("PLAYWRIGHT_BASE_URL is required for production-smoke");
}
if (process.env.PRODUCTION_SMOKE !== "1") {
  throw new Error("PRODUCTION_SMOKE=1 is required; production smoke cannot be skipped");
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
  projects: [
    {
      name: "production-smoke-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: undefined,
});
