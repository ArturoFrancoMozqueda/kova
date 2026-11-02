"""Separate runtime transactions must converge on one durable, immutable Checkout attempt."""

import json
from concurrent.futures import ThreadPoolExecutor
from queue import Queue
from threading import Barrier, Event, Lock
from time import monotonic, time
from uuid import uuid4

import pytest
from sqlalchemy import event, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.billing import service
from app.config import settings
from app.db import set_tenant_context
from app.tests.test_billing_api import _configure_stripe


@pytest.fixture
def committed_checkout_owners(owner_engine):
    tenant = uuid4()
    owners = (uuid4(), uuid4())
    other_tenant = uuid4()
    with owner_engine.begin() as conn:
        for identifier in (tenant, other_tenant):
            conn.execute(text(
                "INSERT INTO tenants(id,name,slug) VALUES(:id,'Synthetic Checkout race',:slug)"
            ), {"id": identifier, "slug": f"checkout-race-{identifier}"})
        for owner in owners:
            conn.execute(text(
                "INSERT INTO users(id,email,hashed_password,is_email_verified) "
                "VALUES(:id,:email,'synthetic-test-only',true)"
            ), {"id": owner, "email": f"checkout-race-{owner}@example.com"})
            conn.execute(text(
                "INSERT INTO memberships(tenant_id,user_id,role) VALUES(:tenant,:user,'owner')"
            ), {"tenant": tenant, "user": owner})
    try:
        yield tenant, owners, other_tenant
    finally:
        with owner_engine.begin() as conn:
            for table in (
                "billing_checkout_attempts", "idempotency_keys", "audit_logs", "subscriptions",
                "memberships", "branches",
            ):
                conn.execute(text(f"DELETE FROM {table} WHERE tenant_id=:tenant"),
                             {"tenant": tenant})
            for owner in owners:
                conn.execute(text("DELETE FROM users WHERE id=:id"), {"id": owner})
            conn.execute(text("DELETE FROM branches WHERE tenant_id=:tenant"),
                         {"tenant": other_tenant})
            for identifier in (tenant, other_tenant):
                conn.execute(text("DELETE FROM tenants WHERE id=:id"), {"id": identifier})


