"""Managed enrollment upgrade, RLS, portability and account deletion boundaries."""

import csv
import io
import json
import os
import subprocess
import sys
import zipfile
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.account_lifecycle.models import AccountDeletionRequest
from app.account_lifecycle.service import purge_due_accounts
from app.cfdi.models import CfdiConnection, CfdiEnrollment
from app.tests.test_cfdi_account_lifecycle import seed_cfdi_graph
from app.tests.test_cfdi_migration import _connection, _legacy, _requests, _runtime
from app.tests.test_integrations_readiness import ISSUER
from migration_tests.test_0065_tenant_hardening import (
    BACKEND_ROOT,
    _run_alembic,
    _temporary_database,
)

REVISION = "e9f2d5d835e6"
PREVIOUS = "0077_inventory_lots"
UPDATE_COLUMNS = {
    "organization_id", "issuer_snapshot", "state", "operation_id", "creation_rejected",
    "last_error_code", "updated_at",
}


def test_fresh_database_upgrade_to_head_installs_private_enrollment_journal():
    with _temporary_database() as (url, engine):
        _run_alembic(url, "head")
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT version_num FROM alembic_version")) == REVISION
            assert connection.scalar(text("SELECT count(*) FROM cfdi_enrollments")) == 0
            assert connection.execute(
                text("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='cfdi_enrollments'")
            ).one() == (True, True)
            assert connection.scalar(
                text("SELECT column_default FROM information_schema.columns WHERE table_name='cfdi_enrollments' AND column_name='creation_rejected'")
            ) == "false"


@pytest.fixture
def enrollment_store():
    with _temporary_database() as (url, engine):
        _run_alembic(url, PREVIOUS)
        with engine.begin() as connection:
            first, second = _legacy(connection), _legacy(connection)
            _connection(connection, first)
            _connection(connection, second)
            before = _requests(connection)
            connections = connection.execute(
                text("SELECT * FROM cfdi_connections ORDER BY id")
            ).mappings().all()
        _run_alembic(url, REVISION)
        with engine.begin() as connection:
            connection.execute(text("GRANT USAGE ON SCHEMA public TO kova_app"))
        yield url, engine, first, second, before, connections


def _enroll(connection, tenant, identifier=None):
    connection.execute(
        text(
            "INSERT INTO cfdi_enrollments (tenant_id, organization_id, issuer_snapshot, state, "
            "created_at, updated_at) VALUES (:tenant, :organization, CAST(:issuer AS json), "
            "'configured', now(), now())"
        ),
        {"tenant": tenant, "organization": identifier or "org-" + str(tenant), "issuer": json.dumps(ISSUER)},
    )


def _downgrade(url):
    rendered = url.render_as_string(hide_password=False)
    return subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", PREVIOUS],
        cwd=BACKEND_ROOT,
        env={
            **os.environ, "APP_ENV": "local", "DATABASE_URL": rendered,
            "APP_DATABASE_URL": rendered, "MIGRATION_DATABASE_URL": rendered,
        },
        capture_output=True, text=True, check=False,
    )


def test_upgrade_preserves_legacy_fiscal_history_and_forces_enrollment_rls(enrollment_store):
    _url, engine, _first, _second, before, connections = enrollment_store
    with engine.connect() as connection:
        assert _requests(connection) == before
        assert connection.execute(text("SELECT * FROM cfdi_connections ORDER BY id")).mappings().all() == connections
        assert connection.scalar(text("SELECT count(*) FROM cfdi_enrollments")) == 0
        assert connection.execute(
            text("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='cfdi_enrollments'")
        ).one() == (True, True)
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == REVISION
        columns = set(connection.execute(
            text("SELECT column_name FROM information_schema.columns WHERE table_name='cfdi_enrollments'")
        ).scalars())
        assert "creation_rejected" in columns
        assert columns.isdisjoint({"password", "cer", "key", "api_key", "encrypted_api_key"})


def test_new_table_grants_are_private_and_runtime_update_is_column_scoped(enrollment_store):
    _url, engine, first, _second, _before, _connections = enrollment_store
    with engine.begin() as connection:
        _enroll(connection, first["tenant"])
        for role in ("anon", "authenticated"):
            assert not connection.scalar(
                text("SELECT has_table_privilege(:role, 'cfdi_enrollments', 'SELECT,INSERT,UPDATE,DELETE')"),
                {"role": role},
            )
        assert connection.scalar(text("SELECT has_table_privilege('kova_app', 'cfdi_enrollments', 'SELECT')"))
        assert connection.scalar(text("SELECT has_table_privilege('kova_app', 'cfdi_enrollments', 'INSERT')"))
        assert not connection.scalar(text("SELECT has_table_privilege('kova_app', 'cfdi_enrollments', 'UPDATE')"))
        assert not connection.scalar(text("SELECT has_table_privilege('kova_app', 'cfdi_enrollments', 'DELETE')"))
        granted = set(connection.execute(
            text("SELECT column_name FROM information_schema.column_privileges WHERE table_name='cfdi_enrollments' AND grantee='kova_app' AND privilege_type='UPDATE'")
        ).scalars())
        assert granted == UPDATE_COLUMNS
    with engine.begin() as connection:
        _runtime(connection, first["tenant"])
        for query in (
            "UPDATE cfdi_enrollments SET tenant_id=tenant_id",
            "UPDATE cfdi_enrollments SET created_at=now()",
            "DELETE FROM cfdi_enrollments",
        ):
            with pytest.raises(DBAPIError) as denied, connection.begin_nested():
                connection.execute(text(query))
            assert denied.value.orig.sqlstate == "42501"
        assert connection.execute(
            text("UPDATE cfdi_enrollments SET state='unknown', creation_rejected=false, operation_id=:token WHERE tenant_id=:tenant"),
            {"token": uuid4(), "tenant": first["tenant"]},
        ).rowcount == 1


