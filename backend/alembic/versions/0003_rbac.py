"""rbac roles permissions and seed data

Revision ID: 0003_rbac
Revises: 0002_tenants_users_memberships
Create Date: 2026-05-08
"""
import uuid
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003_rbac"
down_revision: str | None = "0002_tenants_users_memberships"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ROLES = ["owner", "manager", "cashier", "staff"]

_PERMISSIONS = [
    "catalog.create", "catalog.update", "catalog.delete",
    "orders.create", "orders.refund", "orders.void",
    "shifts.open", "shifts.close",
    "inventory.adjust",
    "reports.view_all",
    "users.manage",
    "billing.manage",
    "settings.manage",
]

_ROLE_PERMISSIONS: dict[str, list[str]] = {
    "owner": _PERMISSIONS,
    "manager": [
        "catalog.create", "catalog.update", "catalog.delete",
        "orders.create", "orders.refund", "orders.void",
        "shifts.open", "shifts.close",
        "inventory.adjust",
        "reports.view_all",
        "settings.manage",
    ],
    "cashier": ["orders.create", "shifts.open", "shifts.close"],
    "staff": ["orders.create"],
}


def upgrade() -> None:
    op.create_table(
        "roles",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(50), nullable=False),
        sa.UniqueConstraint("name", name="uq_roles_name"),
    )

    op.create_table(
        "permissions",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(100), nullable=False),
        sa.UniqueConstraint("name", name="uq_permissions_name"),
    )

    op.create_table(
        "role_permissions",
        sa.Column("role_id", sa.UUID(), sa.ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("permission_id", sa.UUID(), sa.ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True),
    )

    # Seed roles
    roles_table = sa.table("roles", sa.column("id", sa.UUID()), sa.column("name", sa.String()))
    op.bulk_insert(roles_table, [{"id": uuid.uuid4(), "name": r} for r in _ROLES])

    # Seed permissions
    permissions_table = sa.table("permissions", sa.column("id", sa.UUID()), sa.column("name", sa.String()))
    op.bulk_insert(permissions_table, [{"id": uuid.uuid4(), "name": p} for p in _PERMISSIONS])

    # Seed role_permissions via raw SQL to resolve FKs
    for role_name, perm_names in _ROLE_PERMISSIONS.items():
        for perm_name in perm_names:
            op.execute(
                sa.text(
                    "INSERT INTO role_permissions (role_id, permission_id) "
                    "SELECT r.id, p.id FROM roles r, permissions p "
                    "WHERE r.name = :role AND p.name = :perm"
                ).bindparams(role=role_name, perm=perm_name)
            )


def downgrade() -> None:
    op.drop_table("role_permissions")
    op.drop_table("permissions")
    op.drop_table("roles")
