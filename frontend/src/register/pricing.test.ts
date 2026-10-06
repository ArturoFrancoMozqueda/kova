import { describe, expect, it } from "vitest";
import { calculateSalePricing } from "./pricing";

describe("sale pricing", () => {
  it("adds tax after discount and allocates every cent", () => {
    const result = calculateSalePricing([1000, 1000, 1000], "1.00", "16");
    expect(result).toMatchObject({ valid: true, subtotal: 3000, discount: 100, tax: 464, total: 3364 });
    expect(result.allocated.reduce((sum, value) => sum + value, 0)).toBe(result.total);
  });
  it("handles zero totals and rejects invalid input", () => {
    expect(calculateSalePricing([1, 2], "0.03", "16").allocated).toEqual([0, 0]);
    for (const [discount, rate] of [["31.00", "16"], ["1e2", "0"], ["0", "100.01"], ["0", "16.001"]]) {
      expect(calculateSalePricing([3000], discount, rate).valid).toBe(false);
    }
  });
  it("rounds small tax half up without negative allocations", () => {
    const result = calculateSalePricing([1, 2, 10000], "0.01", "16");
    expect(result.total).toBe(11602);
    expect(result.allocated.every((line) => line >= 0)).toBe(true);
    expect(result.allocated.reduce((sum, value) => sum + value, 0)).toBe(result.total);
  });
});
