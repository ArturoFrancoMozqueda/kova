import { afterEach, describe, expect, it, vi } from "vitest";

import {
  activePreset,
  addDays,
  daysBetweenInclusive,
  isValidDateRange,
  presetRange,
  previousComparableRange,
} from "./dateRange";

describe("dateRange arithmetic", () => {
  it("rejects missing, impossible, and reversed date ranges", () => {
    expect(isValidDateRange("", "2026-07-05")).toBe(false);
    expect(isValidDateRange("2026-07-05", "")).toBe(false);
    expect(isValidDateRange("2026-02-30", "2026-03-02")).toBe(false);
    expect(isValidDateRange("invalid", "2026-07-05")).toBe(false);
    expect(isValidDateRange("2026-07-05", "2026-07-01")).toBe(false);
    expect(isValidDateRange("2024-02-29", "2024-03-01")).toBe(true);
    expect(isValidDateRange("2026-07-05", "2026-07-05")).toBe(true);
  });
  it("counts a single day as 1", () => {
    expect(daysBetweenInclusive("2026-07-05", "2026-07-05")).toBe(1);
  });

  it("counts a 7-day inclusive range", () => {
    expect(daysBetweenInclusive("2026-07-01", "2026-07-07")).toBe(7);
  });

  it("crosses month boundaries", () => {
    expect(daysBetweenInclusive("2026-01-30", "2026-02-02")).toBe(4);
  });

  it("crosses year boundaries", () => {
    expect(daysBetweenInclusive("2025-12-30", "2026-01-02")).toBe(4);
  });

  it("floors reversed ranges at 1", () => {
    expect(daysBetweenInclusive("2026-07-05", "2026-07-01")).toBe(1);
  });

  it("adds and subtracts days across a month edge", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("maps a single day to the day before", () => {
    expect(previousComparableRange("2026-07-05", "2026-07-05")).toEqual({
      startDate: "2026-07-04",
      endDate: "2026-07-04",
    });
  });

  it("maps a 7-day range to the prior 7 days", () => {
    expect(previousComparableRange("2026-07-01", "2026-07-07")).toEqual({
      startDate: "2026-06-24",
      endDate: "2026-06-30",
    });
  });
});

describe("presets (with a fixed clock)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("computes today / seven-day / month ranges and round-trips activePreset", () => {
    // Noon UTC on 2026-07-05 is the same calendar day in America/Mexico_City.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T12:00:00Z"));
    const tz = "America/Mexico_City";

    const today = presetRange("today", tz);
    expect(today).toEqual({ startDate: "2026-07-05", endDate: "2026-07-05" });
    expect(activePreset(today.startDate, today.endDate, tz)).toBe("today");

    const seven = presetRange("seven_days", tz);
    expect(seven).toEqual({ startDate: "2026-06-29", endDate: "2026-07-05" });
    expect(activePreset(seven.startDate, seven.endDate, tz)).toBe("seven_days");

    const month = presetRange("month", tz);
    expect(month).toEqual({ startDate: "2026-06-06", endDate: "2026-07-05" });
    expect(activePreset(month.startDate, month.endDate, tz)).toBe("month");

    expect(activePreset("2026-01-01", "2026-01-15", tz)).toBeNull();
  });
});
