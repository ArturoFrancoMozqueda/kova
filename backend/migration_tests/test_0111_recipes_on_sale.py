"""Recipes are tenant-isolated, append-only and keep their history on downgrade."""

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


def test_recipe_tables_are_isolated_append_only_and_guard_downgrade():
    with _temporary_database() as (url, engine):
        _run_alembic(url, "0111_recipes_on_sale")
        _run_provision(url)
        tenant, other, latte, milk, foreign_milk, recipe = [uuid4() for _ in range(6)]
        with engine.begin() as conn:
            for owner in (tenant, other):
                conn.execute(text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Café',:slug)"),
                             {"id": owner, "slug": str(owner)})
            for pid, owner, name in ((latte, tenant, "Latte"), (milk, tenant, "Leche"),
                                     (foreign_milk, other, "Leche ajena")):
                conn.execute(text(
                    "INSERT INTO products(id,tenant_id,name,price_amount) VALUES(:id,:t,:n,0)"
                ), {"id": pid, "t": owner, "n": name})
            assert conn.execute(text(
                "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='recipes'"
            )).one() == (True, True)
            for table, verbs in (("recipes", {"SELECT", "INSERT"}),
                                 ("recipe_lines", {"SELECT", "INSERT"}),
                                 ("modifier_option_consumptions", {"SELECT", "INSERT", "DELETE"})):
                for verb in ("SELECT", "INSERT", "UPDATE", "DELETE"):
                    assert conn.scalar(text("SELECT has_table_privilege('kova_app',:t,:v)"),
                                       {"t": table, "v": verb}) is (verb in verbs)

        runtime = _app_engine(url)
        try:
            with runtime.begin() as conn:
                conn.execute(text("SELECT set_config('app.tenant_id',:t,true)"),
                             {"t": str(tenant)})
                conn.execute(text(
                    "INSERT INTO recipes(id,tenant_id,product_id,version,mode,effective_from) "
                    "VALUES(:id,:t,:p,1,'on_sale',now())"
                ), {"id": recipe, "t": tenant, "p": latte})
                conn.execute(text(
                    "INSERT INTO recipe_lines(id,tenant_id,recipe_id,ingredient_product_id,"
                    "quantity) VALUES(:id,:t,:r,:m,240)"
                ), {"id": uuid4(), "t": tenant, "r": recipe, "m": milk})
            with pytest.raises(DBAPIError) as foreign:
                with runtime.begin() as conn:
                    conn.execute(text("SELECT set_config('app.tenant_id',:t,true)"),
                                 {"t": str(tenant)})
                    conn.execute(text(
                        "INSERT INTO recipe_lines(id,tenant_id,recipe_id,ingredient_product_id,"
                        "quantity) VALUES(:id,:t,:r,:m,10)"
                    ), {"id": uuid4(), "t": tenant, "r": recipe, "m": foreign_milk})
            assert foreign.value.orig.sqlstate == "23503"
            with runtime.begin() as conn:
                conn.execute(text("SELECT set_config('app.tenant_id',:t,true)"),
                             {"t": str(other)})
                assert conn.scalar(text("SELECT count(*) FROM recipes")) == 0
        finally:
            runtime.dispose()

        refused = _migrate(url.render_as_string(hide_password=False), "downgrade",
                           "0110_ingredients_units")
        assert refused.returncode != 0
        assert "Cannot downgrade recorded recipes" in refused.stderr
