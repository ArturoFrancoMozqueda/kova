import type { Page } from "@playwright/test";

export async function markFirstUseToursSeen(page: Page, tenantId = "tenant-1") {
  await page.addInitScript((id) => {
    for (const tour of ["register", "catalog", "reports"]) {
      window.localStorage.setItem(`kova:tour:${id}:${tour}`, "1");
    }
  }, tenantId);
}