def test_runtime_rls_hides_and_prevents_cross_tenant_enrollment_writes(enrollment_store):
    _url, engine, first, second, _before, _connections = enrollment_store
    with engine.begin() as connection:
        _enroll(connection, first["tenant"])
        _enroll(connection, second["tenant"])
    with engine.begin() as connection:
        _runtime(connection)
        assert connection.scalar(text("SELECT count(*) FROM cfdi_enrollments")) == 0
    with engine.begin() as connection:
        _runtime(connection, first["tenant"])
        assert connection.execute(text("SELECT tenant_id FROM cfdi_enrollments")).scalars().all() == [first["tenant"]]
        assert connection.execute(
            text("UPDATE cfdi_enrollments SET state='error' WHERE tenant_id=:tenant"),
            {"tenant": second["tenant"]},
        ).rowcount == 0
        with pytest.raises(DBAPIError) as denied, connection.begin_nested():
            _enroll(connection, second["tenant"])
        assert denied.value.orig.sqlstate == "42501"


def test_nonempty_downgrade_preserves_journal_and_empty_downgrade_reupgrades(enrollment_store):
    url, engine, first, _second, before, connections = enrollment_store
    with engine.begin() as connection:
        _enroll(connection, first["tenant"])
    rejected = _downgrade(url)
    assert rejected.returncode != 0
    assert "Cannot erase managed fiscal enrollment journal" in rejected.stderr
    with engine.begin() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == REVISION
        assert connection.scalar(text("SELECT count(*) FROM cfdi_enrollments")) == 1
        assert _requests(connection) == before
        connection.execute(text("DELETE FROM cfdi_enrollments"))
    assert _downgrade(url).returncode == 0
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT to_regclass('cfdi_enrollments')")) is None
        assert _requests(connection) == before
        assert connection.execute(text("SELECT * FROM cfdi_connections ORDER BY id")).mappings().all() == connections
    _run_alembic(url, REVISION)
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM cfdi_enrollments")) == 0


@pytest.mark.usefixtures("fast_business_auth")
def test_account_export_includes_only_own_enrollment_metadata_without_operation_token(client, db):
    own = seed_cfdi_graph(client, db, "managed-export-own")
    other = seed_cfdi_graph(TestClient(client.app), db, "managed-export-other")
    tokens = [uuid4(), uuid4()]
    for graph, token in zip([own, other], tokens, strict=True):
        db.add(CfdiEnrollment(
            tenant_id=graph["tenant_id"], organization_id="managed-" + str(graph["tenant_id"]),
            issuer_snapshot=ISSUER, state="configured", operation_id=token,
        ))
    db.commit()
    response = client.get("/api/v1/export/account")
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        rows = list(csv.DictReader(io.StringIO(archive.read("datos/cfdi_enrollments.csv").decode())))
        assert [row["tenant_id"] for row in rows] == [str(own["tenant_id"])]
        assert rows[0]["state"] == "configured" and json.loads(rows[0]["issuer_snapshot"]) == ISSUER
        assert "operation_id" not in rows[0]
        exported = b"\n".join(archive.read(name) for name in archive.namelist())
        for value in (*tokens, other["tenant_id"]):
            assert str(value).encode() not in exported
        for value in (own["cipher"].encode(), own["plaintext"], other["cipher"].encode(), other["plaintext"]):
            assert value not in exported


@pytest.mark.usefixtures("fast_business_auth")
def test_account_purge_removes_only_requested_enrollment_and_provider_ciphertext(client, db):
    own = seed_cfdi_graph(client, db, "managed-purge-own")
    other = seed_cfdi_graph(TestClient(client.app), db, "managed-purge-other")
    for graph in (own, other):
        db.add(CfdiEnrollment(
            tenant_id=graph["tenant_id"], organization_id="managed-" + str(graph["tenant_id"]),
            issuer_snapshot=ISSUER, state="configured",
        ))
    request = AccountDeletionRequest(
        tenant_id=own["tenant_id"], requested_by_user_id=own["user_id"],
        purge_after=datetime.now(UTC) - timedelta(minutes=1),
    )
    db.add(request)
    db.commit()
    assert purge_due_accounts(db) == 1
    assert db.get(CfdiEnrollment, own["tenant_id"]) is None
    assert db.get(CfdiConnection, own["connection_id"]) is None
    assert db.get(CfdiEnrollment, other["tenant_id"]).issuer_snapshot == ISSUER
    assert db.get(CfdiConnection, other["connection_id"]).encrypted_api_key == other["cipher"]
    db.refresh(request)
    assert request.status == "completed"
