import { describe, expect, it } from "vitest";
import config from "../../vercel.json";

describe("Vercel routing contract", () => {
  it("prevents browser and CDN storage of proxied API responses", () => {
    const apiRule = config.headers.find((rule) => rule.source === "/api/(.*)");
    expect(apiRule).toBeDefined();
    const headers = Object.fromEntries(apiRule!.headers.map(({ key, value }) => [key, value]));
    expect(headers["Cache-Control"].split(",").map((value) => value.trim()))
      .toEqual(expect.arrayContaining(["private", "no-store", "max-age=0"]));
    expect(headers["CDN-Cache-Control"]).toBe("no-store");
    expect(headers["Vercel-CDN-Cache-Control"]).toBe("no-store");
    const apiPattern = new RegExp(`^${apiRule!.source}$`);
    for (const path of ["/api/v1/auth/session", "/api/v1/reports/sales-summary", "/api/health"])
      expect(apiPattern.test(path)).toBe(true);
    for (const path of ["/", "/privacy", "/assets/app.js", "/dashboard"])
      expect(apiPattern.test(path)).toBe(false);

    const assetRule = config.headers.find((rule) => rule.source === "/assets/(.*)");
    expect(assetRule?.headers).toContainEqual({
      key: "Cache-Control", value: "public, max-age=31536000, immutable",
    });
  });

  it("keeps connected Git deployments disabled so CI owns promotion", () => {
    expect(config.git).toEqual({ deploymentEnabled: false });
  });

  it("keeps Vercel observability routes out of the SPA fallback", () => {
    const fallback = config.rewrites.at(-1);

    expect(fallback).toEqual({
      source: "/((?!_vercel/).*)",
      destination: "/app-shell.html",
    });

    const fallbackPattern = new RegExp(`^${fallback?.source}$`);
    expect(fallbackPattern.test("/dashboard")).toBe(true);
    expect(fallbackPattern.test("/_vercel/insights/script.js")).toBe(false);
    expect(fallbackPattern.test("/_vercel/speed-insights/script.js")).toBe(false);
  });
});
