"""The waste cost snapshot is additive and keeps earlier movements readable."""

from uuid import uuid4

from sqlalchemy import text

from migration_tests.test_0065_tenant_hardening import _run_alembic, _temporary_database
from migration_tests.test_0068_branches import _migrate


def test_movement_unit_cost_is_null_for_earlier_rows_and_round_trips():
    with _temporary_database() as (url, engine):
        _run_alembic(url, "0117_coupons")
        tenant, product, movement = uuid4(), uuid4(), uuid4()
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Pan',:slug)"),
                         {"id": tenant, "slug": str(tenant)})
            conn.execute(text("INSERT INTO products(id,tenant_id,name,price_amount) "
                              "VALUES(:id,:tenant,'Bolillo',3)"), {"id": product, "tenant": tenant})
            conn.execute(text(
                "INSERT INTO inventory_movements(id,tenant_id,branch_id,product_id,movement_type,"
                "quantity_delta,reason_code,created_at) "
                "VALUES(:id,:tenant,:tenant,:product,'adjustment',-2,'merma',now())"),
                {"id": movement, "tenant": tenant, "product": product})

        _run_alembic(url, "0118_movement_unit_cost")
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT unit_cost FROM inventory_movements WHERE id=:id"),
                               {"id": movement}) is None
        down = _migrate(url.render_as_string(hide_password=False), "downgrade", "0117_coupons")
        assert down.returncode == 0, down.stderr
        _run_alembic(url, "0118_movement_unit_cost")
