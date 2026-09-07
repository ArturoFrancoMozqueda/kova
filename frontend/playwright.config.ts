import { defineConfig, devices } from "@playwright/test";

const deployedUrl = process.env.PLAYWRIGHT_BASE_URL;
const localUrl = "http://127.0.0.1:5174";
const baseURL = deployedUrl ?? localUrl;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  // The CI smoke job runs against the live Vercel deployment, so a request can
  // transiently time out while the deploy is still propagating (seen as
  // "Request context disposed" on the first landing fetch). Retry on CI so a
  // single infra blip doesn't fail the whole smoke run — and block deploy.
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL,
    trace: "on-first-retry",
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
