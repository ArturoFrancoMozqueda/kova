"""Keep the cost of one stock unit on each typed waste movement.

Waste (merma, caducidad, robo, daño, autoconsumo) was valued with the
product's current cost, so a later price change rewrote past losses. The
cost of one base unit at the moment of the movement now stays on the row;
rows written before this revision, or by an older app version after a
rollback, keep NULL and the report values them as before.
"""

import sqlalchemy as sa

from alembic import op

revision = "0118_movement_unit_cost"
down_revision = "0117_coupons"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("inventory_movements",
                  sa.Column("unit_cost", sa.Numeric(18, 6), nullable=True))
    op.create_check_constraint("ck_inventory_movements_unit_cost", "inventory_movements",
                               "unit_cost IS NULL OR unit_cost >= 0")


def downgrade():
    op.drop_constraint("ck_inventory_movements_unit_cost", "inventory_movements", type_="check")
    op.drop_column("inventory_movements", "unit_cost")
