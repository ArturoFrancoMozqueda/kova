"""billing foundation

Revision ID: 0012_billing_foundation
Revises: 0011_inventory_basics
Create Date: 2026-05-09
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0012_billing_foundation"
down_revision: str | None = "0011_inventory_basics"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "subscriptions",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "tenant_id",
            sa.UUID(),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("stripe_customer_id", sa.String(255), nullable=True),
        sa.Column("stripe_subscription_id", sa.String(255), nullable=True),
        sa.Column("stripe_price_id", sa.String(255), nullable=True),
        sa.Column("latest_checkout_session_id", sa.String(255), nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="incomplete"),
        sa.Column("plan_name", sa.String(100), nullable=False, server_default="Standard Plan"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="MXN"),
        sa.Column("amount_minor_units", sa.Integer(), nullable=False, server_default="19900"),
        sa.Column("current_period_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("trial_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("past_due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("grace_period_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "cancel_at_period_end",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint(
            "status IN ('incomplete','trialing','active','past_due','canceled','unpaid')",
            name="ck_subscriptions_status",
        ),
        sa.CheckConstraint("amount_minor_units >= 0", name="ck_subscriptions_amount_non_negative"),
        sa.CheckConstraint("currency = upper(currency)", name="ck_subscriptions_currency_uppercase"),
        sa.UniqueConstraint("tenant_id", name="uq_subscriptions_tenant"),
        sa.UniqueConstraint("stripe_customer_id", name="uq_subscriptions_stripe_customer_id"),
        sa.UniqueConstraint(
            "stripe_subscription_id", name="uq_subscriptions_stripe_subscription_id"
        ),
    )
    op.create_index("ix_subscriptions_tenant_id", "subscriptions", ["tenant_id"])

    op.create_table(
        "webhook_events",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "tenant_id",
            sa.UUID(),
            sa.ForeignKey("tenants.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("stripe_event_id", sa.String(255), nullable=False),
        sa.Column("event_type", sa.String(120), nullable=False),
        sa.Column("processing_status", sa.String(30), nullable=False, server_default="received"),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("process_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_reason", sa.String(500), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint(
            "processing_status IN ('received','processed','ignored','failed')",
            name="ck_webhook_events_processing_status",
        ),
        sa.CheckConstraint(
            "process_attempts >= 0",
            name="ck_webhook_events_attempts_non_negative",
        ),
        sa.UniqueConstraint("stripe_event_id", name="uq_webhook_events_stripe_event_id"),
    )
    op.create_index("ix_webhook_events_tenant_id", "webhook_events", ["tenant_id"])

    for table_name in ("subscriptions", "webhook_events"):
        op.execute(f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table_name} "
            "USING (tenant_id = current_setting('app.tenant_id', true)::uuid)"
        )

    op.execute(sa.text("INSERT INTO permissions (name) VALUES ('billing.view')"))
    op.execute(
        sa.text(
            "INSERT INTO role_permissions (role_id, permission_id) "
            "SELECT r.id, p.id FROM roles r, permissions p "
            "WHERE r.name = 'owner' AND p.name = 'billing.view'"
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "DELETE FROM role_permissions "
            "WHERE permission_id IN (SELECT id FROM permissions WHERE name = 'billing.view')"
        )
    )
    op.execute(sa.text("DELETE FROM permissions WHERE name = 'billing.view'"))

    for table_name in ("webhook_events", "subscriptions"):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table_name}")
    op.drop_table("webhook_events")
    op.drop_table("subscriptions")
