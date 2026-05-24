import { describe, expect, it } from "vitest";
import {
  currentMonthStartInTimezone,
  daysAgoInTimezone,
  todayInTimezone,
  yesterdayInTimezone,
} from "./date";

describe("timezone date helpers", () => {
  it("keeps today in Mexico City when UTC has already moved to tomorrow", () => {
    const afterCloseInMexico = new Date("2026-05-24T00:30:00.000Z");

    expect(afterCloseInMexico.toISOString().slice(0, 10)).toBe("2026-05-24");
    expect(todayInTimezone("America/Mexico_City", afterCloseInMexico)).toBe("2026-05-23");
  });

  it("calculates relative dates in the requested timezone", () => {
    const afterCloseInMexico = new Date("2026-05-24T00:30:00.000Z");

    expect(yesterdayInTimezone("America/Mexico_City", afterCloseInMexico)).toBe("2026-05-22");
    expect(daysAgoInTimezone("America/Mexico_City", 6, afterCloseInMexico)).toBe("2026-05-17");
  });

  it("uses the local month start, not the UTC month", () => {
    const stillAprilInMexico = new Date("2026-05-01T01:30:00.000Z");

    expect(todayInTimezone("America/Mexico_City", stillAprilInMexico)).toBe("2026-04-30");
    expect(currentMonthStartInTimezone("America/Mexico_City", stillAprilInMexico)).toBe(
      "2026-04-01",
    );
  });
});
