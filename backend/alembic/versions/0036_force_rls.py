"""force row level security + add WITH CHECK to write-capable tenant policies

Revision ID: 0036_force_rls
Revises: 0035_sub_period_sync
Create Date: 2026-07-08

PLAN-02 (tenant-isolation defense-in-depth). Two changes, both idempotent-shaped:

1. FORCE ROW LEVEL SECURITY on every tenant-scoped table. Without FORCE, the
   table owner bypasses RLS; with it, even an accidental owner connection is
   subject to tenant_isolation. (Superusers / BYPASSRLS roles still bypass — the
   runtime `kova_app` role is neither.)

2. Give write-capable policies a WITH CHECK clause. USING alone constrains reads
   (and the rows an UPDATE/DELETE may target) but NOT the tenant_id a row is
   written with, so a mismatched INSERT/UPDATE could otherwise plant a row into
   another tenant. WITH CHECK closes that.

`membership_invitations` had its tenant policy dropped in 0027 for the
unauthenticated accept flow, leaving RLS enabled with NO policy — which denies
everything for the non-owner runtime role. We restore a standard tenant policy
here (authenticated list/create/revoke run with tenant context) and route the
two unauthenticated paths (preview/accept) through the privileged engine.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0036_force_rls"
down_revision: str | None = "0035_sub_period_sync"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TENANT_QUAL = "tenant_id = current_setting('app.tenant_id', true)::uuid"

_REFUND_ITEMS_QUAL = (
    "EXISTS (SELECT 1 FROM refunds "
    "WHERE refunds.id = refund_items.refund_id "
    "AND refunds.tenant_id = current_setting('app.tenant_id', true)::uuid)"
)

# USING-only policies with the standard direct-column qual. Recreated with both
# USING and WITH CHECK using the same expression.
_STANDARD_USING_ONLY = (
    "cash_movements",
    "categories",
    "idempotency_keys",
    "inventory_movements",
    "memberships",
    "order_items",
    "orders",
    "payments",
    "products",
    "refunds",
    "sessions",
    "shifts",
    "subscriptions",
    "tenant_business_profiles",
    "tenant_onboarding_state",
    "tenant_receipt_settings",
    "voids",
    "webhook_events",
)

# Policies that already carry a WITH CHECK clause — only need FORCE, no rewrite.
_ALREADY_HAS_CHECK = (
    "audit_logs",
    "modifier_groups",
    "modifier_options",
    "order_item_modifiers",
    "product_image_files",
    "product_modifier_groups",
    "telemetry_events",
    "tenant_logo_files",
)

# Every tenant-scoped table that has RLS enabled → gets FORCE.
_ALL_TENANT_TABLES = (
    *_STANDARD_USING_ONLY,
    *_ALREADY_HAS_CHECK,
    "refund_items",
    "membership_invitations",
)


def upgrade() -> None:
    # 1. Restore a tenant policy on membership_invitations (dropped in 0027).
    op.execute(
        f"CREATE POLICY tenant_isolation ON membership_invitations "
        f"USING ({_TENANT_QUAL}) WITH CHECK ({_TENANT_QUAL})"
    )

    # 2. Add WITH CHECK to the standard USING-only policies.
    for table in _STANDARD_USING_ONLY:
        op.execute(f"DROP POLICY tenant_isolation ON {table}")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            f"USING ({_TENANT_QUAL}) WITH CHECK ({_TENANT_QUAL})"
        )

    # 3. refund_items uses an EXISTS(refunds) qual — mirror it in WITH CHECK.
    op.execute("DROP POLICY tenant_isolation ON refund_items")
    op.execute(
        f"CREATE POLICY tenant_isolation ON refund_items "
        f"USING ({_REFUND_ITEMS_QUAL}) WITH CHECK ({_REFUND_ITEMS_QUAL})"
    )

    # 4. FORCE RLS everywhere.
    for table in _ALL_TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")


def downgrade() -> None:
    for table in _ALL_TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")

    # Revert the standard policies back to USING-only.
    for table in _STANDARD_USING_ONLY:
        op.execute(f"DROP POLICY tenant_isolation ON {table}")
        op.execute(f"CREATE POLICY tenant_isolation ON {table} USING ({_TENANT_QUAL})")

    op.execute("DROP POLICY tenant_isolation ON refund_items")
    op.execute(
        f"CREATE POLICY tenant_isolation ON refund_items USING ({_REFUND_ITEMS_QUAL})"
    )

    # membership_invitations had no policy before this migration.
    op.execute("DROP POLICY tenant_isolation ON membership_invitations")
