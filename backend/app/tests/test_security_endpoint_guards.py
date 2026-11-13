"""Constant-time internal keys, CSV formula escaping and the lot snapshot gate."""

import csv
import io
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from app.config import settings
from app.rbac import permissions as rbac
from app.telemetry import export
from app.telemetry.models import AnonymousTelemetryEvent

INTERNAL_ROUTES = [
    ("GET", "/api/v1/billing/internal/subscriptions", None),
    ("POST", "/api/v1/billing/internal/reconcile", {"limit": 1}),
    ("POST", "/api/v1/account/internal/deletions/purge", None),
]


@pytest.mark.parametrize(("method", "path", "body"), INTERNAL_ROUTES)
def test_internal_key_rejects_missing_wrong_and_non_ascii(client, monkeypatch, method, path, body):
    monkeypatch.setattr(settings, "internal_api_key", "internal-secret")
    for headers in (
        {},
        {"X-Internal-Key": ""},
        {"X-Internal-Key": "internal-secreT"},
        # Non-ASCII must be a clean 403, never a TypeError from compare_digest(str).
        {"X-Internal-Key": "clé-interna".encode()},
    ):
        response = client.request(method, path, json=body, headers=headers)
        assert response.status_code == 403, (headers, response.text)


@pytest.mark.parametrize(("method", "path", "body"), INTERNAL_ROUTES)
def test_internal_key_unset_on_server_always_rejects(client, monkeypatch, method, path, body):
    monkeypatch.setattr(settings, "internal_api_key", None)
    response = client.request(method, path, json=body, headers={"X-Internal-Key": ""})
    assert response.status_code == 403


@pytest.mark.parametrize(("method", "path", "body"), INTERNAL_ROUTES)
def test_internal_key_valid_is_accepted(client, monkeypatch, method, path, body):
    monkeypatch.setattr(settings, "internal_api_key", "internal-secret")
    response = client.request(method, path, json=body, headers={"X-Internal-Key": "internal-secret"})
    assert response.status_code == 200, response.text


# ── CSV formula injection ─────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "value",
    ["=HYPERLINK(\"x\")", "+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd", "  =1+1"],
)
def test_csv_safe_neutralizes_formula_prefixes(value):
    assert export._csv_safe(value) == f"'{value}"


@pytest.mark.parametrize("value", ["google", "", "julio-pos", "2026-11-13T00:00:00+00:00"])
def test_csv_safe_keeps_plain_text(value):
    assert export._csv_safe(value) == value


def test_cro_export_escapes_visitor_supplied_cells(db):
    client_id = f"=cmd|'/c calc'!A0-{uuid4().hex}"
    db.add(
        AnonymousTelemetryEvent(
            event_name="landing_viewed",
            client_event_id=f"landing:{uuid4().hex}",
            client_id=client_id,
            properties={"campaign": "=HYPERLINK(\"https://evil\")", "source": "@x", "cta": "hero"},
            created_at=datetime.now(UTC),
        )
    )
    db.flush()
    rows = list(csv.DictReader(io.StringIO(export.build_cro_export(db, days=1))))
    row = next(r for r in rows if r["client_id"] == f"'{client_id}")
    assert row["campaign"] == "'=HYPERLINK(\"https://evil\")"
    assert row["source"] == "'@x"
    assert row["cta"] == "hero"


# ── Lot snapshot permission ──────────────────────────────────────────────────


def _signup_and_login(client) -> None:
    email = f"lots-{uuid4().hex}@example.com"
    signup = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "S3cur3pass!", "tenant_name": "Lotes", "accepted_terms": True},
    )
    assert signup.status_code == 201, signup.text
    assert client.post(
        "/api/v1/auth/login", json={"email": email, "password": "S3cur3pass!"}
    ).status_code == 200


def test_lot_snapshot_requires_selling_permission(client, monkeypatch):
    _signup_and_login(client)
    assert client.post("/api/v1/inventory/lots/snapshot", json={"client_uuids": []}).status_code == 200
    assert client.get("/api/v1/inventory/lots/snapshot").status_code == 200

    monkeypatch.setitem(
        rbac.ROLE_PERMISSIONS, "owner", set(rbac.Permission) - {rbac.Permission.ORDERS_CREATE}
    )
    assert client.post("/api/v1/inventory/lots/snapshot", json={"client_uuids": []}).status_code == 403
    assert client.get("/api/v1/inventory/lots/snapshot").status_code == 403


def test_every_selling_role_can_read_lot_snapshot():
    for role in ("owner", "manager", "cashier", "staff"):
        assert rbac.has_permission(role, rbac.Permission.ORDERS_CREATE), role
