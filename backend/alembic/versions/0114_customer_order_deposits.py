"""Deposits (anticipos) on customer orders and each business's deposit policy.

A deposit is money received before the order is settled. Cash deposits enter
the open shift's drawer when received; the sale is recorded once, when the
order is settled, and the deposit is applied to it as already collected
payments (`payments.deposit_applied`), so income is never counted twice.

`customer_order_deposits` is append-only: `deposit` receives money,
`refund` returns part of the balance and `retained` keeps the balance of a
cancelled order when the business policy allows it.
`customer_order_settings` holds the business's minimum deposit to confirm and
whether a cancelled order's deposit is returned or may be kept.

Additive for the previous app version: no settings row means no minimum and
returning deposits, `deposit_applied` defaults to false, and an older app never
writes deposits. Downgrade is refused once deposits exist.
"""

import sqlalchemy as sa

from alembic import op

revision = "0114_customer_order_deposits"
down_revision = "0113_receiving_differences"
branch_labels = None
depends_on = None

_TABLES = ("customer_order_settings", "customer_order_deposits")


def _secure(table: str, grants: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"""CREATE POLICY tenant_isolation ON {table} FOR ALL
        USING (tenant_id::text = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))""")
    op.execute(f"REVOKE ALL ON {table} FROM PUBLIC")
    for role in ("anon", "authenticated", "service_role"):
        op.execute(f"""DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{role}') THEN
                REVOKE ALL ON {table} FROM {role};
            END IF;
        END $$""")
    op.execute(f"""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN
            {grants}
        END IF;
    END $$""")


def upgrade():
    op.create_table(
        "customer_order_settings",
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  primary_key=True),
        sa.Column("deposit_minimum_percent", sa.Numeric(5, 2), nullable=False,
                  server_default="0"),
        sa.Column("cancelled_deposit_policy", sa.String(16), nullable=False,
                  server_default="refund"),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.CheckConstraint("deposit_minimum_percent >= 0 AND deposit_minimum_percent <= 100",
                           name="ck_customer_order_settings_minimum"),
        sa.CheckConstraint("cancelled_deposit_policy IN ('refund', 'retain')",
                           name="ck_customer_order_settings_policy"),
    )
    _secure(
        "customer_order_settings",
        "GRANT SELECT, INSERT ON customer_order_settings TO kova_app; "
        "GRANT UPDATE (deposit_minimum_percent, cancelled_deposit_policy, updated_by_user_id, "
        "updated_at) ON customer_order_settings TO kova_app;",
    )

    op.create_table(
        "customer_order_deposits",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("branch_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("customer_order_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("method", sa.String(20), nullable=True),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("reference", sa.String(255), nullable=True),
        sa.Column("reason", sa.String(200), nullable=True),
        sa.Column("shift_id", sa.Uuid(), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"],
                                name="fk_customer_order_deposits_branch"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "customer_order_id"],
            ["customer_orders.tenant_id", "customer_orders.branch_id", "customer_orders.id"],
            name="fk_customer_order_deposits_order",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "shift_id"],
            ["shifts.tenant_id", "shifts.branch_id", "shifts.id"],
            name="fk_customer_order_deposits_shift",
        ),
        sa.CheckConstraint("kind IN ('deposit', 'refund', 'retained')",
                           name="ck_customer_order_deposits_kind"),
        sa.CheckConstraint("amount > 0", name="ck_customer_order_deposits_amount"),
        # Money moves by a payment method; a retained balance moves nothing.
        sa.CheckConstraint(
            "(kind = 'retained' AND method IS NULL AND shift_id IS NULL) OR "
            "(kind <> 'retained' AND method IS NOT NULL "
            "AND method IN ('cash', 'bank_transfer', 'manual_card'))",
            name="ck_customer_order_deposits_method",
        ),
        sa.CheckConstraint("method IS DISTINCT FROM 'cash' OR shift_id IS NOT NULL",
                           name="ck_customer_order_deposits_cash_shift"),
        sa.CheckConstraint(
            "kind = 'deposit' OR coalesce(length(btrim(reason)), 0) > 0",
            name="ck_customer_order_deposits_reason",
        ),
    )
    op.create_index("ix_customer_order_deposits_order", "customer_order_deposits",
                    ["tenant_id", "customer_order_id"])
    _secure("customer_order_deposits",
            "GRANT SELECT, INSERT ON customer_order_deposits TO kova_app;")

    op.add_column("payments", sa.Column("deposit_applied", sa.Boolean(), nullable=False,
                                        server_default=sa.false()))


def downgrade():
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM customer_order_deposits) "
        "OR EXISTS (SELECT 1 FROM payments WHERE deposit_applied) "
        "THEN RAISE EXCEPTION 'Cannot downgrade recorded customer order deposits'; "
        "END IF; END $$;"
    )
    op.drop_column("payments", "deposit_applied")
    op.drop_index("ix_customer_order_deposits_order", table_name="customer_order_deposits")
    for table in reversed(_TABLES):
        op.drop_table(table)
