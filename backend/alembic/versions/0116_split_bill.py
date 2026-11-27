"""Split a bill by person: who consumed each line and who paid each payment.

`order_items.split_group` and `payments.split_group` (1–20) mark the person of a
sale divided "each pays their own". The sale stays one financial record with one
receipt; NULL means an undivided sale, as every earlier sale. Additive: the
previous app version ignores both columns; downgrade is refused once a bill was
split, so who paid what is never lost silently.
"""

import sqlalchemy as sa

from alembic import op

revision = "0116_split_bill"
down_revision = "0115_prep_queue"
branch_labels = None
depends_on = None


def upgrade():
    for table in ("order_items", "payments"):
        op.add_column(table, sa.Column("split_group", sa.SmallInteger(), nullable=True))
        op.create_check_constraint(
            f"ck_{table}_split_group", table,
            "split_group IS NULL OR split_group BETWEEN 1 AND 20",
        )


def downgrade():
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM payments WHERE split_group IS NOT NULL) "
        "OR EXISTS (SELECT 1 FROM order_items WHERE split_group IS NOT NULL) "
        "THEN RAISE EXCEPTION 'Cannot downgrade recorded split bills'; "
        "END IF; END $$;"
    )
    for table in ("payments", "order_items"):
        op.drop_constraint(f"ck_{table}_split_group", table, type_="check")
        op.drop_column(table, "split_group")
