"""Coupon tables are private, constrained and protect recorded uses on downgrade."""

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


def _coupon(conn, tenant, code, kind="percent", value=10):
    coupon = uuid4()
    conn.execute(text("INSERT INTO coupons(id,tenant_id,code,kind,value) "
                      "VALUES(:id,:tenant,:code,:kind,:value)"),
                 {"id": coupon, "tenant": tenant, "code": code, "kind": kind, "value": value})
    return coupon


def test_coupons_round_trip_validate_and_refuse_losing_uses():
    with _temporary_database() as (url, engine):
        _run_alembic(url, "0116_split_bill")
        tenant, order = uuid4(), uuid4()
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Cafe',:slug)"),
                         {"id": tenant, "slug": str(tenant)})
            conn.execute(text(
                "INSERT INTO orders(id,tenant_id,branch_id,status,subtotal_amount,total_amount) "
                "VALUES(:id,:tenant,:tenant,'completed',99,99)"), {"id": order, "tenant": tenant})

        _run_alembic(url, "0117_coupons")
        _run_provision(url)
        for code, kind, value in (("bajo", "percent", 10), ("MAS", "percent", 101),
                                  ("CERO", "amount", 0)):
            with pytest.raises(DBAPIError) as rejected, engine.begin() as conn:
                _coupon(conn, tenant, code, kind, value)
            assert rejected.value.orig.sqlstate == "23514", code
        with engine.connect() as conn:
            for table in ("coupons", "coupon_redemptions"):
                assert conn.scalar(text(
                    "SELECT relforcerowsecurity FROM pg_class WHERE relname=:t"), {"t": table})
            assert not conn.scalar(text(
                "SELECT has_column_privilege('kova_app','coupons','code','UPDATE')"))

        down = _migrate(url.render_as_string(hide_password=False), "downgrade", "0116_split_bill")
        assert down.returncode == 0, down.stderr
        _run_alembic(url, "0117_coupons")
        with engine.begin() as conn:
            coupon = _coupon(conn, tenant, "VERANO10")
            conn.execute(text(
                "INSERT INTO coupon_redemptions(id,tenant_id,branch_id,coupon_id,sale_order_id,"
                "code,discount_amount) VALUES(:id,:tenant,:tenant,:coupon,:order,'VERANO10',11)"),
                {"id": uuid4(), "tenant": tenant, "coupon": coupon, "order": order})
        refused = _migrate(url.render_as_string(hide_password=False), "downgrade",
                           "0116_split_bill")
        assert refused.returncode != 0
        assert "Cannot downgrade recorded coupon uses" in refused.stderr
