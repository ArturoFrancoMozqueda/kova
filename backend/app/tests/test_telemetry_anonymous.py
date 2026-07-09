"""Tests for the unauthenticated pre-auth telemetry path.

Covers the security posture that lets this endpoint be unauthenticated safely:
only allowlisted event types are accepted, no tenant/user identity can be
smuggled in, the payload is bounded, and the authenticated path is untouched.
"""
from app.telemetry.models import AnonymousTelemetryEvent
from app.telemetry.schemas import MAX_PROPERTIES

ANON_URL = "/api/v1/telemetry/events/anonymous"


def test_accepts_allowlisted_anonymous_event(client, db):
    resp = client.post(
        ANON_URL,
        json={
            "event_name": "landing_viewed",
            "client_event_id": "landing_viewed:1",
            "client_id": "visitor-abc",
            "properties": {"path": "/"},
        },
    )
    assert resp.status_code == 202
    assert resp.json() == {"accepted": True}

    rows = db.query(AnonymousTelemetryEvent).filter_by(client_id="visitor-abc").all()
    assert len(rows) == 1
    row = rows[0]
    assert row.event_name == "landing_viewed"
    # The table has no tenant/user columns at all — anonymous rows are non-tenant
    # by construction.
    assert not hasattr(row, "tenant_id")
    assert not hasattr(row, "user_id")


def test_rejects_non_allowlisted_event_type(client):
    resp = client.post(
        ANON_URL,
        json={
            "event_name": "first_sale_completed",  # authed-only event, not allowed
            "client_event_id": "x:1",
            "client_id": "visitor-abc",
            "properties": {},
        },
    )
    assert resp.status_code == 422


def test_rejects_tenant_field_in_properties(client):
    resp = client.post(
        ANON_URL,
        json={
            "event_name": "landing_cta_clicked",
            "client_event_id": "cta:1",
            "client_id": "visitor-abc",
            "properties": {"tenant_id": "11111111-1111-1111-1111-111111111111"},
        },
    )
    assert resp.status_code == 422


def test_rejects_unknown_top_level_field(client):
    # StrictModel forbids extra fields — a client cannot attach tenant_id/user_id
    # at the top level to try to influence storage.
    resp = client.post(
        ANON_URL,
        json={
            "event_name": "landing_viewed",
            "client_event_id": "landing_viewed:2",
            "client_id": "visitor-abc",
            "tenant_id": "11111111-1111-1111-1111-111111111111",
            "properties": {},
        },
    )
    assert resp.status_code == 422


def test_rejects_oversized_property_blob(client):
    resp = client.post(
        ANON_URL,
        json={
            "event_name": "landing_viewed",
            "client_event_id": "landing_viewed:3",
            "client_id": "visitor-abc",
            "properties": {str(i): i for i in range(MAX_PROPERTIES + 1)},
        },
    )
    assert resp.status_code == 422


def test_duplicate_client_event_id_is_idempotent(client, db):
    body = {
        "event_name": "signup_started",
        "client_event_id": "signup_started:dup",
        "client_id": "visitor-dup",
        "properties": {},
    }
    first = client.post(ANON_URL, json=body)
    second = client.post(ANON_URL, json=body)
    assert first.status_code == 202
    assert second.status_code == 202
    rows = (
        db.query(AnonymousTelemetryEvent)
        .filter_by(client_event_id="signup_started:dup")
        .all()
    )
    assert len(rows) == 1


def test_anonymous_endpoint_requires_no_auth(client):
    # No session cookie is set on this fresh client; the endpoint still accepts.
    resp = client.post(
        ANON_URL,
        json={
            "event_name": "landing_viewed",
            "client_event_id": "landing_viewed:noauth",
            "client_id": "visitor-noauth",
            "properties": {},
        },
    )
    assert resp.status_code == 202
