"""Mixed refunds retain ownership, money limits and history across app rollback."""

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from migration_tests.test_0065_tenant_hardening import (
    _app_engine,
    _run_alembic,
    _run_provision,
    _temporary_database,
)
from migration_tests.test_0068_branches import _migrate


def test_refund_payment_migration_preserves_legacy_and_guards_rollback_writes():
    with _temporary_database() as (url, engine):
        _run_alembic(url, "0107_reservation_notices")
        tenant, other, order, legacy, mixed = [uuid4() for _ in range(5)]
        with engine.begin() as conn:
            for owner in (tenant, other):
                conn.execute(text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Refund',:slug)"),
                             {"id": owner, "slug": str(owner)})
            conn.execute(text(
                "INSERT INTO orders(id,tenant_id,branch_id,status,subtotal_amount,total_amount) "
                "VALUES(:id,:tenant,:tenant,'completed',100,100)"
            ), {"id": order, "tenant": tenant})
            for method, amount in (("cash", "60.00"), ("bank_transfer", "40.00")):
                conn.execute(text(
                    "INSERT INTO payments(id,tenant_id,order_id,method,amount_amount,"
                    "change_due_amount) "
                    "VALUES(:id,:tenant,:order,:method,:amount,0)"
                ), {"id": uuid4(), "tenant": tenant, "order": order,
                    "method": method, "amount": amount})
            conn.execute(text(
                "INSERT INTO refunds(id,tenant_id,branch_id,order_id,"
                        "reason,refunded_amount,"
                "refund_payment_method,created_at) VALUES(:id,:tenant,:tenant,:order,"
                "'customer_return',25,'cash',now())"
            ), {"id": legacy, "tenant": tenant, "order": order})
        _run_alembic(url, "0108_refund_payments")
        _run_provision(url)
        with engine.connect() as conn:
            assert conn.execute(text(
                "SELECT relrowsecurity,relforcerowsecurity FROM pg_class "
                "WHERE relname='refund_payments'"
            )).one() == (True, True)
            assert conn.scalar(text("SELECT refunded_amount FROM refunds WHERE id=:id"),
                               {"id": legacy}) == 25
            for verb in ("SELECT", "INSERT"):
                assert conn.scalar(text(
                    "SELECT has_table_privilege('kova_app','refund_payments',:verb)"
                ), {"verb": verb})
            for verb in ("UPDATE", "DELETE"):
                assert not conn.scalar(text(
                    "SELECT has_table_privilege('kova_app','refund_payments',:verb)"
                ), {"verb": verb})
            for role in ("anon", "authenticated", "service_role"):
                assert not conn.scalar(text(
                    "SELECT has_table_privilege(:role,'refund_payments','SELECT')"
                ), {"role": role})
        # The schema is additive and an empty allocation table can round-trip.
        result = _migrate(url.render_as_string(hide_password=False), "downgrade",
                          "0107_reservation_notices")
        assert result.returncode == 0, result.stderr
        _run_alembic(url, "0108_refund_payments")
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO refunds(id,tenant_id,branch_id,order_id,reason,"
                "refunded_amount,created_at) "
                "VALUES(:id,:tenant,:tenant,:order,'customer_return',50,now())"
            ), {"id": mixed, "tenant": tenant, "order": order})
            for method, amount in (("cash", "30.00"), ("bank_transfer", "20.00")):
                conn.execute(text(
                    "INSERT INTO refund_payments(id,tenant_id,branch_id,refund_id,"
                        "method,amount) "
                    "VALUES(:id,:tenant,:tenant,:refund,:method,:amount)"
                ), {"id": uuid4(), "tenant": tenant, "refund": mixed,
                    "method": method, "amount": amount})
        runtime = _app_engine(url)
        try:
            with runtime.begin() as conn:
                conn.execute(text("SELECT set_config('app.tenant_id',:tenant,true)"),
                             {"tenant": str(tenant)})
                assert conn.scalar(text("SELECT count(*) FROM refund_payments")) == 2
            for context in ("", str(other)):
                with runtime.begin() as conn:
                    conn.execute(text("SELECT set_config('app.tenant_id',:tenant,true)"),
                                 {"tenant": context})
                    assert conn.scalar(text("SELECT count(*) FROM refund_payments")) == 0
            with pytest.raises(DBAPIError) as rejected:
                with runtime.begin() as conn:
                    conn.execute(text("SELECT set_config('app.tenant_id',:tenant,true)"),
                                 {"tenant": str(other)})
                    conn.execute(text(
                        "INSERT INTO refund_payments(id,tenant_id,branch_id,refund_id,"
                        "method,amount) "
                        "VALUES(:id,:tenant,:tenant,:refund,'manual_card',1)"
                    ), {"id": uuid4(), "tenant": other, "refund": mixed})
            assert rejected.value.orig.sqlstate == "23503"
            # Simulate the old app: it inserts only the legacy parent row and
            # cannot see mixed allocations in its old per-method calculation.
            with pytest.raises(DBAPIError) as exceeded:
                with runtime.begin() as conn:
                    conn.execute(text("SELECT set_config('app.tenant_id',:tenant,true)"),
                                 {"tenant": str(tenant)})
                    conn.execute(text(
                        "INSERT INTO refunds(id,tenant_id,branch_id,order_id,"
                        "reason,refunded_amount,"
                        "refund_payment_method,created_at) VALUES(:id,:tenant,:tenant,:order,"
                        "'customer_return',10,'cash',now())"
                    ), {"id": uuid4(), "tenant": tenant, "order": order})
            assert exceeded.value.orig.sqlstate == "23514"
        finally:
            runtime.dispose()
        refused = _migrate(url.render_as_string(hide_password=False), "downgrade",
                           "0107_reservation_notices")
        assert refused.returncode != 0
        assert "Retain mixed refund payment history" in refused.stderr
