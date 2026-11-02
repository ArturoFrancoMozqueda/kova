"""Durable Checkout attempts preserve uncertainty across migrations and isolate tenants."""

import json
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from migration_tests.test_0068_branches import _database, _migrate

BASELINE = "0100_commercial_plans"
REVISION = "0101_checkout_attempts"


def _tenant(conn):
    tenant = uuid4()
    conn.execute(text(
        "INSERT INTO tenants(id,name,slug) VALUES(:id,'Synthetic Checkout migration',:slug)"
    ), {"id": tenant, "slug": f"checkout-migration-{tenant}"})
    return tenant


def _attempt(conn, tenant):
    attempt = uuid4()
    conn.execute(text(
        "INSERT INTO billing_checkout_attempts(id,tenant_id,request_payload,"
        "credential_fingerprint,billing_cohort,status,created_at) "
        "VALUES(:id,:tenant,CAST(:payload AS json),'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','standard','uncertain',now())"
    ), {"id": attempt, "tenant": tenant, "payload": json.dumps({
        "price_id": "price_synthetic_standard", "success_url": "https://app.test/success",
        "cancel_url": "https://app.test/cancel", "tenant_id": str(tenant),
        "user_id": str(uuid4()), "customer": None,
    })})
    return attempt


def test_checkout_attempt_schema_is_additive_tenant_unique_and_force_rls():
    with _database() as (url, engine):
        baseline = _migrate(url, "upgrade", BASELINE)
        assert baseline.returncode == 0, baseline.stderr
        with engine.begin() as conn:
            tenant = _tenant(conn)
        upgraded = _migrate(url, "upgrade", REVISION)
        assert upgraded.returncode == 0, upgraded.stderr
        with engine.begin() as conn:
            assert conn.execute(text(
                "SELECT billing_cohort FROM tenants WHERE id=:id"
            ), {"id": tenant}).scalar_one() == "standard"
            assert conn.execute(text(
                "SELECT relrowsecurity,relforcerowsecurity FROM pg_class "
                "WHERE relname='billing_checkout_attempts'"
            )).one() == (True, True)
            attempt = _attempt(conn, tenant)
            with pytest.raises(IntegrityError), conn.begin_nested():
                _attempt(conn, tenant)
            for query in (
                "UPDATE billing_checkout_attempts SET status='invented' WHERE id=:id",
                "UPDATE billing_checkout_attempts SET status=NULL WHERE id=:id",
                "UPDATE billing_checkout_attempts SET billing_cohort='invented' WHERE id=:id",
                "UPDATE billing_checkout_attempts SET request_payload=NULL WHERE id=:id",
                "UPDATE billing_checkout_attempts SET status='open' WHERE id=:id",
            ):
                with pytest.raises(IntegrityError), conn.begin_nested():
                    conn.execute(text(query), {"id": attempt})
            assert conn.execute(text(
                "SELECT status,stripe_session_id,stripe_session_url "
                "FROM billing_checkout_attempts WHERE id=:id"
            ), {"id": attempt}).one() == ("uncertain", None, None)


def test_downgrade_cannot_erase_an_unknown_stripe_side_effect_but_empty_round_trip_is_safe():
    with _database() as (url, engine):
        upgraded = _migrate(url, "upgrade", REVISION)
        assert upgraded.returncode == 0, upgraded.stderr
        with engine.begin() as conn:
            tenant = _tenant(conn)
            attempt = _attempt(conn, tenant)
        for status, session_id in (
            ("uncertain", None), ("open", "cs_test_migration_open"),
            ("complete", "cs_test_migration_complete"),
        ):
            with engine.begin() as conn:
                conn.execute(text(
                    "UPDATE billing_checkout_attempts SET status=:status,"
                    "stripe_session_id=:session WHERE id=:id"
                ), {"status": status, "session": session_id, "id": attempt})
            refused = _migrate(url, "downgrade", BASELINE)
            assert refused.returncode != 0
            assert "Resolve billable or uncertain Checkout attempts" in refused.stderr
            with engine.connect() as conn:
                assert conn.execute(text(
                    "SELECT status,stripe_session_id FROM billing_checkout_attempts WHERE id=:id"
                ), {"id": attempt}).one() == (status, session_id)
        with engine.begin() as conn:
            assert conn.execute(text(
                "SELECT version_num FROM alembic_version"
            )).scalar_one() == REVISION
            # Only synthetic owner-side cleanup is permitted; no production attempt is discarded.
            conn.execute(text("DELETE FROM billing_checkout_attempts WHERE id=:id"),
                         {"id": attempt})
        downgraded = _migrate(url, "downgrade", BASELINE)
        assert downgraded.returncode == 0, downgraded.stderr
        reapplied = _migrate(url, "upgrade", REVISION)
        assert reapplied.returncode == 0, reapplied.stderr
        with engine.connect() as conn:
            assert conn.execute(text(
                "SELECT count(*) FROM billing_checkout_attempts"
            )).scalar_one() == 0
