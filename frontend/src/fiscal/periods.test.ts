import { describe, expect, it } from "vitest";

import {
  latestCompletedPeriodEnd,
  todayInMexicoCity,
  validatePeriodEnd,
} from "./periods";

const monthly = {
  frequency: "monthly" as const,
  weekly_close_day: 7,
  monthly_close_day: 31,
};

describe("fiscal period calendar", () => {
  it("finds the latest completed period without using the browser display locale", () => {
    expect(latestCompletedPeriodEnd({ ...monthly, frequency: "daily" }, "2026-08-16")).toBe(
      "2026-08-15",
    );
    expect(latestCompletedPeriodEnd({ ...monthly, frequency: "weekly" }, "2026-08-16")).toBe(
      "2026-08-09",
    );
    expect(latestCompletedPeriodEnd(monthly, "2026-08-16")).toBe("2026-07-31");
    expect(
      latestCompletedPeriodEnd({ ...monthly, monthly_close_day: 15 }, "2026-08-16"),
    ).toBe("2026-08-15");
  });

  it("normalizes day 31 for short and leap months", () => {
    expect(validatePeriodEnd("2024-02-29", monthly, "2024-03-01")).toEqual({ valid: true });
    expect(validatePeriodEnd("2025-02-28", monthly, "2025-03-01")).toEqual({ valid: true });
    expect(validatePeriodEnd("2024-02-28", monthly, "2024-03-01")).toEqual({
      valid: false,
      reason: "monthly_mismatch",
      expected: "2024-02-29",
    });
  });

  it("rejects the incident date, wrong weekdays and unfinished periods", () => {
    expect(validatePeriodEnd("2026-07-16", monthly, "2026-08-16")).toEqual({
      valid: false,
      reason: "monthly_mismatch",
      expected: "2026-07-31",
    });
    expect(
      validatePeriodEnd(
        "2026-08-10",
        { ...monthly, frequency: "weekly" },
        "2026-08-16",
      ),
    ).toEqual({ valid: false, reason: "weekly_mismatch" });
    expect(validatePeriodEnd("2026-08-16", monthly, "2026-08-16")).toEqual({
      valid: false,
      reason: "not_completed",
    });
  });

  it("derives the Mexico City date at the UTC boundary", () => {
    expect(todayInMexicoCity(new Date("2026-08-16T05:59:59Z"))).toBe("2026-08-15");
    expect(todayInMexicoCity(new Date("2026-08-16T06:00:00Z"))).toBe("2026-08-16");
  });
});
