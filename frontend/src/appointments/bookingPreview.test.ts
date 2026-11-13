import { expect, it } from "vitest";
import { formatNotice } from "./bookingPreview";

it("explains the minimum notice in words", () => {
  expect(formatNotice(0)).toBe("sin anticipación mínima");
  expect(formatNotice(45)).toBe("45 minutos");
  expect(formatNotice(120)).toBe("2 horas");
  expect(formatNotice(1440 + 90)).toBe("1 día, 1 hora y 30 minutos");
});
