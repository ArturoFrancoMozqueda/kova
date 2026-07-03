import { describe, expect, it } from "vitest";
// Import the AppShell source text (not the module) to assert, structurally,
// that the tenant shell never links into /internal/*. The ops dashboard must
// stay a sibling route reachable only by direct URL + server allowlist.
import appShellSource from "@/layout/AppShell.tsx?raw";

describe("internal ops navigation isolation", () => {
  it("the tenant AppShell contains no /internal link", () => {
    expect(appShellSource).not.toContain("/internal");
  });
});
