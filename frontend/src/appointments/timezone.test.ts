import { expect, it } from "vitest";
import { zonedInputToUtc, utcToZonedInput, appointmentDateRange } from "./timezone";

it("converts an explicit Mexico City clock independently of the device timezone", () => {
  expect(zonedInputToUtc("2026-10-20T10:30", "America/Mexico_City")).toBe(
    "2026-10-20T16:30:00.000Z",
  );
  expect(utcToZonedInput("2026-10-20T16:30:00Z", "America/Mexico_City")).toBe(
    "2026-10-20T10:30",
  );
  expect(zonedInputToUtc("2026-10-20T10:30", "America/Cancun")).toBe(
    "2026-10-20T15:30:00.000Z",
  );
});
it("rejects missing spring clocks and ambiguous fall clocks", () => {
  expect(() => zonedInputToUtc("2026-03-08T02:30", "America/Tijuana")).toThrow(
    /no existe/,
  );
  expect(() => zonedInputToUtc("2026-11-01T01:30", "America/Tijuana")).toThrow(
    /dos veces/,
  );
});
it("rejects invalid calendar dates and preserves midnight", () => {
  expect(() =>
    zonedInputToUtc("2026-02-30T12:00", "America/Mexico_City"),
  ).toThrow(/no es válida/);
  expect(zonedInputToUtc("2026-10-20T00:00", "America/Mexico_City")).toBe(
    "2026-10-20T06:00:00.000Z",
  );
});

it("filters complete local days across daylight-saving changes", () => {
  expect(appointmentDateRange("2026-03-08", "2026-03-08", "America/Tijuana")).toEqual({ start: "2026-03-08T08:00:00.000Z", end: "2026-03-09T07:00:00.000Z" });
  expect(appointmentDateRange("2026-11-01", "2026-11-01", "America/Tijuana")).toEqual({ start: "2026-11-01T07:00:00.000Z", end: "2026-11-02T08:00:00.000Z" });
  expect(() => appointmentDateRange("2026-10-20", "2026-10-19", "America/Mexico_City")).toThrow(/período válido/);
});
