import { describe, expect, it } from "vitest";
import { makeStory } from "@/reports/__fixtures__/story";
import { salesTrendPoints } from "./visualData";

describe("dashboard visual data", () => {
  it("keeps calendar gaps at zero without shifting the original dates or amounts", () => {
    const points = salesTrendPoints(makeStory(), [], false);
    expect(points).toHaveLength(7);
    expect(points[0]).toMatchObject({ id: "2026-07-01", value: 1200 });
    expect(points[1]).toMatchObject({ id: "2026-07-02", value: 0 });
    expect(points[4]).toMatchObject({ id: "2026-07-05", value: 4210 });
  });
  it("preserves negative sales and exact hour attribution", () => {
    const points = salesTrendPoints(makeStory(), [{ hour: 15, net_sales: "-12.50", order_count: 1 }, { hour: 9, net_sales: "75.25", order_count: 2 }], true);
    expect(points).toHaveLength(24);
    expect(points[9]).toMatchObject({ id: "9", label: "09:00", value: 75.25 });
    expect(points[15].value).toBe(-12.5);
    expect(points[0].value).toBe(0);
  });
  it("does not manufacture an hourly series when the source has no breakdown", () => {
    expect(salesTrendPoints(makeStory(), [], true)).toEqual([]);
  });
});
