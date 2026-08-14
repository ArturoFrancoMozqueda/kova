import { defineConfig, devices } from "@playwright/test";
import baseConfig from "./playwright.config";

export default defineConfig({
  ...baseConfig,
  testIgnore: /production-smoke\.spec\.ts/,
  projects: [
    {
      name: "e2e-mocked-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "e2e-mocked-mobile-chrome",
      use: { ...devices["Pixel 5"] },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
});
