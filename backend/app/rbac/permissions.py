from enum import StrEnum


class Permission(StrEnum):
    CUSTOMERS_VIEW = "customers.view"
    CUSTOMERS_MANAGE = "customers.manage"
    CUSTOMERS_HISTORY = "customers.history"
    CATALOG_CREATE = "catalog.create"
    CATALOG_UPDATE = "catalog.update"
    CATALOG_DELETE = "catalog.delete"
    ORDERS_CREATE = "orders.create"
    ORDERS_REFUND = "orders.refund"
    ORDERS_VOID = "orders.void"
    CUSTOMER_ORDERS_VIEW = "customer_orders.view"
    CUSTOMER_ORDERS_CREATE = "customer_orders.create"
    CUSTOMER_ORDERS_UPDATE = "customer_orders.update"
    CUSTOMER_ORDERS_CANCEL = "customer_orders.cancel"
    CUSTOMER_ORDERS_CHECKOUT = "customer_orders.checkout"
    SHIFTS_OPEN = "shifts.open"
    SHIFTS_CLOSE = "shifts.close"
    INVENTORY_ADJUST = "inventory.adjust"
    EXPENSES_MANAGE = "expenses.manage"
    REPORTS_VIEW_ALL = "reports.view_all"
    USERS_MANAGE = "users.manage"
    BILLING_VIEW = "billing.view"
    BILLING_MANAGE = "billing.manage"
    SETTINGS_MANAGE = "settings.manage"
    FISCAL_VIEW = "fiscal.view"
    FISCAL_MANAGE = "fiscal.manage"


ROLE_PERMISSIONS: dict[str, set[Permission]] = {
    "owner": set(Permission),
    "manager": {
        Permission.CUSTOMERS_VIEW,
        Permission.CUSTOMERS_MANAGE,
        Permission.CUSTOMERS_HISTORY,
        Permission.CATALOG_CREATE,
        Permission.CATALOG_UPDATE,
        Permission.CATALOG_DELETE,
        Permission.ORDERS_CREATE,
        Permission.ORDERS_REFUND,
        Permission.ORDERS_VOID,
        Permission.CUSTOMER_ORDERS_VIEW,
        Permission.CUSTOMER_ORDERS_CREATE,
        Permission.CUSTOMER_ORDERS_UPDATE,
        Permission.CUSTOMER_ORDERS_CANCEL,
        Permission.CUSTOMER_ORDERS_CHECKOUT,
        Permission.SHIFTS_OPEN,
        Permission.SHIFTS_CLOSE,
        Permission.INVENTORY_ADJUST,
        Permission.EXPENSES_MANAGE,
        Permission.REPORTS_VIEW_ALL,
        Permission.SETTINGS_MANAGE,
        Permission.FISCAL_VIEW,
    },
    "cashier": {
        Permission.CUSTOMERS_VIEW,
        Permission.ORDERS_CREATE,
        Permission.CUSTOMER_ORDERS_VIEW,
        Permission.CUSTOMER_ORDERS_CREATE,
        Permission.CUSTOMER_ORDERS_UPDATE,
        Permission.CUSTOMER_ORDERS_CANCEL,
        Permission.CUSTOMER_ORDERS_CHECKOUT,
        Permission.SHIFTS_OPEN,
        Permission.SHIFTS_CLOSE,
    },
    "staff": {
        Permission.CUSTOMERS_VIEW,
        Permission.ORDERS_CREATE,
        Permission.CUSTOMER_ORDERS_VIEW,
        Permission.CUSTOMER_ORDERS_CREATE,
        Permission.CUSTOMER_ORDERS_UPDATE,
        Permission.CUSTOMER_ORDERS_CANCEL,
        Permission.CUSTOMER_ORDERS_CHECKOUT,
    },
}


def has_permission(role: str, permission: Permission) -> bool:
    return permission in ROLE_PERMISSIONS.get(role, set())
