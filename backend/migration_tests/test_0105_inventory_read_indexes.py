from sqlalchemy import text

from migration_tests.test_0065_tenant_hardening import _run_alembic, _temporary_database
from migration_tests.test_0068_branches import _migrate

_INDEXES = """
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'inventory_movements'
  AND indexname IN (
      'ix_inventory_branch_product',
      'ix_inventory_movements_stock',
      'ix_inventory_movements_type_time'
  )
"""


def _indexes(engine) -> dict[str, str]:
    with engine.connect() as conn:
        return dict(conn.execute(text(_INDEXES)).all())


def test_inventory_read_indexes_are_tenant_led_covering_and_round_trip():
    with _temporary_database() as (url, engine):
        _run_alembic(url, "0105_inventory_read_indexes")
        indexes = _indexes(engine)
        assert set(indexes) == {"ix_inventory_movements_stock", "ix_inventory_movements_type_time"}
        assert "(tenant_id, branch_id, product_id) INCLUDE (quantity_delta)" in (
            indexes["ix_inventory_movements_stock"]
        )
        assert (
            "(tenant_id, branch_id, movement_type, created_at) "
            "INCLUDE (product_id, quantity_delta)"
        ) in indexes["ix_inventory_movements_type_time"]

        rendered = url.render_as_string(hide_password=False)
        rollback = _migrate(rendered, "downgrade", "0104_table_reservation_requests")
        assert rollback.returncode == 0, rollback.stderr
        assert set(_indexes(engine)) == {"ix_inventory_branch_product"}

        _run_alembic(url, "0105_inventory_read_indexes")
        assert set(_indexes(engine)) == {
            "ix_inventory_movements_stock",
            "ix_inventory_movements_type_time",
        }
