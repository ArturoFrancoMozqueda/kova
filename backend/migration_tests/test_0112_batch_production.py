"""Production batches are isolated, append-only and keep history on downgrade."""

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


def test_batch_rules_privileges_and_guarded_downgrade():
    with _temporary_database() as (url, engine):
        _run_alembic(url, "0112_batch_production")
        _run_provision(url)
        tenant, product, recipe, batch = [uuid4() for _ in range(4)]
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Pan',:slug)"),
                         {"id": tenant, "slug": str(tenant)})
            conn.execute(text(
                "INSERT INTO products(id,tenant_id,name,price_amount) VALUES(:id,:t,'Concha',18)"
            ), {"id": product, "t": tenant})
            assert conn.execute(text(
                "SELECT relrowsecurity, relforcerowsecurity FROM pg_class "
                "WHERE relname='production_batches'"
            )).one() == (True, True)
            for verb in ("SELECT", "INSERT", "UPDATE", "DELETE"):
                assert conn.scalar(
                    text("SELECT has_table_privilege('kova_app','production_batches',:v)"),
                    {"v": verb},
                ) is (verb in {"SELECT", "INSERT"})
        for statement in (
            "INSERT INTO recipes(id,tenant_id,product_id,version,mode,effective_from) "
            "VALUES(:r,:t,:p,1,'batch',now())",
            "INSERT INTO recipes(id,tenant_id,product_id,version,mode,batch_yield,effective_from) "
            "VALUES(:r,:t,:p,1,'on_sale',24,now())",
        ):
            with pytest.raises(DBAPIError) as rejected:
                with engine.begin() as conn:
                    conn.execute(text(statement), {"r": uuid4(), "t": tenant, "p": product})
            assert rejected.value.orig.sqlstate == "23514"
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO recipes(id,tenant_id,product_id,version,mode,batch_yield,"
                "effective_from) VALUES(:r,:t,:p,1,'batch',24,now())"
            ), {"r": recipe, "t": tenant, "p": product})
            conn.execute(text(
                "INSERT INTO production_batches(id,tenant_id,branch_id,product_id,recipe_id,"
                "batches,expected_quantity,actual_quantity) VALUES(:b,:t,:t,:p,:r,1,24,24)"
            ), {"b": batch, "t": tenant, "p": product, "r": recipe})
            conn.execute(text(
                "INSERT INTO inventory_movements(id,tenant_id,branch_id,product_id,"
                "production_batch_id,movement_type,quantity_delta) "
                "VALUES(:m,:t,:t,:p,:b,'production',24)"
            ), {"m": uuid4(), "t": tenant, "p": product, "b": batch})

        refused = _migrate(url.render_as_string(hide_password=False), "downgrade",
                           "0111_recipes_on_sale")
        assert refused.returncode != 0
        assert "Cannot downgrade recorded production history" in refused.stderr
