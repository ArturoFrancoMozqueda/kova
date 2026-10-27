import json
from contextlib import contextmanager
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError

from app.config import settings
from migration_tests.test_0068_branches import _migrate


@contextmanager
def database():
    name = f"kova_intake_migration_{uuid4().hex}"
    base = make_url(settings.effective_migration_database_url)
    admin = create_engine(base.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f"CREATE DATABASE {name} TEMPLATE template0 ENCODING 'UTF8'"))
    url = base.set(database=name).render_as_string(hide_password=False)
    engine = create_engine(url)
    try:
        yield url, engine
    finally:
        engine.dispose()
        with admin.connect() as conn:
            conn.execute(text(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=:name",
            ), {"name": name})
            conn.execute(text(f"DROP DATABASE {name}"))
        admin.dispose()


def test_additive_structure_preserves_legacy_and_downgrade_rejects_losing_requests():
    with database() as (url, engine):
        baseline = _migrate(url, "upgrade", "0095_customer_order_customer")
        assert baseline.returncode == 0, baseline.stderr
        tenant, catalog, request, product = (uuid4() for _ in range(4))
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO tenants(id,name,slug) VALUES(:id,'Migration menu',:slug)",
            ), {"id": tenant, "slug": str(tenant)})
            conn.execute(text(
                "INSERT INTO public_catalogs(id,tenant_id,branch_id,title,enabled,version,"
                "link_version,updated_at) VALUES(:id,:tenant,:tenant,'Menu',true,1,1,now())",
            ), {"id": catalog, "tenant": tenant})
            conn.execute(text(
                "INSERT INTO crm_catalog_requests(id,tenant_id,branch_id,catalog_id,submission_id,"
                "request_hash,name,contact,message,product_ids,status,version,created_at) "
                "VALUES(:id,:tenant,:tenant,:catalog,:submission,:hash,"
                "'Legacy','Contact','Text only','[]','new',1,now())",
            ), {"id": request, "tenant": tenant, "catalog": catalog,
                "submission": uuid4(), "hash": "a" * 64})
        applied = _migrate(url, "upgrade", "0096_catalog_order_intake")
        assert applied.returncode == 0, applied.stderr
        with engine.connect() as conn:
            row = conn.execute(text(
                "SELECT order_lines,origin,customer_order_id "
                "FROM crm_catalog_requests WHERE id=:id",
            ), {"id": request}).one()
            assert tuple(row) == (None, None, None)
            flags = conn.execute(text(
                "SELECT relrowsecurity,relforcerowsecurity FROM pg_class "
                "WHERE relname='crm_catalog_requests'",
            )).one()
            assert tuple(flags) == (True, True)
        rolled = _migrate(url, "downgrade", "0095_customer_order_customer")
        assert rolled.returncode == 0, rolled.stderr
        applied = _migrate(url, "upgrade", "0096_catalog_order_intake")
        assert applied.returncode == 0, applied.stderr
        with engine.begin() as conn:
            with pytest.raises(DBAPIError), conn.begin_nested():
                conn.execute(text(
                    "UPDATE crm_catalog_requests "
                    "SET order_lines=CAST(:lines AS json),origin=NULL WHERE id=:id",
                ), {"id": request, "lines": json.dumps([{"quantity": 1}])})
            conn.execute(text(
                "UPDATE crm_catalog_requests SET order_lines=CAST(:lines AS json),"
                "origin='remote' WHERE id=:id",
            ), {"id": request, "lines": json.dumps([{
                "product_id": str(product), "product_name": "Real snapshot", "quantity": 1,
                "unit_price_amount": "25.00", "line_total_amount": "25.00",
            }])})
        refused = _migrate(url, "downgrade", "0095_customer_order_customer")
        assert refused.returncode != 0
        assert "Cannot discard structured menu requests or order attribution" in refused.stderr
        with engine.connect() as conn:
            assert conn.execute(text(
                "SELECT origin FROM crm_catalog_requests WHERE id=:id",
            ), {"id": request}).scalar() == "remote"
