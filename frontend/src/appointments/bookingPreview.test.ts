import { expect, it } from "vitest";
import { formatNotice, previewStartTimes } from "./bookingPreview";

it("steps from each window's opening while it is before closing, like the server", () => {
  expect(previewStartTimes([{ start: "09:00", end: "10:00" }], 20)).toEqual(["09:00", "09:20", "09:40"]);
  expect(previewStartTimes([{ start: "09:00", end: "10:10" }], 30)).toEqual(["09:00", "09:30", "10:00"]);
});

it("merges several windows in order and ignores overlaps and invalid rows", () => {
  expect(previewStartTimes([
    { start: "16:00", end: "17:00" }, { start: "09:00", end: "09:30" }, { start: "09:00", end: "09:16" }, { start: "", end: "10:00" },
  ], 15)).toEqual(["09:00", "09:15", "16:00", "16:15", "16:30", "16:45"]);
});

it("offers nothing for closed days, empty windows or an invalid step", () => {
  expect(previewStartTimes([], 15)).toEqual([]);
  expect(previewStartTimes([{ start: "10:00", end: "10:00" }], 15)).toEqual([]);
  expect(previewStartTimes([{ start: "09:00", end: "18:00" }], 0)).toEqual([]);
  expect(previewStartTimes([{ start: "00:00", end: "24:00" }], 5, 10)).toHaveLength(10);
});

it("explains the minimum notice in words", () => {
  expect(formatNotice(0)).toBe("sin anticipación mínima");
  expect(formatNotice(45)).toBe("45 minutos");
  expect(formatNotice(120)).toBe("2 horas");
  expect(formatNotice(1440 + 90)).toBe("1 día, 1 hora y 30 minutos");
});
