import { defineConfig, devices } from "@playwright/test";

const deployedUrl = process.env.PLAYWRIGHT_BASE_URL;
const localUrl = "http://127.0.0.1:5174";
const baseURL = deployedUrl ?? localUrl;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  // Only the real-stack integration suite inherits this; every other config
  // sets its own retries. One retry absorbs a cold docker stack, while a test
  // that needs more is reported as flaky instead of hidden.
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Mobile project scoped to mobile.spec.ts only — the other suites assume
      // desktop layout and viewport-specific affordances (sidebars, table cells)
      // that intentionally collapse on phones. Add new mobile-targeted tests to
      // e2e/mobile.spec.ts to have them covered here.
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  // Each local suite declares its own server. This common config is also used
  // by integration/production runs that provide PLAYWRIGHT_BASE_URL.
  webServer: undefined,
});
