import { describe, expect, it } from "vitest";

import { nextStatus, previousStatus } from "./labels";

describe("customer order status navigation", () => {
  it("advances one operational state at a time", () => {
    expect(nextStatus("new")).toBe("confirmed");
    expect(nextStatus("ready")).toBe("fulfilled");
    expect(nextStatus("fulfilled")).toBeNull();
    expect(nextStatus("cancelled")).toBeNull();
  });

  it("supports supervised backward corrections", () => {
    expect(previousStatus("ready")).toBe("in_progress");
    expect(previousStatus("confirmed")).toBe("new");
    expect(previousStatus("new")).toBeNull();
  });
});
