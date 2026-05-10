"""clean up tenant RLS policies

Revision ID: 0013_rls_policy_cleanup
Revises: 0012_billing_foundation
Create Date: 2026-05-10
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0013_rls_policy_cleanup"
down_revision: str | None = "0012_billing_foundation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table_name in ("shifts", "cash_movements"):
        op.execute(f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table_name} "
            "USING (tenant_id = current_setting('app.tenant_id', true)::uuid)"
        )

    op.execute("ALTER TABLE refund_items ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON refund_items "
        "USING ("
        "EXISTS ("
        "SELECT 1 FROM refunds "
        "WHERE refunds.id = refund_items.refund_id "
        "AND refunds.tenant_id = current_setting('app.tenant_id', true)::uuid"
        ")"
        ")"
    )

    op.execute(
        """
        DO $$
        DECLARE
            role_name text;
        BEGIN
            IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
                REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
                FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
                LOOP
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
                        EXECUTE format(
                            'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM %I',
                            role_name
                        );
                    END IF;
                END LOOP;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON refund_items")
    for table_name in ("cash_movements", "shifts"):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table_name}")
