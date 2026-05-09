export const ORDER_REFUND_PERMISSION = "orders.refund";
export const ORDER_VOID_PERMISSION = "orders.void";
export const INVENTORY_ADJUST_PERMISSION = "inventory.adjust";
export const REPORTS_VIEW_ALL_PERMISSION = "reports.view_all";
export const SHIFT_OPEN_PERMISSION = "shifts.open";
export const SHIFT_CLOSE_PERMISSION = "shifts.close";

export function permissionsFromSearch(search: string): Set<string> {
  const params = new URLSearchParams(search);
  const raw = params.get("permissions") ?? window.localStorage.getItem("pos.permissions") ?? "";
  return new Set(
    raw
      .split(",")
      .map((permission) => permission.trim())
      .filter(Boolean),
  );
}
