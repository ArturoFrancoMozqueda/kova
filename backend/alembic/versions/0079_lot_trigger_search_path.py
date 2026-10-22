"""Keep lot integrity triggers bound to authoritative application tables."""

from alembic import op

revision = "0079_lot_trigger_search_path"
down_revision = "0078_drawer_bridge"
branch_labels = None
depends_on = None

_FUNCTIONS = (
    "stamp_inventory_lot_movement",
    "check_inventory_lot_movement",
    "check_inventory_lot_reservation",
)


def upgrade():
    # Explicit pg_temp last matters: omitted, PostgreSQL searches temp relations
    # before public even when public appears in a function's fixed search_path.
    # SECURITY INVOKER and existing ACLs/RLS remain unchanged.
    for name in _FUNCTIONS:
        op.execute(f"ALTER FUNCTION public.{name}() SET search_path = pg_catalog, public, pg_temp")


def downgrade():
    for name in _FUNCTIONS:
        op.execute(f"ALTER FUNCTION public.{name}() RESET search_path")
