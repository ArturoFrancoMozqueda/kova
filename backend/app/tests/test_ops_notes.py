"""Internal ops dashboard — notes/triage persistence tests."""
import pytest
from sqlalchemy import text

from app.config import settings
from app.tests.test_ops_auth import _signup_login

# Password cost is incidental to these business scenarios; real auth routes stay active.
pytestmark = pytest.mark.usefixtures("fast_business_auth")

ADMIN = "notes-ceo@ops-test.com"


def _login_admin(client, monkeypatch, email=ADMIN, tenant="Ops Notes HQ"):
    monkeypatch.setattr(settings, "internal_admin_emails", email)
    _signup_login(client, email, tenant)


def test_create_and_list_incident_note(client, monkeypatch):
    _login_admin(client, monkeypatch)
    r = client.post(
        "/api/v1/internal/ops/notes",
        json={
            "entity_type": "incident",
            "entity_source": "stripe_webhook",
            "entity_external_id": "evt_123",
            "body": "Investigando el webhook fallido",
        },
    )
    assert r.status_code == 201
    note = r.json()
    assert note["author_email"] == ADMIN
    assert note["status"] == "open"
    assert note["pinned"] is False

    r = client.get(
        "/api/v1/internal/ops/notes",
        params={"entity_source": "stripe_webhook", "entity_external_id": "evt_123"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == note["id"]


def test_incident_note_requires_source_and_external_id(client, monkeypatch):
    _login_admin(client, monkeypatch, "notes-ceo2@ops-test.com", "Ops Notes HQ 2")
    r = client.post(
        "/api/v1/internal/ops/notes",
        json={"entity_type": "incident", "body": "sin referencia"},
    )
    assert r.status_code == 422


def test_tenant_note_requires_tenant_id(client, monkeypatch):
    _login_admin(client, monkeypatch, "notes-ceo3@ops-test.com", "Ops Notes HQ 3")
    r = client.post(
        "/api/v1/internal/ops/notes",
        json={"entity_type": "tenant", "body": "sin tenant"},
    )
    assert r.status_code == 422


def test_patch_note_updates_and_audits(client, db, monkeypatch):
    _login_admin(client, monkeypatch, "notes-ceo4@ops-test.com", "Ops Notes HQ 4")
    r = client.post(
        "/api/v1/internal/ops/notes",
        json={"entity_type": "general", "body": "pendiente revisar métricas"},
    )
    assert r.status_code == 201
    note_id = r.json()["id"]

    r = client.patch(
        f"/api/v1/internal/ops/notes/{note_id}",
        json={"status": "resolved", "pinned": True},
    )
    assert r.status_code == 200
    updated = r.json()
    assert updated["status"] == "resolved"
    assert updated["pinned"] is True
    assert updated["body"] == "pendiente revisar métricas"

    actions = [
        row[0]
        for row in db.execute(
            text(
                "SELECT action FROM audit_logs WHERE resource_type = 'ops_note' "
                "AND resource_id = :note_id ORDER BY created_at"
            ),
            {"note_id": note_id},
        )
    ]
    assert actions == ["ops_note_created", "ops_note_updated"]


def test_patch_requires_some_change(client, monkeypatch):
    _login_admin(client, monkeypatch, "notes-ceo5@ops-test.com", "Ops Notes HQ 5")
    r = client.post(
        "/api/v1/internal/ops/notes",
        json={"entity_type": "general", "body": "nota"},
    )
    note_id = r.json()["id"]
    r = client.patch(f"/api/v1/internal/ops/notes/{note_id}", json={})
    assert r.status_code == 422


def test_patch_unknown_note_404(client, monkeypatch):
    _login_admin(client, monkeypatch, "notes-ceo6@ops-test.com", "Ops Notes HQ 6")
    r = client.patch(
        "/api/v1/internal/ops/notes/00000000-0000-0000-0000-000000000000",
        json={"status": "archived"},
    )
    assert r.status_code == 404


def test_delete_not_allowed(client, monkeypatch):
    _login_admin(client, monkeypatch, "notes-ceo7@ops-test.com", "Ops Notes HQ 7")
    r = client.post(
        "/api/v1/internal/ops/notes",
        json={"entity_type": "general", "body": "no borrable"},
    )
    note_id = r.json()["id"]
    r = client.delete(f"/api/v1/internal/ops/notes/{note_id}")
    assert r.status_code == 405


def test_post_without_csrf_is_rejected(db, monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    monkeypatch.setattr(settings, "internal_admin_emails", "notes-ceo8@ops-test.com")
    raw = TestClient(app, raise_server_exceptions=True)
    _signup_login(raw, "notes-ceo8@ops-test.com", "Ops Notes HQ 8")
    raw._disable_auto_csrf = True
    r = raw.post(
        "/api/v1/internal/ops/notes",
        json={"entity_type": "general", "body": "sin csrf"},
    )
    assert r.status_code == 403
    assert r.json().get("detail") == "CSRF validation failed"


def test_notes_require_allowlist(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_admin_emails", "someone-else@ops-test.com")
    _signup_login(client, "notes-owner@ops-test.com", "Ops Notes Tenant")
    assert client.get("/api/v1/internal/ops/notes").status_code == 403
    r = client.post(
        "/api/v1/internal/ops/notes",
        json={"entity_type": "general", "body": "no debería entrar"},
    )
    assert r.status_code == 403
