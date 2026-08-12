import { describe, expect, it } from "vitest";
import config from "../../vercel.json";

describe("Vercel routing contract", () => {
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
