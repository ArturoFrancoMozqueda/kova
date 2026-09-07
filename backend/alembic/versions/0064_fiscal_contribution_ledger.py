"""reconcile late fiscal contributions by immutable order balance

Revision ID: 0064_fiscal_contribution
Revises: 0063_fiscal_runtime_grants
Create Date: 2026-09-07
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0064_fiscal_contribution"
down_revision: str | None = "0063_fiscal_runtime_grants"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(
        "ck_fiscal_adjustment_amount",
        "fiscal_global_draft_adjustments",
        type_="check",
    )
    op.drop_constraint(
        "ck_fiscal_adjustment_type",
        "fiscal_global_draft_adjustments",
        type_="check",
    )
    op.drop_constraint(
        "ck_fiscal_adjustment_source",
        "fiscal_global_draft_adjustments",
        type_="check",
    )
    op.create_check_constraint(
        "ck_fiscal_adjustment_amount",
        "fiscal_global_draft_adjustments",
        "amount >= 0",
    )
    op.create_check_constraint(
        "ck_fiscal_adjustment_type",
        "fiscal_global_draft_adjustments",
        "adjustment_type IN "
        "('late_refund', 'late_inclusion', 'late_exclusion', 'late_void')",
    )
    op.create_check_constraint(
        "ck_fiscal_adjustment_source",
        "fiscal_global_draft_adjustments",
        "(adjustment_type = 'late_refund' AND source_refund_id IS NOT NULL "
        "AND source_event_id IS NULL) OR "
        "(adjustment_type IN ('late_inclusion', 'late_exclusion') "
        "AND source_refund_id IS NULL AND source_event_id IS NOT NULL) OR "
        "(adjustment_type IN ('late_inclusion', 'late_void') "
        "AND source_refund_id IS NULL AND source_event_id IS NULL)",
    )
    op.create_index(
        "uq_fiscal_adjustment_tenant_late_order",
        "fiscal_global_draft_adjustments",
        ["tenant_id", "order_id"],
        unique=True,
        postgresql_where=(
            "adjustment_type = 'late_inclusion' "
            "AND source_refund_id IS NULL AND source_event_id IS NULL"
        ),
    )
    op.create_index(
        "uq_fiscal_adjustment_tenant_void",
        "fiscal_global_draft_adjustments",
        ["tenant_id", "order_id"],
        unique=True,
        postgresql_where=(
            "adjustment_type = 'late_void' "
            "AND source_refund_id IS NULL AND source_event_id IS NULL"
        ),
    )


def downgrade() -> None:
    # Old constraints cannot represent the new immutable ledger rows. Refuse a
    # lossy downgrade once production data uses the expanded event vocabulary.
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM fiscal_global_draft_adjustments
            WHERE amount = 0 OR adjustment_type = 'late_void'
              OR (adjustment_type = 'late_inclusion'
                  AND source_refund_id IS NULL AND source_event_id IS NULL)
          ) THEN
            RAISE EXCEPTION
              '0064 downgrade would discard fiscal contribution semantics';
          END IF;
        END $$;
        """
    )
    op.drop_index(
        "uq_fiscal_adjustment_tenant_void",
        table_name="fiscal_global_draft_adjustments",
    )
    op.drop_index(
        "uq_fiscal_adjustment_tenant_late_order",
        table_name="fiscal_global_draft_adjustments",
    )
    op.drop_constraint(
        "ck_fiscal_adjustment_source",
        "fiscal_global_draft_adjustments",
        type_="check",
    )
    op.drop_constraint(
        "ck_fiscal_adjustment_type",
        "fiscal_global_draft_adjustments",
        type_="check",
    )
    op.drop_constraint(
        "ck_fiscal_adjustment_amount",
        "fiscal_global_draft_adjustments",
        type_="check",
    )
    op.create_check_constraint(
        "ck_fiscal_adjustment_amount",
        "fiscal_global_draft_adjustments",
        "amount > 0",
    )
    op.create_check_constraint(
        "ck_fiscal_adjustment_type",
        "fiscal_global_draft_adjustments",
        "adjustment_type IN ('late_refund', 'late_inclusion', 'late_exclusion')",
    )
    op.create_check_constraint(
        "ck_fiscal_adjustment_source",
        "fiscal_global_draft_adjustments",
        "(adjustment_type = 'late_refund' AND source_refund_id IS NOT NULL "
        "AND source_event_id IS NULL) OR "
        "(adjustment_type IN ('late_inclusion', 'late_exclusion') "
        "AND source_refund_id IS NULL AND source_event_id IS NOT NULL)",
    )
