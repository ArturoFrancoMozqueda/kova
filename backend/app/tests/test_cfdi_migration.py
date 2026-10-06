"""Real PostgreSQL upgrade, history preservation, and least-privilege boundaries."""

import json
import os
import subprocess
import sys
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from migration_tests.test_0065_tenant_hardening import (
    BACKEND_ROOT,
    _run_alembic,
    _temporary_database,
)


def _legacy(conn):
    ids = {name: uuid4() for name in ("tenant", "order", "request", "connection", "document")}
    conn.execute(
        text("INSERT INTO tenants(id,name,slug) VALUES(:tenant,'Shop',:slug)"),
        {**ids, "slug": str(ids["tenant"])},
    )
    conn.execute(
        text(
            "INSERT INTO orders(id,tenant_id,status,subtotal_amount,total_amount) "
            "VALUES(:order,:tenant,'completed',116,116)"
        ),
        ids,
    )
    conn.execute(
        text(
            "INSERT INTO invoice_requests(id,tenant_id,branch_id,order_id,"
            "issuer_snapshot,recipient_snapshot,pricing_snapshot,total_amount) VALUES "
            "(:request,:tenant,:tenant,:order,CAST(:issuer AS json),CAST(:recipient AS json),"
            "CAST(:pricing AS json),116)"
        ),
        {
            **ids,
            "issuer": json.dumps({"rfc": "AAA010101AAA"}),
            "recipient": json.dumps({"rfc": "XAXX010101000", "legal_name": "Buyer"}),
            "pricing": json.dumps({"total_amount": "116.00", "tax_amount": "16.00"}),
        },
    )
    return ids


def _connection(conn, ids):
    conn.execute(
        text(
            "INSERT INTO cfdi_connections(id,tenant_id,environment,organization_id,"
            "encrypted_api_key,production_ready,refreshed_at) VALUES "
            "(:connection,:tenant,'test','fixture','encrypted-fixture',false,now())"
        ),
        ids,
    )


def _document(conn, ids):
    conn.execute(
        text(
            "INSERT INTO cfdi_documents(id,tenant_id,branch_id,order_id,request_id,"
            "connection_id,environment,organization_id,state,idempotency_key,request_hash,external_id,"
            "provider_key,payload,total_amount,created_by_user_id,created_at,updated_at) VALUES "
            "(:document,:tenant,:branch,:order,:request,:connection,'test','fixture','prepared',"
            ":token,:hash,:token,:token,CAST(:payload AS json),116,:tenant,now(),now())"
        ),
        {
            "branch": ids["tenant"],
            "token": str(ids["document"]),
            "hash": "a" * 64,
            "payload": json.dumps({"immutable": True}),
            **ids,
        },
    )


def _requests(conn):
    return conn.execute(text("SELECT * FROM invoice_requests ORDER BY id")).mappings().all()


@pytest.fixture
def migrated_store():
    with _temporary_database() as (url, engine):
        _run_alembic(url, "0073_fiscal_requests")
        with engine.begin() as conn:
            a, b = _legacy(conn), _legacy(conn)
            before = _requests(conn)
        _run_alembic(url, "0074_cfdi_documents")
        with engine.begin() as conn:
            conn.execute(text("GRANT USAGE ON SCHEMA public TO kova_app"))
            _connection(conn, a)
            _connection(conn, b)
        yield url, engine, a, b, before


def _runtime(conn, tenant=None):
    conn.execute(text("SET LOCAL ROLE kova_app"))
    if tenant is not None:
        conn.execute(
            text("SELECT set_config('app.tenant_id',:tenant,true)"), {"tenant": str(tenant)}
        )


def _downgrade(url, succeeds):
    rendered = url.render_as_string(hide_password=False)
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "0073_fiscal_requests"],
        cwd=BACKEND_ROOT,
        env={
            **os.environ,
            "APP_ENV": "local",
            "DATABASE_URL": rendered,
            "APP_DATABASE_URL": rendered,
            "MIGRATION_DATABASE_URL": rendered,
        },
        capture_output=True,
        text=True,
        check=False,
    )
    assert (result.returncode == 0) is succeeds, result.stderr[-3000:]
    return result.stderr


