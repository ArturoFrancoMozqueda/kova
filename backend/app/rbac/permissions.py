from enum import StrEnum


class Permission(StrEnum):
    CATALOG_CREATE = "catalog.create"
    CATALOG_UPDATE = "catalog.update"
    CATALOG_DELETE = "catalog.delete"
    ORDERS_CREATE = "orders.create"
    ORDERS_REFUND = "orders.refund"
    ORDERS_VOID = "orders.void"
    SHIFTS_OPEN = "shifts.open"
    SHIFTS_CLOSE = "shifts.close"
    INVENTORY_ADJUST = "inventory.adjust"
    REPORTS_VIEW_ALL = "reports.view_all"
    USERS_MANAGE = "users.manage"
    BILLING_MANAGE = "billing.manage"
    SETTINGS_MANAGE = "settings.manage"


ROLE_PERMISSIONS: dict[str, set[Permission]] = {
    "owner": set(Permission),
    "manager": {
        Permission.CATALOG_CREATE,
        Permission.CATALOG_UPDATE,
        Permission.CATALOG_DELETE,
        Permission.ORDERS_CREATE,
        Permission.ORDERS_REFUND,
        Permission.ORDERS_VOID,
        Permission.SHIFTS_OPEN,
        Permission.SHIFTS_CLOSE,
        Permission.INVENTORY_ADJUST,
        Permission.REPORTS_VIEW_ALL,
        Permission.SETTINGS_MANAGE,
    },
    "cashier": {Permission.ORDERS_CREATE, Permission.SHIFTS_OPEN, Permission.SHIFTS_CLOSE},
    "staff": {Permission.ORDERS_CREATE},
}


def has_permission(role: str, permission: Permission) -> bool:
    return permission in ROLE_PERMISSIONS.get(role, set())
