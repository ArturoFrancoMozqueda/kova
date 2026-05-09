export const ORDER_REFUND_PERMISSION = "orders.refund";
export const ORDER_VOID_PERMISSION = "orders.void";

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
