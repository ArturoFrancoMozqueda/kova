"""Shared PostgreSQL roles must not race between isolated xdist databases."""

import time
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from testing_roles import (
    KOVA_APP_TEST_PASSWORD,
    ROLE_PROVISION_LOCK,
    provision_test_runtime_role,
)


def test_parallel_role_refreshes_from_distinct_database_urls_share_one_catalog_lock(owner_engine):
    worker = owner_engine.url
    maintenance = create_engine(worker.set(database="postgres"), poolclass=NullPool)
    # The helper receives independent worker URLs, but shared role/catalog DDL
    # must always lock in postgres, rather than in a worker database namespace.
    urls = [worker, worker.set(database="postgres")] * 2
    try:
        with maintenance.connect() as guard, ThreadPoolExecutor(max_workers=4) as pool:
            transaction = guard.begin()
            guard.execute(text("SELECT pg_advisory_xact_lock(:key)"),
                          {"key": ROLE_PROVISION_LOCK})
            futures = [pool.submit(provision_test_runtime_role,
                                   url.render_as_string(hide_password=False)) for url in urls]
            try:
                deadline = time.monotonic() + 8
                while True:
                    waiting = guard.execute(text(
                        "SELECT count(*) FROM pg_locks WHERE locktype='advisory' "
                        "AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) "
                        "AND classid=0 AND objid=:key AND objsubid=1 AND NOT granted"
                    ), {"key": ROLE_PROVISION_LOCK}).scalar_one()
                    if waiting >= 4:
                        break
                    assert time.monotonic() < deadline, "four role refreshes did not share the cluster-role lock"
                    assert not any(future.done() for future in futures), "role DDL bypassed the shared lock"
                    time.sleep(0.02)
                assert all(not future.done() for future in futures)
            finally:
                transaction.rollback()
            # All four real CREATE/ALTER sequences must now finish successfully,
            # rather than racing on the same pg_authid row across databases.
            for future in futures:
                future.result(timeout=10)
        runtime_url = worker.set(username="kova_app", password=KOVA_APP_TEST_PASSWORD)
        runtime = create_engine(runtime_url, poolclass=NullPool)
        try:
            with runtime.connect() as connection:
                role = connection.execute(text(
                    "SELECT current_user, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole "
                    "FROM pg_roles WHERE rolname=current_user"
                )).one()
                assert tuple(role) == ("kova_app", False, False, False, False)
        finally:
            runtime.dispose()
    finally:
        maintenance.dispose()
