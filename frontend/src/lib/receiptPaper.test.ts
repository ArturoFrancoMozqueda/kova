import { beforeEach, describe, expect, it } from "vitest";

import {
  cacheReceiptPaperWidth,
  normalizeReceiptPaperWidth,
  readCachedReceiptPaperWidth,
} from "./receiptPaper";

describe("receipt paper width", () => {
  beforeEach(() => window.localStorage.clear());

  it("accepts only supported thermal widths and defaults to 80 mm", () => {
    expect(normalizeReceiptPaperWidth(58)).toBe(58);
    expect(normalizeReceiptPaperWidth("58")).toBe(58);
    expect(normalizeReceiptPaperWidth(80)).toBe(80);
    expect(normalizeReceiptPaperWidth(42)).toBe(80);
  });

  it("keeps the non-sensitive preference isolated by tenant", () => {
    cacheReceiptPaperWidth("tenant-a", 58);
    expect(readCachedReceiptPaperWidth("tenant-a")).toBe(58);
    expect(readCachedReceiptPaperWidth("tenant-b")).toBe(80);
  });
});
