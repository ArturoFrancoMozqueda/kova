import { describe, expect, it } from "vitest";
import { suggestCashBills } from "./cashSuggestions";

describe("suggestCashBills", () => {
  it("rounds a small ticket up to the bills a customer usually hands over", () => {
    expect(suggestCashBills(18_500)).toEqual([190, 200, 500, 1000]);
  });

  it("offers amounts above the total when the fixed bills would all be too small", () => {
    expect(suggestCashBills(73_000)).toEqual([740, 750, 800, 1000]);
  });

  it("never repeats the exact total, which has its own button", () => {
    expect(suggestCashBills(20_000)).not.toContain(200);
    expect(suggestCashBills(20_000)[0]).toBeGreaterThan(200);
  });

  it("handles totals with centavos", () => {
    expect(suggestCashBills(4_550)).toEqual([50, 100, 200, 500]);
  });

  it("falls back to common bills for an empty cart", () => {
    expect(suggestCashBills(0)).toEqual([50, 100, 200, 500]);
  });
});
