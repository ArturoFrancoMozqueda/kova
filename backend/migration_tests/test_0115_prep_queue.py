"""Preparation queue tables are private, constrained and protect tickets on downgrade."""

from datetime import date
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from migration_tests.test_0065_tenant_hardening import (
    _run_alembic,
    _run_provision,
    _temporary_database,
)
from migration_tests.test_0068_branches import _migrate


def test_prep_queue_round_trips_and_refuses_losing_tickets():
    with _temporary_database() as (url, engine):
        _run_alembic(url, "0114_customer_order_deposits")
        tenant, order, product = uuid4(), uuid4(), uuid4()
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Cafe',:slug)"),
                         {"id": tenant, "slug": str(tenant)})
            conn.execute(text("INSERT INTO products(id,tenant_id,name,price_amount) "
                              "VALUES(:id,:tenant,'Latte',55)"), {"id": product, "tenant": tenant})
            conn.execute(text(
                "INSERT INTO orders(id,tenant_id,branch_id,status,subtotal_amount,total_amount) "
                "VALUES(:id,:tenant,:tenant,'completed',55,55)"), {"id": order, "tenant": tenant})

        _run_alembic(url, "0115_prep_queue")
        _run_provision(url)
        station = uuid4()
        with engine.begin() as conn:
            assert conn.scalar(text("SELECT prep_station_id FROM products WHERE id=:id"),
                               {"id": product}) is None
            conn.execute(text("INSERT INTO prep_stations(id,tenant_id,name) "
                              "VALUES(:id,:tenant,'Barra')"), {"id": station, "tenant": tenant})
            for table in ("prep_stations", "prep_daily_numbers", "prep_tickets"):
                assert conn.scalar(text(
                    "SELECT relforcerowsecurity FROM pg_class WHERE relname=:t"), {"t": table})
                assert not conn.scalar(text(
                    "SELECT has_table_privilege('kova_app',:t,'DELETE')"), {"t": table})
            assert not conn.scalar(text(
                "SELECT has_column_privilege('kova_app','prep_tickets','order_id','UPDATE')"))
        # Two active stations cannot share a name, whatever the case.
        with pytest.raises(DBAPIError) as duplicate, engine.begin() as conn:
            conn.execute(text("INSERT INTO prep_stations(id,tenant_id,name) "
                              "VALUES(:id,:tenant,'BARRA')"), {"id": uuid4(), "tenant": tenant})
        assert duplicate.value.orig.sqlstate == "23505"

        down = _migrate(url.render_as_string(hide_password=False), "downgrade",
                        "0114_customer_order_deposits")
        assert down.returncode == 0, down.stderr
        _run_alembic(url, "0115_prep_queue")
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO prep_stations(id,tenant_id,name) "
                              "VALUES(:id,:tenant,'Barra')"), {"id": station, "tenant": tenant})
            conn.execute(text(
                "INSERT INTO prep_tickets(id,tenant_id,branch_id,order_id,station_id,number,"
                "local_date,received_at) VALUES(:id,:tenant,:tenant,:order,:station,1,:day,now())"
            ), {"id": uuid4(), "tenant": tenant, "order": order, "station": station,
                "day": date.today()})
        refused = _migrate(url.render_as_string(hide_password=False), "downgrade",
                           "0114_customer_order_deposits")
        assert refused.returncode != 0
        assert "Cannot downgrade recorded preparation tickets" in refused.stderr
