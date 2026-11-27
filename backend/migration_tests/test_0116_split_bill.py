"""Split bill columns are additive, bounded and protect recorded splits on downgrade."""

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from migration_tests.test_0065_tenant_hardening import _run_alembic, _temporary_database
from migration_tests.test_0068_branches import _migrate


def test_split_groups_round_trip_and_refuse_losing_who_paid():
    with _temporary_database() as (url, engine):
        _run_alembic(url, "0115_prep_queue")
        tenant, order = uuid4(), uuid4()
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Cafe',:slug)"),
                         {"id": tenant, "slug": str(tenant)})
            conn.execute(text(
                "INSERT INTO orders(id,tenant_id,branch_id,status,subtotal_amount,total_amount) "
                "VALUES(:id,:tenant,:tenant,'completed',55,55)"), {"id": order, "tenant": tenant})

        def pay(group):
            with engine.begin() as conn:
                conn.execute(text(
                    "INSERT INTO payments(id,tenant_id,order_id,method,amount_amount,"
                    "change_due_amount,split_group) VALUES(:id,:tenant,:order,'manual_card',55,0,"
                    ":group)"), {"id": uuid4(), "tenant": tenant, "order": order, "group": group})

        _run_alembic(url, "0116_split_bill")
        with pytest.raises(DBAPIError) as rejected:
            pay(21)
        assert rejected.value.orig.sqlstate == "23514"
        pay(None)
        down = _migrate(url.render_as_string(hide_password=False), "downgrade", "0115_prep_queue")
        assert down.returncode == 0, down.stderr
        _run_alembic(url, "0116_split_bill")
        pay(1)
        refused = _migrate(url.render_as_string(hide_password=False), "downgrade",
                           "0115_prep_queue")
        assert refused.returncode != 0
        assert "Cannot downgrade recorded split bills" in refused.stderr
