"""onboarding settings and employees

Revision ID: 0018_onboarding_employees
Revises: 0017_inventory_movement_history
Create Date: 2026-05-18
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0018_onboarding_employees"
down_revision: str | None = "0017_inventory_movement_history"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _tenant_policy(table_name: str) -> None:
    op.execute(f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY tenant_isolation ON {table_name} "
        "USING (tenant_id = current_setting('app.tenant_id', true)::uuid)"
    )


def upgrade() -> None:
    op.create_table(
        "tenant_business_profiles",
        sa.Column("tenant_id", sa.UUID(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("public_name", sa.String(255), nullable=False),
        sa.Column("support_email", sa.String(255), nullable=True),
        sa.Column("support_phone", sa.String(50), nullable=True),
        sa.Column("timezone", sa.String(80), nullable=False, server_default="America/Mexico_City"),
        sa.Column("locale", sa.String(20), nullable=False, server_default="es-MX"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="MXN"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_table(
        "tenant_receipt_settings",
        sa.Column("tenant_id", sa.UUID(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("receipt_business_name", sa.String(255), nullable=False),
        sa.Column("footer", sa.Text(), nullable=True),
        sa.Column("tax_contact_text", sa.Text(), nullable=True),
        sa.Column("logo_url", sa.String(1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_table(
        "tenant_onboarding_state",
        sa.Column("tenant_id", sa.UUID(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("business_profile_completed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("receipt_settings_completed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("first_product_completed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("inventory_completed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("shift_opened_completed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("first_sale_completed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("billing_completed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_table(
        "membership_invitations",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.UUID(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("role", sa.String(50), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending"),
        sa.Column("invited_by_user_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("role IN ('owner','manager','cashier')", name="ck_invitations_role"),
        sa.CheckConstraint("status IN ('pending','accepted','revoked')", name="ck_invitations_status"),
        sa.UniqueConstraint("tenant_id", "email", "status", name="uq_invitations_tenant_email_status"),
    )
    op.create_index("ix_membership_invitations_tenant_id", "membership_invitations", ["tenant_id"])

    for table_name in (
        "tenant_business_profiles",
        "tenant_receipt_settings",
        "tenant_onboarding_state",
        "membership_invitations",
    ):
        _tenant_policy(table_name)


def downgrade() -> None:
    for table_name in (
        "membership_invitations",
        "tenant_onboarding_state",
        "tenant_receipt_settings",
        "tenant_business_profiles",
    ):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table_name}")
    op.drop_index("ix_membership_invitations_tenant_id", table_name="membership_invitations")
    op.drop_table("membership_invitations")
    op.drop_table("tenant_onboarding_state")
    op.drop_table("tenant_receipt_settings")
    op.drop_table("tenant_business_profiles")
