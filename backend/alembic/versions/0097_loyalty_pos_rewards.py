"""Explicit, append-only loyalty rewards delivered through a financial sale."""

import sqlalchemy as sa

from alembic import op

revision = "0097_loyalty_pos_rewards"
down_revision = "0096_catalog_order_intake"
branch_labels = None
depends_on = None


def _ledger_constraints(extended):
    for name in ("ck_loyalty_entry_kind", "ck_loyalty_entry_sign", "ck_loyalty_entry_source"):
        op.drop_constraint(name, "loyalty_entries", type_="check")
    op.create_check_constraint(
        "ck_loyalty_entry_kind", "loyalty_entries",
        "kind IN ('accrual','refund','void','redemption','reward_return')" if extended
        else "kind IN ('accrual','refund','void','redemption')",
    )
    op.create_check_constraint(
        "ck_loyalty_entry_sign", "loyalty_entries",
        "(kind = 'accrual' AND points >= 0) OR (kind = 'reward_return' AND points > 0) OR "
        "(kind IN ('refund','void','redemption') AND points <= 0)" if extended
        else "(kind = 'accrual' AND points >= 0) OR (kind != 'accrual' AND points <= 0)",
    )
    manual = "(kind = 'redemption' AND sale_order_id IS NULL AND policy_revision_id IS NULL "
    manual += "AND benefit IS NOT NULL AND points < 0 AND recorded_by_user_id IS NOT NULL) OR "
    op.create_check_constraint(
        "ck_loyalty_entry_source", "loyalty_entries", manual + (
            "(kind = 'reward_return' AND sale_order_id IS NOT NULL AND policy_revision_id IS NULL "
            "AND benefit IS NOT NULL AND recorded_by_user_id IS NOT NULL) OR "
            "(kind IN ('accrual','refund','void') AND sale_order_id IS NOT NULL "
            "AND policy_revision_id IS NOT NULL AND benefit IS NULL)" if extended else
            "(kind != 'redemption' AND sale_order_id IS NOT NULL "
            "AND policy_revision_id IS NOT NULL AND benefit IS NULL)"
        ),
    )


def upgrade():
    _ledger_constraints(True)
    op.create_unique_constraint(
        "uq_loyalty_entry_owner", "loyalty_entries", ["tenant_id", "branch_id", "id"],
    )
    op.create_table(
        "loyalty_reward_revisions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("points_cost", sa.BigInteger(), nullable=False),
        sa.Column("discount_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("authorized_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("effective_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "version >= 1 AND points_cost BETWEEN 1 AND 1000000000 "
            "AND discount_amount BETWEEN .01 AND 1000000 AND length(trim(title)) > 0",
            name="ck_loyalty_reward_bounds",
        ),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        sa.ForeignKeyConstraint(
            ["tenant_id", "authorized_by_user_id"], ["memberships.tenant_id", "memberships.user_id"],
        ),
        sa.UniqueConstraint("tenant_id", "branch_id", "id", name="uq_loyalty_reward_owner"),
        sa.UniqueConstraint("tenant_id", "branch_id", "version", name="uq_loyalty_reward_version"),
    )
    op.create_table(
        "loyalty_reward_redemptions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("sale_order_id", sa.Uuid(), nullable=False),
        sa.Column("reward_revision_id", sa.Uuid(), nullable=False),
        sa.Column("ledger_entry_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("points_cost", sa.BigInteger(), nullable=False),
        sa.Column("discount_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "points_cost BETWEEN 1 AND 1000000000 AND discount_amount BETWEEN .01 AND 1000000",
            name="ck_loyalty_reward_redemption_bounds",
        ),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        sa.ForeignKeyConstraint(["tenant_id", "customer_id"], ["customers.tenant_id", "customers.id"]),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "sale_order_id"],
            ["orders.tenant_id", "orders.branch_id", "orders.id"],
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "reward_revision_id"],
            ["loyalty_reward_revisions.tenant_id", "loyalty_reward_revisions.branch_id", "loyalty_reward_revisions.id"],
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "ledger_entry_id"],
            ["loyalty_entries.tenant_id", "loyalty_entries.branch_id", "loyalty_entries.id"],
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "created_by_user_id"], ["memberships.tenant_id", "memberships.user_id"],
        ),
        sa.UniqueConstraint("tenant_id", "branch_id", "sale_order_id", name="uq_loyalty_reward_sale"),
        sa.UniqueConstraint("ledger_entry_id", name="uq_loyalty_reward_debit"),
    )
    for table in ("loyalty_reward_revisions", "loyalty_reward_redemptions"):
        op.create_index(f"ix_{table}_tenant_id", table, ["tenant_id"])
        op.create_index(f"ix_{table}_branch_id", table, ["branch_id"])
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} FOR ALL "
            "USING (tenant_id::text = current_setting('app.tenant_id', true)) "
            "WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))"
        )
        op.execute(f"REVOKE ALL ON {table} FROM PUBLIC")
        op.execute(f"""DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON {table} FROM anon; END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON {table} FROM authenticated; END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN REVOKE ALL ON {table} FROM service_role; END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN GRANT SELECT,INSERT ON {table} TO kova_app; END IF;
        END $$;""")


def downgrade():
    op.execute("""DO $$ BEGIN
        IF EXISTS(SELECT 1 FROM loyalty_reward_redemptions)
           OR EXISTS(SELECT 1 FROM loyalty_reward_revisions)
           OR EXISTS(SELECT 1 FROM loyalty_entries WHERE kind='reward_return')
        THEN RAISE EXCEPTION 'Cannot discard POS loyalty rewards history'; END IF;
    END $$;""")
    op.drop_table("loyalty_reward_redemptions")
    op.drop_table("loyalty_reward_revisions")
    op.drop_constraint("uq_loyalty_entry_owner", "loyalty_entries", type_="unique")
    _ledger_constraints(False)
