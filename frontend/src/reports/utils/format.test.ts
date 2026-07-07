import { describe, expect, it } from "vitest";

import { displayPersonName } from "./format";

describe("displayPersonName", () => {
  it("passes real names through untouched", () => {
    expect(displayPersonName("Sofía Ramírez")).toBe("Sofía Ramírez");
  });

  it("derives a capitalized name from an email local part", () => {
    expect(displayPersonName("sofia@bakery.local")).toBe("Sofia");
    expect(displayPersonName("demo@kovademo.com")).toBe("Demo");
  });

  it("splits local-part separators into name words", () => {
    expect(displayPersonName("maria.fernanda_lopez@negocio.mx")).toBe("Maria Fernanda Lopez");
  });
});
