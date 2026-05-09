# Spec — Authorization / RBAC (Sprint 0B)

## Problem Statement

The platform needs a centralized permission model so authorization checks are
consistent, testable, and not scattered across route handlers.

## Roles

Initial roles (seeded in migration 0003):

| Role | Description |
|---|---|
| `owner` | Full access to all features |
| `manager` | Operations access; cannot manage billing or delete tenants |
| `cashier` | Can create orders and manage shifts |
| `staff` | Can create orders only |

A user has exactly one role per tenant (stored in `memberships.role`).

## Permission Constants

Defined in `backend/app/rbac/permissions.py`:

```
catalog.create    catalog.update    catalog.delete
orders.create     orders.refund     orders.void
shifts.open       shifts.close
inventory.adjust
reports.view_all
users.manage
billing.view
billing.manage
settings.manage
```

## Role → Permission Mapping

| Permission | owner | manager | cashier | staff |
|---|---|---|---|---|
| catalog.create | ✓ | ✓ | | |
| catalog.update | ✓ | ✓ | | |
| catalog.delete | ✓ | ✓ | | |
| orders.create | ✓ | ✓ | ✓ | ✓ |
| orders.refund | ✓ | ✓ | | |
| orders.void | ✓ | ✓ | | |
| shifts.open | ✓ | ✓ | ✓ | |
| shifts.close | ✓ | ✓ | ✓ | |
| inventory.adjust | ✓ | ✓ | | |
| reports.view_all | ✓ | ✓ | | |
| users.manage | ✓ | | | |
| billing.view | ✓ | | | |
| billing.manage | ✓ | | | |
| settings.manage | ✓ | ✓ | | |

## Implementation

### Dependency

```python
require_permission("catalog.create")  # FastAPI dependency factory
```

Applied at the route level:

```python
@router.post("/products", dependencies=[Depends(require_permission("catalog.create"))])
```

The dependency:
1. Calls `get_current_user` to resolve user + membership.
2. Looks up role permissions in `ROLE_PERMISSIONS` dict.
3. Raises `403 Forbidden` if permission not present.
4. Does NOT hit the database (role-permission mapping is in-memory).

### No Inline Checks

Authorization logic must not live inside route handler bodies. All permission
checks go through `require_permission` or an equivalent dependency.

## Data Model Impact

Migration 0003 creates `roles`, `permissions`, `role_permissions` and seeds all
rows. These are reference tables, not tenant-scoped.

`memberships.role` is a VARCHAR(50) with CHECK(`role IN ('owner','manager','cashier','staff')`).

## API Impact

No new public endpoints. All future endpoints that mutate state must declare
their required permission via `require_permission`.

Sprint 0B provides the RBAC scaffolding only. The first real permission gate
is tested via the `/api/v1/me` endpoint (requires authenticated session) and
a demo write in tests.

## Audit Log Behavior

Permission denied events (403) are not logged to `audit_logs` in Sprint 0B.
Future hardening sprint may add security event logging.

## Test Requirements

- A user with `cashier` role attempting an action requiring `settings.manage` → 403.
- A user with `owner` role can perform the same action → 200.
- Tests must not inline role checks; they must go through the same dependency path.