def test_upgrade_keeps_pending_requests_and_sale_fiscal_state(migrated_store):
    _, engine, _, _, before = migrated_store
    with engine.connect() as conn:
        assert _requests(conn) == before
        assert {row["status"] for row in before} == {"pending_provider"}
        assert conn.scalar(text("SELECT count(*) FROM cfdi_documents")) == 0
        assert conn.execute(
            text("SELECT status,subtotal_amount,total_amount FROM orders")
        ).all() == [("completed", 116, 116), ("completed", 116, 116)]
        assert conn.scalar(text("SELECT count(*) FROM fiscal_individual_invoice_events")) == 0
        flags = conn.execute(
            text(
                "SELECT relrowsecurity,relforcerowsecurity FROM pg_class "
                "WHERE relname IN ('cfdi_connections','cfdi_documents')"
            )
        ).all()
        assert len(flags) == 2
        assert all(enabled and forced for enabled, forced in flags)


def test_runtime_rls_hides_foreign_rows_and_rejects_foreign_insert(migrated_store):
    _, engine, a, b, _ = migrated_store
    with engine.begin() as conn:
        _document(conn, a)
        _document(conn, b)
    with engine.begin() as conn:
        _runtime(conn)
        for table in ("cfdi_connections", "cfdi_documents"):
            assert conn.scalar(text(f"SELECT count(*) FROM {table}")) == 0
    with engine.begin() as conn:
        _runtime(conn, a["tenant"])
        for table in ("cfdi_connections", "cfdi_documents"):
            assert conn.execute(text(f"SELECT tenant_id FROM {table}")).scalars().all() == [
                a["tenant"]
            ]
        assert (
            conn.execute(
                text("UPDATE cfdi_documents SET state='pending' WHERE id=:document"), b
            ).rowcount
            == 0
        )
        with pytest.raises(DBAPIError, match="row-level security"), conn.begin_nested():
            _connection(conn, {**b, "connection": uuid4()})


@pytest.mark.parametrize("field", ["connection", "request", "order", "branch"])
def test_composite_foreign_keys_block_cross_tenant_references(migrated_store, field):
    _, engine, a, b, _ = migrated_store
    candidate = {**a, "document": uuid4(), field: b.get(field, b["tenant"])}
    with engine.begin() as conn:
        _runtime(conn, a["tenant"])
        with pytest.raises(DBAPIError, match="foreign key"), conn.begin_nested():
            _document(conn, candidate)


@pytest.mark.parametrize(
    "column,value",
    [
        ("payload", "'{}'"),
        ("request_hash", "'changed'"),
        ("idempotency_key", "'changed'"),
        ("total_amount", "1"),
    ],
)
def test_runtime_journal_immutable_but_status_writable(migrated_store, column, value):
    _, engine, a, _, _ = migrated_store
    with engine.begin() as conn:
        _document(conn, a)
    with engine.begin() as conn:
        _runtime(conn, a["tenant"])
        with pytest.raises(DBAPIError, match="permission denied"), conn.begin_nested():
            conn.execute(text(f"UPDATE cfdi_documents SET {column}={value} WHERE id=:document"), a)
        assert (
            conn.execute(
                text(
                    "UPDATE cfdi_documents SET state='pending',provider_id='response-id' "
                    "WHERE id=:document"
                ),
                a,
            ).rowcount
            == 1
        )
        with pytest.raises(DBAPIError, match="permission denied"), conn.begin_nested():
            conn.execute(text("DELETE FROM cfdi_documents WHERE id=:document"), a)


@pytest.mark.parametrize("document_exists", [False, True])
def test_downgrade_refuses_credentials_or_journal_loss(migrated_store, document_exists):
    url, engine, a, _, before = migrated_store
    if document_exists:
        with engine.begin() as conn:
            _document(conn, a)
    assert "Cannot erase CFDI journal or credentials" in _downgrade(url, False)
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0074_cfdi_documents"
        assert conn.scalar(text("SELECT count(*) FROM cfdi_connections")) == 2
        assert conn.scalar(text("SELECT count(*) FROM cfdi_documents")) == int(document_exists)
        assert _requests(conn) == before


def test_empty_downgrade_reupgrade_retains_legacy_requests(migrated_store):
    url, engine, _, _, before = migrated_store
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM cfdi_connections"))
    _downgrade(url, True)
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT to_regclass('cfdi_documents')")) is None
        assert _requests(conn) == before
    _run_alembic(url, "0074_cfdi_documents")
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT count(*) FROM cfdi_documents")) == 0
        assert _requests(conn) == before
