import { describe, expect, it } from "vitest";
import {
  STANDARD_PLAN,
  STANDARD_PLAN_AMOUNT,
  STANDARD_PLAN_DAILY_APPROX,
} from "./standardPlan";

describe("standard plan derived labels", () => {
  it("keeps the daily reframe as a pure derivation of the real price", () => {
    // El "≈ $X al día" de la landing debe ser siempre precio/30 redondeado —
    // nunca un número editado a mano (landing_metrics.md).
    expect(STANDARD_PLAN_DAILY_APPROX).toBe(Math.round(STANDARD_PLAN_AMOUNT / 30));
    expect(STANDARD_PLAN_AMOUNT).toBe(STANDARD_PLAN.amountMinorUnits / 100);
  });
});
