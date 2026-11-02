"""Persist commercial cohorts and paid plan entitlements without changing agreements."""

import sqlalchemy as sa

from alembic import op

revision = "0100_commercial_plans"
down_revision = "0099_complimentary_access"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column(
        "loyalty_eligible", sa.Boolean(), nullable=False, server_default=sa.true(),
    ))
    op.add_column("tenants", sa.Column(
        "billing_cohort", sa.String(20), nullable=False, server_default="standard",
    ))
    op.create_check_constraint("ck_tenants_billing_cohort", "tenants",
                               "billing_cohort IN ('standard','tiered')")
    op.add_column("subscriptions", sa.Column(
        "plan_code", sa.String(20), nullable=False, server_default="standard",
    ))
    op.add_column("subscriptions", sa.Column(
        "plan_effective_until", sa.DateTime(timezone=True), nullable=True,
    ))
    op.create_check_constraint(
        "ck_subscriptions_plan_code", "subscriptions",
        "plan_code IN ('standard','esencial','gestion','unknown')",
    )


def downgrade() -> None:
    # A schema rollback must not silently convert a paid tiered contract to Standard.
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM tenants WHERE billing_cohort <> 'standard')
               OR EXISTS (SELECT 1 FROM subscriptions WHERE plan_code <> 'standard') THEN
                RAISE EXCEPTION 'Resolve commercial plan agreements before removing plan columns';
            END IF;
        END $$;
    """)
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM orders WHERE NOT loyalty_eligible) THEN
                RAISE EXCEPTION 'Preserve loyalty eligibility history before removing its column';
            END IF;
        END $$;
    """)
    op.drop_column("orders", "loyalty_eligible")
    op.drop_constraint("ck_subscriptions_plan_code", "subscriptions", type_="check")
    op.drop_column("subscriptions", "plan_effective_until")
    op.drop_column("subscriptions", "plan_code")
    op.drop_constraint("ck_tenants_billing_cohort", "tenants", type_="check")
    op.drop_column("tenants", "billing_cohort")
