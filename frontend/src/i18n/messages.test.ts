import { describe, expect, it } from "vitest";

import { copy } from "./messages";

describe("dashboard restock copy", () => {
  it.each([
    [1, "Te queda 1 de Alfajores: buen momento para reabastecer."],
    [2, "Te quedan 2 de Alfajores: buen momento para reabastecer."],
    [0, "Ya se agotó Alfajores — reabastece."],
  ] as const)("uses the correct stock wording for %i units", (units, expected) => {
    expect(copy.dashboard.storyBannerRestockTail("Alfajores", units)).toBe(expected);
  });
});
