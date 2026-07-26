import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MOTION_MS, exitDelayMs } from "./motion";

// Relative to the Vitest root (frontend/). A `styles.css?raw` import would be
// simpler but resolves to an empty string, because Vitest runs with css: false.
// The length assertion below turns a wrong cwd into a loud failure rather than a
// vacuously passing test.
const STYLES_PATH = "src/styles.css";

function kebabToCamel(name: string): string {
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** Every --kova-dur-* declaration in styles.css, keyed as MOTION_MS keys are. */
function durationTokensFromCss(): Record<string, number> {
  const css = readFileSync(STYLES_PATH, "utf8");
  expect(css.length).toBeGreaterThan(0);
  const tokens: Record<string, number> = {};
  for (const match of css.matchAll(/--kova-dur-([a-z-]+):\s*(\d+)ms/g)) {
    tokens[kebabToCamel(match[1]!)] = Number(match[2]);
  }
  return tokens;
}

describe("MOTION_MS", () => {
  // The anti-drift guard. Anything that unmounts reads its delay from MOTION_MS
  // while the CSS reads --kova-dur-*; if the two disagree, a node either
  // disappears mid-animation or lingers after it finished.
  it("matches the --kova-dur-* scale in styles.css exactly", () => {
    const fromCss = durationTokensFromCss();
    expect(Object.keys(fromCss).length).toBeGreaterThan(0);
    expect(fromCss).toEqual({ ...MOTION_MS });
  });
});

describe("exitDelayMs", () => {
  it("passes the duration through when motion is allowed", () => {
    // jsdom has no matchMedia, so prefersReducedMotion() is false here.
    expect(exitDelayMs(MOTION_MS.panelExit)).toBe(MOTION_MS.panelExit);
  });
});
