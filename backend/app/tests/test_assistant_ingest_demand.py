"""Real PostgreSQL/RLS demand probes: no document contents leave their ACL scope."""

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from app.assistant import ingest_demand as demand
from app.assistant.models import now
from app.config import settings


@pytest.fixture
def queued_host(owner_engine, kova_app_engine, monkeypatch):
    tenant, foreign, user, document = (uuid4() for _ in range(4))
    with owner_engine.begin() as db:
        for tid in (tenant, foreign):
            db.execute(text("INSERT INTO tenants(id,name,slug) VALUES (:id,'Demand test',:slug)"),
                       {"id": tid, "slug": str(tid)})
        db.execute(text("INSERT INTO users(id,email,hashed_password) VALUES (:id,:email,'test')"),
                   {"id": user, "email": str(user) + "@example.com"})
        db.execute(text("INSERT INTO memberships(id,tenant_id,user_id,role) "
                        "VALUES (:id,:tenant,:user,'owner')"),
                   {"id": uuid4(), "tenant": tenant, "user": user})
        db.execute(text("INSERT INTO assistant_records(id,tenant_id,owner_user_id,branch_id,"
                        "kind,status,data) VALUES "
                        "(:id,:tenant,:user,:tenant,'document','queued','{}')"),
                   {"id": document, "tenant": tenant, "user": user})
    monkeypatch.setattr(settings, "assistant_enabled", True)
    monkeypatch.setattr(settings, "assistant_documents_enabled", True)
    monkeypatch.setattr(settings, "assistant_tenant_ids", str(tenant))
    monkeypatch.setattr(demand, "SessionLocal", sessionmaker(bind=kova_app_engine))
    monkeypatch.setattr(demand.storage, "ready", lambda: True)
    monkeypatch.setattr(demand.storage, "tenant_deleted", lambda _: False)
    monkeypatch.setattr(demand.provider, "cloudflare_ready", lambda: True)
    monkeypatch.setattr(demand, "get_billing_access_status",
                        lambda *args, **kwargs: SimpleNamespace(allowed=True))
    try:
        yield tenant, foreign, user, document, owner_engine
    finally:
        with owner_engine.begin() as db:
            db.execute(text("DELETE FROM tenants WHERE id=ANY(:ids)"), {"ids": [tenant, foreign]})
            db.execute(text("DELETE FROM users WHERE id=:id"), {"id": user})


@pytest.mark.parametrize("status,due,age,expected", [
    ("queued", None, 0, True), ("ready", None, 0, False),
    ("failed", None, 0, False), ("uploading", None, 0, False),
    ("deferred", -60, 0, True), ("deferred", 600, 0, False),
    ("deferred", None, 0, False),
    ("running", None, 0, False), ("running", None, 720, True),
    ("indexing", None, 0, False), ("indexing", None, 720, True),
])
def test_due_and_interrupted_jobs_wake_but_completed_and_future_jobs_do_not(
    queued_host, status, due, age, expected,
):
    _, _, _, identifier, engine = queued_host
    with engine.begin() as db:
        db.execute(text("UPDATE assistant_records SET status=:status,updated_at=:updated,"
                        "data=jsonb_build_object('retry_at',CAST(:due AS text)) WHERE id=:id"),
                   {"id": identifier, "status": status, "updated": now() - timedelta(seconds=age),
                    "due": (now() + timedelta(seconds=due)).isoformat()
                    if due is not None else None})
    assert demand.has_work() is expected


def test_foreign_cohort_and_inactive_or_branch_restricted_users_do_not_wake(
    queued_host, monkeypatch,
):
    tenant, foreign, user, _, engine = queued_host
    assert demand.has_work()
    monkeypatch.setattr(settings, "assistant_tenant_ids", str(foreign))
    assert not demand.has_work()
    monkeypatch.setattr(settings, "assistant_tenant_ids", str(tenant))
    with engine.begin() as db:
        db.execute(text("UPDATE memberships SET allowed_branch_id=:tenant WHERE user_id=:user"),
                   {"tenant": tenant, "user": user})
    assert not demand.has_work()
    with engine.begin() as db:
        db.execute(text("UPDATE memberships SET allowed_branch_id=NULL WHERE user_id=:user"),
                   {"user": user})
        db.execute(text("UPDATE users SET is_active=false WHERE id=:user"), {"user": user})
    assert not demand.has_work()


def test_billing_pause_and_provider_pause_do_not_wake(queued_host, monkeypatch):
    assert demand.has_work()
    monkeypatch.setattr(demand, "get_billing_access_status",
                        lambda *args, **kwargs: SimpleNamespace(allowed=False))
    assert not demand.has_work()
    monkeypatch.setattr(demand, "get_billing_access_status",
                        lambda *args, **kwargs: SimpleNamespace(allowed=True))
    monkeypatch.setattr(demand.provider, "cloudflare_ready", lambda: False)
    assert not demand.has_work()


def test_empty_queue_makes_no_storage_requests(queued_host, monkeypatch):
    _, _, _, identifier, engine = queued_host
    with engine.begin() as db:
        db.execute(text("UPDATE assistant_records SET status='ready' WHERE id=:id"),
                   {"id": identifier})
    retired = Mock(side_effect=AssertionError("An empty queue must not call R2"))
    monkeypatch.setattr(demand.storage, "tenant_deleted", retired)
    assert not demand.has_work()
    retired.assert_not_called()
