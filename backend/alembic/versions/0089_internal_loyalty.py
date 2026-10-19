"""Append-only loyalty policy revisions and internal points ledger."""

import sqlalchemy as sa

from alembic import op

revision = "0089_internal_loyalty"
down_revision = "0088_appointments"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "loyalty_policy_revisions",
        sa.Column("id", sa.Uuid(), nullable=False, primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.Column("version", sa.Integer(), nullable=False, primary_key=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, primary_key=False),
        sa.Column(
            "spend_amount", sa.Numeric(precision=12, scale=2), nullable=False, primary_key=False
        ),
        sa.Column("points_per_step", sa.Integer(), nullable=False, primary_key=False),
        sa.Column("authorized_by_user_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.Column("effective_at", sa.DateTime(timezone=True), nullable=False, primary_key=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.CheckConstraint(
            "version >= 1 AND spend_amount >= .01 AND spend_amount <= 1000000 AND points_per_step BETWEEN 1 AND 10000",
            name="ck_loyalty_policy_bounds",
        ),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        sa.ForeignKeyConstraint(
            ["tenant_id", "authorized_by_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        sa.UniqueConstraint("tenant_id", "branch_id", "id", name="uq_loyalty_policy_owner"),
        sa.UniqueConstraint("tenant_id", "branch_id", "version", name="uq_loyalty_policy_version"),
    )
    op.create_index(
        "ix_loyalty_policy_revisions_tenant_id", "loyalty_policy_revisions", ["tenant_id"]
    )
    op.create_index(
        "ix_loyalty_policy_revisions_branch_id", "loyalty_policy_revisions", ["branch_id"]
    )
    op.create_table(
        "loyalty_entries",
        sa.Column("id", sa.Uuid(), nullable=False, primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.Column("sale_order_id", sa.Uuid(), nullable=True, primary_key=False),
        sa.Column("policy_revision_id", sa.Uuid(), nullable=True, primary_key=False),
        sa.Column("kind", sa.String(length=16), nullable=False, primary_key=False),
        sa.Column("source_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.Column("points", sa.BigInteger(), nullable=False, primary_key=False),
        sa.Column("benefit", sa.String(length=300), nullable=True, primary_key=False),
        sa.Column("recorded_by_user_id", sa.Uuid(), nullable=True, primary_key=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, primary_key=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.CheckConstraint(
            "kind IN ('accrual','refund','void','redemption')", name="ck_loyalty_entry_kind"
        ),
        sa.CheckConstraint(
            "(kind = 'accrual' AND points >= 0) OR (kind != 'accrual' AND points <= 0)",
            name="ck_loyalty_entry_sign",
        ),
        sa.CheckConstraint(
            "(kind = 'redemption' AND sale_order_id IS NULL AND policy_revision_id IS NULL AND benefit IS NOT NULL AND points < 0 AND recorded_by_user_id IS NOT NULL) OR (kind != 'redemption' AND sale_order_id IS NOT NULL AND policy_revision_id IS NOT NULL AND benefit IS NULL)",
            name="ck_loyalty_entry_source",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "policy_revision_id"],
            [
                "loyalty_policy_revisions.tenant_id",
                "loyalty_policy_revisions.branch_id",
                "loyalty_policy_revisions.id",
            ],
        ),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "sale_order_id"],
            ["orders.tenant_id", "orders.branch_id", "orders.id"],
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "recorded_by_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "customer_id"], ["customers.tenant_id", "customers.id"]
        ),
        sa.UniqueConstraint(
            "tenant_id", "branch_id", "kind", "source_id", name="uq_loyalty_effect"
        ),
    )
    op.create_index("ix_loyalty_entries_tenant_id", "loyalty_entries", ["tenant_id"])
    op.create_index("ix_loyalty_entries_branch_id", "loyalty_entries", ["branch_id"])
    op.create_index("ix_loyalty_entries_customer_id", "loyalty_entries", ["customer_id"])
    for table in ("loyalty_policy_revisions", "loyalty_entries"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} FOR ALL "
            "USING (tenant_id::text = current_setting('app.tenant_id', true)) "
            "WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))"
        )
        op.execute(f"REVOKE ALL ON {table} FROM PUBLIC")
        op.execute(f"""DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON {table} FROM anon; END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON {table} FROM authenticated; END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN REVOKE ALL ON {table} FROM service_role; END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN GRANT SELECT, INSERT ON {table} TO kova_app; END IF;
        END $$;""")
    op.create_index(
        "ix_loyalty_policy_effective",
        "loyalty_policy_revisions",
        ["tenant_id", "branch_id", "effective_at", "version"],
    )
    op.create_index(
        "ix_loyalty_ledger_account",
        "loyalty_entries",
        ["tenant_id", "branch_id", "customer_id", "created_at"],
    )
    op.create_index(
        "ix_loyalty_ledger_sale", "loyalty_entries", ["tenant_id", "branch_id", "sale_order_id"]
    )


def downgrade():
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM loyalty_entries) OR EXISTS (SELECT 1 FROM loyalty_policy_revisions)
        THEN RAISE EXCEPTION 'Cannot discard loyalty policy or points history'; END IF;
    END $$;""")
    op.drop_table("loyalty_entries")
    op.drop_table("loyalty_policy_revisions")
