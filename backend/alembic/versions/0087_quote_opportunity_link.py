"""Explicit immutable opportunity attribution for customer quotes."""

import sqlalchemy as sa

from alembic import op

revision = "0087_quote_opportunity_link"
down_revision = "0086_commercial_engagement"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("customer_quotes", sa.Column("opportunity_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_customer_quote_opportunity",
        "customer_quotes",
        "crm_opportunities",
        ["tenant_id", "branch_id", "opportunity_id"],
        ["tenant_id", "branch_id", "id"],
    )


def downgrade():
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM customer_quotes WHERE opportunity_id IS NOT NULL) THEN
            RAISE EXCEPTION 'Preserve quote attribution before downgrade';
        END IF;
    END $$""")
    op.drop_constraint("fk_customer_quote_opportunity", "customer_quotes", type_="foreignkey")
    op.drop_column("customer_quotes", "opportunity_id")