def test_distinct_tabs_and_owners_share_one_checkout_after_the_attempt_is_committed(
    owner_engine, kova_app_engine, committed_checkout_owners, monkeypatch,
):
    tenant, owners, other_tenant = committed_checkout_owners
    _configure_stripe(monkeypatch)
    monkeypatch.setattr(settings, "billing_tiered_plans_enabled", False)
    first_http_started = Event()
    another_http_started = Event()
    release_http = Event()
    fake_lock = Lock()
    backend_actors = Queue(maxsize=2)
    start = Barrier(2)
    calls = []
    remote_sessions = {}
    durable_snapshots = []

    class StripeWithOneObjectPerKey:
        def create_checkout_session(self, **kwargs):
            with fake_lock:
                calls.append(dict(kwargs))
                first_call = len(calls) == 1
                key = kwargs["idempotency_key"]
                session = remote_sessions.setdefault(key, {
                    "id": "cs_test_synthetic_" + uuid4().hex,
                    "url": "https://checkout.stripe.test/synthetic",
                    "status": "open", "mode": "subscription", "livemode": False,
                    "client_reference_id": str(tenant),
                    "metadata": {"tenant_id": str(tenant), "user_id": kwargs["user_id"]},
                    "customer": kwargs.get("customer"), "expires_at": int(time()) + 3600,
                })
            # Another connection sees the attempt before a simulated provider side effect returns.
            with owner_engine.connect() as conn:
                durable = conn.execute(text(
                    "SELECT id,status,request_payload FROM billing_checkout_attempts "
                    "WHERE tenant_id=:tenant"
                ), {"tenant": tenant}).one()
                durable_snapshots.append(durable)
                assert key == f"checkout:{tenant}:{durable.id}"
                assert durable.request_payload == {
                    name: value for name, value in kwargs.items()
                    if name not in {"secret_key", "idempotency_key"}
                }
            if first_call:
                first_http_started.set()
                assert release_http.wait(timeout=12), "First provider response was not released"
            else:
                another_http_started.set()
            return dict(session)

        def retrieve_session(self, *, secret_key, session_id):
            with fake_lock:
                session = next(value for value in remote_sessions.values()
                               if value["id"] == session_id)
                return dict(session)

    monkeypatch.setattr(service, "checkout_client", StripeWithOneObjectPerKey())

    def checkout(owner):
        with Session(kova_app_engine) as db:
            application = f"checkout-race-{owner.hex}"

            @event.listens_for(db, "after_begin")
            def identify_transaction(session, transaction, connection):
                # NullPool gives a new backend PID after each durable commit.
                connection.execute(text(
                    "SELECT set_config('application_name',:name,true)"
                ), {"name": application})

            set_tenant_context(db, tenant)
            db.execute(text("SET LOCAL lock_timeout='10s'"))
            assert db.execute(text("SELECT current_user")).scalar_one() == "kova_app"
            backend_actors.put(application)
            start.wait(timeout=10)
            return service.create_checkout_session(
                db, tenant_id=tenant, user_id=owner, idempotency_key=f"tab-{uuid4()}",
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(checkout, owner) for owner in owners]
        try:
            actors = [backend_actors.get(timeout=10), backend_actors.get(timeout=10)]
            assert first_http_started.wait(timeout=10)
            overlapped = False
            deadline = monotonic() + 6
            with owner_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
                while monotonic() < deadline:
                    for future in futures:
                        if future.done():
                            future.result()  # Surface runtime failures instead of hiding them as a wait.
                    if another_http_started.is_set():
                        overlapped = True
                        break
                    waiting = conn.execute(text(
                        "SELECT count(*) FROM pg_stat_activity "
                        "WHERE application_name=ANY(:actors) AND wait_event_type='Lock'"
                    ), {"actors": actors}).scalar_one()
                    if waiting:
                        overlapped = True
                        break
            assert overlapped, "Requests did not overlap at the provider or PostgreSQL lock"
        finally:
            release_http.set()
        results = [future.result(timeout=12) for future in futures]

    assert all(status in {200, 201} for status, _ in results)
    assert results[0][1] == results[1][1]
    assert len(remote_sessions) == 1
    assert len({call["idempotency_key"] for call in calls}) == 1
    assert len({call["user_id"] for call in calls}) == 1
    assert durable_snapshots and durable_snapshots[0].status == "uncertain"
    with owner_engine.connect() as conn:
        assert conn.execute(text(
            "SELECT count(*) FROM billing_checkout_attempts WHERE tenant_id=:tenant"
        ), {"tenant": tenant}).scalar_one() == 1
        assert conn.execute(text(
            "SELECT stripe_session_id FROM billing_checkout_attempts WHERE tenant_id=:tenant"
        ), {"tenant": tenant}).scalar_one() == results[0][1]["checkout_session_id"]

    # Runtime RLS, rather than application filtering, protects the durable provider payload.
    with Session(kova_app_engine) as db:
        set_tenant_context(db, other_tenant)
        assert db.execute(text(
            "SELECT count(*) FROM billing_checkout_attempts WHERE tenant_id=:tenant"
        ), {"tenant": tenant}).scalar_one() == 0
        with pytest.raises(DBAPIError, match="row-level security"), db.begin_nested():
            db.execute(text(
                "INSERT INTO billing_checkout_attempts(id,tenant_id,request_payload,"
                "credential_fingerprint,billing_cohort,status,created_at) "
                "VALUES(:id,:tenant,CAST(:payload AS json),:fingerprint,'standard','uncertain',now())"
            ), {"id": uuid4(), "tenant": tenant, "payload": json.dumps({}),
                "fingerprint": "a" * 64})
