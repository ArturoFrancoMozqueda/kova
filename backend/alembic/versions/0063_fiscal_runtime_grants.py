"""reconcile least-privilege grants for immutable fiscal history

Revision ID: 0063_fiscal_runtime_grants
Revises: 0062_accountant_packages
Create Date: 2026-09-06
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0063_fiscal_runtime_grants"
down_revision: str | None = "0062_accountant_packages"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_FISCAL_RUNTIME_TABLES = (
    "order_fiscal_snapshots",
    "order_item_fiscal_snapshots",
    "order_item_tax_snapshots",
    "fiscal_global_draft_settings",
    "fiscal_global_draft_batches",
    "fiscal_global_draft_orders",
    "fiscal_individual_invoice_events",
    "fiscal_global_draft_adjustments",
)


def upgrade() -> None:
    tables = ", ".join(_FISCAL_RUNTIME_TABLES)
    immutable_insert_tables = ", ".join(
        table for table in _FISCAL_RUNTIME_TABLES if table != "fiscal_global_draft_settings"
    )
    op.execute(
        f"""
        DO $$
        DECLARE role_name text;
        BEGIN
          FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
              EXECUTE format('REVOKE ALL ON TABLE {tables} FROM %I', role_name);
            END IF;
          END LOOP;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
            REVOKE ALL ON TABLE {tables} FROM kova_app;
            GRANT SELECT, INSERT ON {immutable_insert_tables} TO kova_app;
            GRANT SELECT, INSERT, UPDATE ON fiscal_global_draft_settings TO kova_app;
            GRANT UPDATE (id) ON order_fiscal_snapshots TO kova_app;
            GRANT UPDATE (id) ON fiscal_global_draft_batches TO kova_app;
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # Grants before this migration depended on provisioning order and owner
    # defaults. A downgrade must not recreate those broad, unsafe privileges.
    pass
