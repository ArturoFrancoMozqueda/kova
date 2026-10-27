import { defineConfig, devices } from "@playwright/test";
import baseConfig from "./playwright.config";

process.env.PLAYWRIGHT_TARGET = "preview";

export default defineConfig({
  ...baseConfig,
  testIgnore: /production-smoke\.spec\.ts/,
  retries: 0,
  use: { ...baseConfig.use, trace: "retain-on-failure" },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 5174 --strictPort",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "e2e-preview-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "e2e-preview-mobile-chrome",
      use: { ...devices["Pixel 5"] },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
});
