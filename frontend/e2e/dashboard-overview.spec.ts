import { expect, test } from "./fixtures";
import { makeStory } from "../src/reports/__fixtures__/story";
import { summaryFromStory } from "../src/dashboard/storyAdapters";

test("loads and changes periods through the overview without legacy dashboard reads", async ({ page }) => {
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: {
    authenticated: true, tenant_id: "tenant-1", tenant_name: "Mi negocio",
    user: { id: "user-1", email: "owner@example.com", tenant_id: "tenant-1", role: "owner" },
  } }));
  const periods: string[] = [];
  const story = makeStory();
  await page.route("**/api/v1/reports/dashboard?*", route => {
    periods.push(new URL(route.request().url()).searchParams.get("period")!);
    return route.fulfill({ json: {
      story, hourly: [], previous_summary: summaryFromStory(story), timezone: "America/Mexico_City",
      active_catalog_count: 1, tracked_inventory_count: 1, low_stock_items: [],
      active_employee_count: 1, closed_shift_count: 1, billing: null,
      onboarding: { tenant_id: "tenant-1", completed_count: 0, total_count: 0, steps: [] },
    } });
  });
  const legacy: string[] = [];
  page.on("request", request => {
    if (/\/api\/v1\/(reports\/(business-story|sales-summary|sales-by-hour)|catalog\/products|inventory\/(stock|low-stock)|employees|shifts|onboarding\/state)(\?|$)/.test(request.url())) {
      legacy.push(request.url());
    }
  });
  await page.goto("/dashboard");
  // "Tu día" heads the ready panel on every load. "Qué hacer ahora" no longer
  // renders when there's nothing to act on (as in this steady fixture).
  await expect(page.getByText("Tu día", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "7 días", exact: true }).click();
  await expect(page.getByText("Tu día", { exact: true })).toBeVisible();
  // React's development StrictMode remounts once; production has one load.
  expect(periods).toEqual(process.env.PLAYWRIGHT_TARGET === "dev"
    ? ["day", "day", "week"] : ["day", "week"]);
  expect(legacy).toEqual([]);
});
