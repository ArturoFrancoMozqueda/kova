import { describe, expect, it } from "vitest";
import { commercialPlanIdentity, hasPlanFeature } from "./entitlements";
import type { CommercialAccess } from "@/auth/types";

const essential: CommercialAccess = { allowed: true, reason: "active", valid_until: "2030-01-01T00:00:00Z",
  plan_code: "esencial", features: ["pos", "inventory", "sales_reports", "public_catalog"], limits: { product_image_bytes: 250_000_000 } };

describe("authenticated plan snapshot", () => {
  it("preserves an older session and fails closed for an explicit unrecognized plan", () => {
    expect(hasPlanFeature(undefined, "quotes")).toBe(true);
    expect(hasPlanFeature({ allowed: true, reason: "active", valid_until: null }, "quotes")).toBe(true);
    expect(hasPlanFeature({ ...essential, plan_code: "unknown", features: undefined }, "pos")).toBe(false);
  });
  it("uses feature membership independently from role and denies commercially blocked access", () => {
    expect(hasPlanFeature(essential, "sales_reports")).toBe(true);
    expect(hasPlanFeature(essential, "advanced_reports")).toBe(false);
    expect(hasPlanFeature({ ...essential, allowed: false }, "pos")).toBe(false);
  });
  it("changes cache identity on downgrade or limits but not feature ordering", () => {
    const full = { ...essential, plan_code: "gestion" as const, features: [...essential.features!, "quotes"] };
    expect(commercialPlanIdentity(full)).not.toEqual(commercialPlanIdentity(essential));
    expect(commercialPlanIdentity({ ...essential, features: [...essential.features!].reverse() })).toEqual(commercialPlanIdentity(essential));
    expect(commercialPlanIdentity({ ...essential, limits: { product_image_bytes: 1_073_741_824 } })).not.toEqual(commercialPlanIdentity(essential));
  });
});
