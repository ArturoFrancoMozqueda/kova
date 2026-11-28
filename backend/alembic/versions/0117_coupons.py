"""Coupons: a code with validity, minimum purchase and use limits, and each use.

A coupon gives a percentage or an amount off the whole sale. The server checks
the code, dates, minimum and limits and computes the discount at checkout; a
sale carries one discount only (coupon, loyalty reward or manual). Each use is
a `coupon_redemptions` row linked to its sale; voiding the sale releases it.

Additive for the previous app version, which never reads these tables.
Downgrade is refused once a coupon was used.
"""

import sqlalchemy as sa

from alembic import op

revision = "0117_coupons"
down_revision = "0116_split_bill"
branch_labels = None
depends_on = None


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
        "coupons",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  nullable=False, index=True),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("description", sa.String(160), nullable=True),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("value", sa.Numeric(12, 2), nullable=False),
        sa.Column("min_purchase", sa.Numeric(12, 2), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column("max_uses_per_customer", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "id", name="uq_coupons_tenant_id"),
        sa.UniqueConstraint("tenant_id", "code", name="uq_coupons_tenant_code"),
        sa.CheckConstraint("code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'", name="ck_coupons_code"),
        sa.CheckConstraint(
            "(kind = 'percent' AND value > 0 AND value <= 100) OR (kind = 'amount' AND value > 0)",
            name="ck_coupons_value",
        ),
        sa.CheckConstraint("min_purchase IS NULL OR min_purchase >= 0", name="ck_coupons_min"),
        sa.CheckConstraint("ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at",
                           name="ck_coupons_window"),
        sa.CheckConstraint("max_uses IS NULL OR max_uses > 0", name="ck_coupons_max_uses"),
        sa.CheckConstraint("max_uses_per_customer IS NULL OR max_uses_per_customer > 0",
                           name="ck_coupons_max_per_customer"),
    )
    _secure(
        "coupons",
        "GRANT SELECT, INSERT ON coupons TO kova_app; "
        "GRANT UPDATE (description, value, min_purchase, starts_at, ends_at, max_uses, "
        "max_uses_per_customer, is_active, version, updated_at) ON coupons TO kova_app;",
    )

    op.create_table(
        "coupon_redemptions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("branch_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("coupon_id", sa.Uuid(), nullable=False),
        sa.Column("sale_order_id", sa.Uuid(), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=True),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("discount_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="applied"),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"],
                                name="fk_coupon_redemptions_branch"),
        sa.ForeignKeyConstraint(["tenant_id", "coupon_id"], ["coupons.tenant_id", "coupons.id"],
                                name="fk_coupon_redemptions_coupon"),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id", "sale_order_id"],
                                ["orders.tenant_id", "orders.branch_id", "orders.id"],
                                name="fk_coupon_redemptions_sale"),
        sa.UniqueConstraint("sale_order_id", name="uq_coupon_redemptions_sale"),
        sa.CheckConstraint("status IN ('applied', 'released')", name="ck_coupon_redemptions_status"),
        sa.CheckConstraint("discount_amount > 0", name="ck_coupon_redemptions_amount"),
    )
    op.create_index("ix_coupon_redemptions_coupon", "coupon_redemptions",
                    ["tenant_id", "coupon_id", "status"])
    _secure(
        "coupon_redemptions",
        "GRANT SELECT, INSERT ON coupon_redemptions TO kova_app; "
        "GRANT UPDATE (status, released_at) ON coupon_redemptions TO kova_app;",
    )


def downgrade():
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM coupon_redemptions) "
        "THEN RAISE EXCEPTION 'Cannot downgrade recorded coupon uses'; "
        "END IF; END $$;"
    )
    op.drop_index("ix_coupon_redemptions_coupon", table_name="coupon_redemptions")
    op.drop_table("coupon_redemptions")
    op.drop_table("coupons")
