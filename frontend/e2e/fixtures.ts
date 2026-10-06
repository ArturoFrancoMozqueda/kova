import { expect, test as base, type Page } from "@playwright/test";

type GuardFixtures = {
  apiRequestGuard: void;
};

const SHARED_BACKGROUND_ALLOWLIST = [
  { method: "POST", path: /^\/api\/v1\/auth\/refresh$/, status: 401 },
  { method: "POST", path: /^\/api\/v1\/telemetry\/events\/anonymous\/session$/, status: 202 },
  { method: "POST", path: /^\/api\/v1\/telemetry\/events$/, status: 202 },
  { method: "GET", path: /^\/api\/v1\/settings\/(receipt|business-profile)$/, status: 503 },
  { method: "GET", path: /^\/api\/v1\/billing\/subscription$/, status: 503 },
  { method: "GET", path: /^\/api\/v1\/catalog\/(products|categories|modifier-groups)$/, status: 503 },
  { method: "GET", path: /^\/api\/v1\/reports\/(sales-by-hour|sales-summary|business-story|branches)$/, status: 503 },
  { method: "GET", path: /^\/api\/v1\/customers$/, status: 503 },
  { method: "GET", path: /^\/api\/v1\/branches\/transfers$/, status: 503 },
  { method: "GET", path: /^\/api\/v1\/inventory\/(stock|low-stock)$/, status: 503 },
  { method: "GET", path: /^\/api\/v1\/inventory\/(velocity|movements)$/, status: 503 },
  { method: "GET", path: /^\/api\/v1\/(onboarding\/state|employees|shifts)$/, status: 503 },
  { method: "GET", path: /^\/api\/v1\/shifts\/current$/, status: 503 },
  { method: "GET", path: /^\/api\/v1\/orders\/[^/]+\/receipt$/, status: 503 },
] as const;

/**
 * Mocked browser scenarios must declare every API request with page.route().
 * Playwright resolves routes in reverse registration order, so scenario mocks
 * registered by a test take precedence over this fallback. Anything that
 * reaches the fallback is an accidental call to Vite's local API proxy and
 * must fail the test instead of disappearing as a swallowed ECONNREFUSED.
 */
export const test = base.extend<GuardFixtures>({
  apiRequestGuard: [
    async ({ page }, use) => {
      const unexpected: string[] = [];
      const guardEnabled =
        process.env.PLAYWRIGHT_SUITE !== "production-smoke" &&
        process.env.KOVA_INTEGRATION !== "1";

      if (guardEnabled) {
        await page.route("**/api/v1/**", async (route) => {
          const request = route.request();
          const pathname = new URL(request.url()).pathname;
          // Branch discovery is shared by every authenticated screen. Scenarios
          // that exercise it override this typed, empty background response.
          if (request.method() === "GET" && pathname === "/api/v1/branches") {
            await route.fulfill({ json: [] });
            return;
          }
          // The shell now discovers the server-controlled assistant cohort.
          // Other scenarios keep the production default (all capabilities off);
          // assistant scenarios override this exact route with explicit gates.
          if (request.method() === "GET" && pathname === "/api/v1/assistant/capabilities") {
            await route.fulfill({ json: {
              enabled: false, inference_ready: false, configuration: false,
              documents: false, email: false, role: "owner",
            } });
            return;
          }
          const sharedBackground = SHARED_BACKGROUND_ALLOWLIST.find(
            (entry) => entry.method === request.method() && entry.path.test(pathname),
          );
          if (sharedBackground) {
            await route.fulfill({ status: sharedBackground.status });
            return;
          }
          unexpected.push(`${request.method()} ${request.url()}`);
          await route.fulfill({
            status: 599,
            contentType: "application/json",
            body: JSON.stringify({ detail: "Unexpected API request in mocked E2E scenario" }),
          });
        });
      }

      await use();

      expect(
        unexpected,
        `Unexpected API requests were not mocked:\n${unexpected.join("\n")}`,
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
export type { Page };
