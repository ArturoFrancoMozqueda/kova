import { useAuthContext } from "./AuthContext";

export const CATALOG_CREATE_PERMISSION = "catalog.create";
export const CATALOG_UPDATE_PERMISSION = "catalog.update";
export const CATALOG_DELETE_PERMISSION = "catalog.delete";
export const ORDER_CREATE_PERMISSION = "orders.create";
export const ORDER_REFUND_PERMISSION = "orders.refund";
export const ORDER_VOID_PERMISSION = "orders.void";
export const INVENTORY_ADJUST_PERMISSION = "inventory.adjust";
export const REPORTS_VIEW_ALL_PERMISSION = "reports.view_all";
export const SHIFT_OPEN_PERMISSION = "shifts.open";
export const SHIFT_CLOSE_PERMISSION = "shifts.close";
export const BILLING_VIEW_PERMISSION = "billing.view";
export const BILLING_MANAGE_PERMISSION = "billing.manage";

const ROLE_PERMISSIONS: Record<string, ReadonlyArray<string>> = {
  owner: [
    CATALOG_CREATE_PERMISSION,
    CATALOG_UPDATE_PERMISSION,
    CATALOG_DELETE_PERMISSION,
    ORDER_CREATE_PERMISSION,
    ORDER_REFUND_PERMISSION,
    ORDER_VOID_PERMISSION,
    INVENTORY_ADJUST_PERMISSION,
    REPORTS_VIEW_ALL_PERMISSION,
    SHIFT_OPEN_PERMISSION,
    SHIFT_CLOSE_PERMISSION,
    BILLING_VIEW_PERMISSION,
    BILLING_MANAGE_PERMISSION,
  ],
  manager: [
    CATALOG_CREATE_PERMISSION,
    CATALOG_UPDATE_PERMISSION,
    CATALOG_DELETE_PERMISSION,
    ORDER_CREATE_PERMISSION,
    ORDER_REFUND_PERMISSION,
    ORDER_VOID_PERMISSION,
    INVENTORY_ADJUST_PERMISSION,
    REPORTS_VIEW_ALL_PERMISSION,
    SHIFT_OPEN_PERMISSION,
    SHIFT_CLOSE_PERMISSION,
  ],
  cashier: [ORDER_CREATE_PERMISSION, SHIFT_OPEN_PERMISSION, SHIFT_CLOSE_PERMISSION],
  staff: [ORDER_CREATE_PERMISSION],
};

export function permissionsForRole(role: string): Set<string> {
  return new Set(ROLE_PERMISSIONS[role] ?? []);
}

export function usePermission(permission: string): boolean {
  const { state } = useAuthContext();
  if (state.status !== "authenticated") return false;
  return permissionsForRole(state.user.role).has(permission);
}
