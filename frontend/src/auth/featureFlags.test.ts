import { describe, expect, it } from "vitest";

import { normalizeFeatureFlags } from "./featureFlags";

describe("normalizeFeatureFlags", () => {
  it("defaults supported flags to false", () => {
    expect(normalizeFeatureFlags(undefined)).toEqual({
      margin_reports: false,
      customer_orders: false,
    });
  });

  it("accepts only an explicit true value for a supported flag", () => {
    expect(normalizeFeatureFlags({ margin_reports: true, unknown_flag: true })).toEqual({
      margin_reports: true,
      customer_orders: false,
    });
    expect(normalizeFeatureFlags({ margin_reports: false })).toEqual({
      margin_reports: false,
      customer_orders: false,
    });
  });
});
