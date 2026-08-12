import { describe, expect, it } from "vitest";

import {
  CUSTOMER_ORDER_CHECKOUT_PERMISSION,
  CUSTOMER_ORDER_VIEW_PERMISSION,
  ORDER_REFUND_PERMISSION,
  ORDER_VOID_PERMISSION,
  permissionsForRole,
} from "./permissions";

describe("customer order role permissions", () => {
  it("lets a cashier operate and checkout without financial reversals", () => {
    const cashier = permissionsForRole("cashier");
    expect(cashier.has(CUSTOMER_ORDER_VIEW_PERMISSION)).toBe(true);
    expect(cashier.has(CUSTOMER_ORDER_CHECKOUT_PERMISSION)).toBe(true);
    expect(cashier.has(ORDER_VOID_PERMISSION)).toBe(false);
    expect(cashier.has(ORDER_REFUND_PERMISSION)).toBe(false);
  });

  it("keeps financial reversals available to management", () => {
    const manager = permissionsForRole("manager");
    expect(manager.has(ORDER_VOID_PERMISSION)).toBe(true);
    expect(manager.has(ORDER_REFUND_PERMISSION)).toBe(true);
  });
});
