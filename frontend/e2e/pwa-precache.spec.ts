import { expect, test } from "./fixtures";

const BUILT_TARGET = ["preview", "production-smoke"].includes(
  process.env.PLAYWRIGHT_TARGET ?? process.env.PLAYWRIGHT_SUITE ?? "",
);

test("the built worker installs the offline POS without marketing screenshots", async ({ request }) => {
  test.skip(!BUILT_TARGET, "Requires the production service worker from a built preview.");
  const response = await request.get("/sw.js");
  expect(response.status()).toBe(200);
  const worker = await response.text();
  const urls = [...worker.matchAll(/\burl:"([^"]+)"/g)].map((match) => match[1]);

  // Exercise the emitted artifact: protecting the actual shell and lazy POS
  // chunks prevents a smaller install from accidentally losing offline use.
  expect(urls).toContain("app-shell.html");
  expect(urls).toContain("manifest.webmanifest");
  expect(urls).toContain("icons/pwa-192.svg");
  for (const required of [
    /^assets\/index-[^/]+\.js$/,
    /^assets\/RegisterView-[^/]+\.js$/,
    /^assets\/SyncQueueView-[^/]+\.js$/,
    /^assets\/vendor-offline-[^/]+\.js$/,
    /^assets\/inter-latin-wght-normal-[^/]+\.woff2$/,
  ]) {
    expect(urls.some((url) => required.test(url))).toBe(true);
  }
  expect(urls.filter((url) => url.startsWith("showcase/"))).toEqual([]);
});
