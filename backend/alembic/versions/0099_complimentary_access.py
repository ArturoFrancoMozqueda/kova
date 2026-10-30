"""Operator-managed permanent access, independent of Stripe subscription status."""

import sqlalchemy as sa

from alembic import op

revision = "0099_complimentary_access"
down_revision = "0098_public_loyalty_enrollment"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("subscriptions", sa.Column(
        "complimentary_access", sa.Boolean(), nullable=False, server_default=sa.false(),
    ))


def downgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM subscriptions WHERE complimentary_access) THEN
                RAISE EXCEPTION 'Revoke complimentary grants before removing their column';
            END IF;
        END $$
    """)
    op.drop_column("subscriptions", "complimentary_access")
