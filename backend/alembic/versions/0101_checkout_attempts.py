"""Keep one durable, tenant-owned Stripe Checkout attempt across HTTP failures."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0101_checkout_attempts"
down_revision = "0100_commercial_plans"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "billing_checkout_attempts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("request_payload", sa.JSON(), nullable=False),
        sa.Column("credential_fingerprint", sa.String(64), nullable=False),
        sa.Column("billing_cohort", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="uncertain"),
        sa.Column("stripe_session_id", sa.String(255), nullable=True),
        sa.Column("stripe_session_url", sa.String(2048), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", name="uq_billing_checkout_attempts_tenant"),
        sa.CheckConstraint("billing_cohort IN ('standard','tiered')",
                           name="ck_checkout_attempts_cohort"),
        sa.CheckConstraint("status IN ('uncertain','open','complete','expired')",
                           name="ck_checkout_attempts_status"),
        sa.CheckConstraint("status = 'uncertain' OR stripe_session_id IS NOT NULL",
                           name="ck_checkout_attempts_session"),
    )
    op.execute("ALTER TABLE billing_checkout_attempts ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE billing_checkout_attempts FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON billing_checkout_attempts FOR ALL
        USING (tenant_id::text = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))
    """)
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
                GRANT SELECT, INSERT, UPDATE ON billing_checkout_attempts TO kova_app;
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM billing_checkout_attempts WHERE status <> 'expired') THEN
                RAISE EXCEPTION 'Resolve billable or uncertain Checkout attempts before downgrade';
            END IF;
        END $$;
    """)
    op.drop_table("billing_checkout_attempts")
