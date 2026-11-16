"""Add immutable per-method refund allocations; keep legacy refunds readable."""

import sqlalchemy as sa

from alembic import op

revision = "0108_refund_payments"
down_revision = "0107_reservation_notices"
branch_labels = None
depends_on = None


def upgrade():
    op.create_unique_constraint(
        "uq_refunds_tenant_branch_id", "refunds", ["tenant_id", "branch_id", "id"]
    )
    op.create_table(
        "refund_payments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("branch_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("refund_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("method", sa.String(20), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "refund_id"],
            ["refunds.tenant_id", "refunds.branch_id", "refunds.id"],
            name="fk_refund_payments_refund",
        ),
        sa.UniqueConstraint("refund_id", "method", name="uq_refund_payments_method"),
        sa.CheckConstraint("amount > 0", name="ck_refund_payments_amount"),
        sa.CheckConstraint(
            "method IN ('cash', 'bank_transfer', 'manual_card')",
            name="ck_refund_payments_method",
        ),
    )
    op.execute("ALTER TABLE refund_payments ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE refund_payments FORCE ROW LEVEL SECURITY")
    op.execute("""CREATE POLICY tenant_isolation ON refund_payments FOR ALL
        USING (tenant_id::text = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))""")
    op.execute("REVOKE ALL ON refund_payments FROM PUBLIC")
    for role in ("anon", "authenticated", "service_role"):
        op.execute(f"""DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{role}') THEN
                REVOKE ALL ON refund_payments FROM {role};
            END IF;
        END $$""")
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN
            GRANT SELECT, INSERT ON refund_payments TO kova_app;
        END IF;
    END $$""")
    # Older app versions do not understand allocations. Keep their legacy
    # writes safe after an app rollback: commit must still respect every tender
    # ceiling, including mixed refunds already recorded by the newer version.
    op.execute("""CREATE FUNCTION check_refund_payment_totals() RETURNS trigger
        LANGUAGE plpgsql AS $$
        DECLARE owner_tenant uuid; owner_order uuid; target_refund uuid;
        BEGIN
            owner_tenant := NEW.tenant_id;
            IF TG_TABLE_NAME = 'refunds' THEN target_refund := NEW.id;
            ELSE target_refund := NEW.refund_id; END IF;
            SELECT order_id INTO owner_order FROM refunds
                WHERE tenant_id = owner_tenant AND id = target_refund;
            IF owner_order IS NULL THEN RETURN NULL; END IF;
            IF NOT EXISTS (SELECT 1 FROM refund_payments p JOIN refunds r
                ON r.tenant_id=p.tenant_id AND r.id=p.refund_id
                WHERE r.tenant_id=owner_tenant AND r.order_id=owner_order)
                THEN RETURN NULL; END IF;
            PERFORM id FROM orders WHERE tenant_id=owner_tenant AND id=owner_order FOR UPDATE;
            IF EXISTS (
                SELECT 1 FROM refunds r JOIN refund_payments p
                    ON p.tenant_id=r.tenant_id AND p.refund_id=r.id
                WHERE r.tenant_id=owner_tenant AND r.order_id=owner_order
                GROUP BY r.id, r.refunded_amount
                HAVING sum(p.amount) <> r.refunded_amount
            ) THEN
                RAISE EXCEPTION 'Refund allocations must equal the refund total'
                    USING ERRCODE='23514';
            END IF;
            IF EXISTS (
                SELECT returned.method FROM (
                    SELECT p.method,p.amount FROM refund_payments p JOIN refunds r
                        ON r.tenant_id=p.tenant_id AND r.id=p.refund_id
                        WHERE r.tenant_id=owner_tenant AND r.order_id=owner_order
                    UNION ALL
                    SELECT r.refund_payment_method,r.refunded_amount FROM refunds r
                        WHERE r.tenant_id=owner_tenant AND r.order_id=owner_order
                        AND r.refund_payment_method IS NOT NULL
                        AND NOT EXISTS (SELECT 1 FROM refund_payments p
                            WHERE p.tenant_id=r.tenant_id AND p.refund_id=r.id)
                ) returned
                GROUP BY returned.method
                HAVING sum(returned.amount) > COALESCE((
                    SELECT sum(p.amount_amount) FROM payments p
                    WHERE p.tenant_id=owner_tenant AND p.order_id=owner_order
                    AND p.method=returned.method
                ),0)
            ) THEN
                RAISE EXCEPTION 'Refund exceeds the amount collected for its method'
                    USING ERRCODE='23514';
            END IF;
            RETURN NULL;
        END $$""")
    for table in ("refunds", "refund_payments"):
        op.execute(f"""CREATE CONSTRAINT TRIGGER check_{table}_payment_totals
            AFTER INSERT ON {table} DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW EXECUTE FUNCTION check_refund_payment_totals()""")


def downgrade():
    # A schema downgrade is not an app rollback. Never discard the only record
    # of how a mixed refund was returned; single-method redundant rows are safe.
    op.execute("""DO $$ BEGIN
        IF EXISTS (
            SELECT 1 FROM refund_payments p JOIN refunds r
                ON r.tenant_id=p.tenant_id AND r.id=p.refund_id
            WHERE r.refund_payment_method IS DISTINCT FROM p.method
               OR r.refunded_amount <> p.amount
        ) THEN
            RAISE EXCEPTION 'Retain mixed refund payment history before downgrade';
        END IF;
    END $$""")
    op.execute("DROP TRIGGER check_refunds_payment_totals ON refunds")
    op.drop_table("refund_payments")
    op.execute("DROP FUNCTION check_refund_payment_totals()")
    op.drop_constraint("uq_refunds_tenant_branch_id", "refunds")
