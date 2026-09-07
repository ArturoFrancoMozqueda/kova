"""reduce the runtime role to verbs exercised by tenant request paths

Revision ID: 0067_runtime_grant_matrix
Revises: 0066_tenant_profile_update
Create Date: 2026-09-07
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0067_runtime_grant_matrix"
down_revision: str | None = "0066_tenant_profile_update"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_REVOKES = {
    "DELETE": (
        "account_deletion_requests",
        "categories",
        "customer_orders",
        "inventory_reservations",
        "membership_invitations",
        "modifier_groups",
        "modifier_options",
        "products",
        "tenant_business_profiles",
        "tenant_onboarding_state",
        "tenant_receipt_settings",
    ),
    "UPDATE": (
        "customer_order_item_modifiers",
        "customer_order_items",
        "product_modifier_groups",
    ),
    "INSERT": ("memberships", "sessions"),
    "SELECT": ("audit_logs", "telemetry_events"),
}


def _change_privileges(action: str, matrix: dict[str, tuple[str, ...]]) -> None:
    for privilege, tables in matrix.items():
        table_list = ", ".join(tables)
        op.execute(
            f"""
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
                    {action} {privilege} ON TABLE {table_list}
                    {'FROM' if action == 'REVOKE' else 'TO'} kova_app;
                END IF;
            END
            $$
            """
        )


def upgrade() -> None:
    _change_privileges("REVOKE", _REVOKES)


def downgrade() -> None:
    _change_privileges("GRANT", _REVOKES)
