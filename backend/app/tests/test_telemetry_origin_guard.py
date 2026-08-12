"""The anonymous funnel endpoint only accepts writes from our own front end.

Regression cover for the contamination described in
``docs/audits/DIAGNOSTICO-CRECIMIENTO-2026-08-09.md``: production accumulated
~48 ``signup_completed`` events in 30 days against 2 accounts actually created,
because any client could post a well-formed funnel event. Two independent
guards now stand in the way — an Origin check, and moving the conversion rung to
the server — and both are exercised here.

Assertions look at the rows *this test* produced rather than at table counts.
The suite shares one database and earlier modules leave anonymous events behind,
so an absolute count would be measuring the rest of the suite.
"""
from datetime import UTC, datetime, timedelta

import jwt
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app as fastapi_app
from app.telemetry.models import AnonymousTelemetryEvent

ANON_URL = "/api/v1/telemetry/events/anonymous"
ANON_SESSION_URL = "/api/v1/telemetry/events/anonymous/session"
SIGNUP_URL = "/api/v1/auth/signup"


def _landing_event(client_event_id: str = "landing:1") -> dict:
    return {
        "event_name": "landing_viewed",
        "client_event_id": client_event_id,
        "client_id": "visitor-origin",
        "properties": {"path": "/", "device_class": "mobile"},
    }


def _stored(db, client_event_id: str) -> AnonymousTelemetryEvent | None:
    return (
        db.query(AnonymousTelemetryEvent)
        .filter(AnonymousTelemetryEvent.client_event_id == client_event_id)
        .one_or_none()
    )


def _events_for_client(db, client_id: str) -> list[AnonymousTelemetryEvent]:
    return (
        db.query(AnonymousTelemetryEvent)
        .filter(AnonymousTelemetryEvent.client_id == client_id)
        .all()
    )


def _raw_client() -> TestClient:
    """A client that sends exactly the headers a test gives it.

    The shared `client` fixture mirrors a browser by attaching Origin
    automatically, which is what we want everywhere else and precisely what we
    must not have when testing the guard itself.
    """
    raw = TestClient(fastapi_app, raise_server_exceptions=True)
    raw._disable_auto_csrf = True  # type: ignore[attr-defined]
    return raw


def _anonymous_token(client: TestClient, client_id: str, *, headers=None) -> str:
    response = client.post(
        ANON_SESSION_URL,
        json={"client_id": client_id},
        headers=headers or {},
    )
    assert response.status_code == 200, response.text
    return response.json()["token"]


def _event_headers(token: str, *, origin: str | None = None, referer: str | None = None):
    headers = {"X-Kova-Anonymous-Token": token}
    if origin:
        headers["origin"] = origin
    if referer:
        headers["referer"] = referer
    return headers


def test_accepts_events_from_the_configured_front_end(client, db):
    token = _anonymous_token(client, "visitor-origin")
    response = client.post(
        ANON_URL,
        json=_landing_event("landing:trusted"),
        headers=_event_headers(token),
    )

    assert response.status_code == 202, response.text
    assert _stored(db, "landing:trusted") is not None


def test_accepts_the_www_sibling_of_the_configured_origin(db):
    # kovasuite.com and www.kovasuite.com both resolve to the landing; dropping
    # one of them would silently halve the funnel.
    scheme, _, host = settings.frontend_url.partition("://")
    raw = _raw_client()
    origin = f"{scheme}://www.{host}"
    token = _anonymous_token(raw, "visitor-origin", headers={"origin": origin})
    response = raw.post(
        ANON_URL,
        json=_landing_event("landing:www"),
        headers=_event_headers(token, origin=origin),
    )

    assert response.status_code == 202, response.text
    assert _stored(db, "landing:www") is not None


def test_rejects_events_with_no_origin_at_all(db):
    # The shape a naive script produces: correct JSON, no browser context.
    response = _raw_client().post(ANON_URL, json=_landing_event("landing:naked"))

    assert response.status_code == 403
    assert _stored(db, "landing:naked") is None


def test_rejects_events_from_a_foreign_origin(db):
    response = _raw_client().post(
        ANON_URL,
        json=_landing_event("landing:foreign"),
        headers={"origin": "https://not-kova.example"},
    )

    assert response.status_code == 403
    assert _stored(db, "landing:foreign") is None


def test_falls_back_to_referer_when_origin_is_absent(db):
    # Referrer-Policy variations can strip Origin on some navigations; the host
    # of a same-site Referer is still evidence of a real page.
    raw = _raw_client()
    referer = f"{settings.frontend_url}/precio"
    token = _anonymous_token(raw, "visitor-origin", headers={"referer": referer})
    response = raw.post(
        ANON_URL,
        json=_landing_event("landing:referer"),
        headers=_event_headers(token, referer=referer),
    )

    assert response.status_code == 202, response.text
    assert _stored(db, "landing:referer") is not None


def test_rejects_missing_anonymous_session(client, db):
    response = client.post(ANON_URL, json=_landing_event("landing:no-session"))

    assert response.status_code == 401
    assert _stored(db, "landing:no-session") is None


def test_rejects_anonymous_session_bound_to_another_client(client, db):
    token = _anonymous_token(client, "visitor-other")
    response = client.post(
        ANON_URL,
        json=_landing_event("landing:cross-client"),
        headers=_event_headers(token),
    )

    assert response.status_code == 401
    assert _stored(db, "landing:cross-client") is None


def test_rejects_expired_anonymous_session(client, db):
    expired = jwt.encode(
        {
            "sub": "visitor-origin",
            "purpose": "anonymous_telemetry",
            "exp": int((datetime.now(UTC) - timedelta(seconds=1)).timestamp()),
        },
        settings.secret_key,
        algorithm="HS256",
    )
    response = client.post(
        ANON_URL,
        json=_landing_event("landing:expired-session"),
        headers=_event_headers(expired),
    )

    assert response.status_code == 401
    assert _stored(db, "landing:expired-session") is None


def test_client_may_not_claim_its_own_signup_completion(client, db):
    response = client.post(
        ANON_URL,
        json={
            "event_name": "signup_completed",
            "client_event_id": "signup_completed:forged",
            "client_id": "visitor-forger",
            "properties": {"path": "/signup"},
        },
    )

    assert response.status_code == 422
    assert _events_for_client(db, "visitor-forger") == []


def test_signup_records_its_own_conversion_with_the_visitor_stitching_id(client, db):
    response = client.post(
        SIGNUP_URL,
        json={
            "email": "nueva@negocio.mx",
            "password": "S3cur3pass",
            "tenant_name": "Panadería Nueva",
            "accepted_terms": True,
        },
        headers={"X-Kova-Client-Id": "visitor-real"},
    )
    assert response.status_code == 201, response.text

    events = _events_for_client(db, "visitor-real")
    assert [event.event_name for event in events] == ["signup_completed"]
    assert events[0].ingest_source == "server"
    assert events[0].is_trusted is True


def test_signup_still_records_the_conversion_without_a_stitching_id(client, db):
    # localStorage can be blocked. We lose the attribution join, never the count.
    before = {
        event.id
        for event in db.query(AnonymousTelemetryEvent)
        .filter(AnonymousTelemetryEvent.event_name == "signup_completed")
        .all()
    }

    response = client.post(
        SIGNUP_URL,
        json={
            "email": "sin-id@negocio.mx",
            "password": "S3cur3pass",
            "tenant_name": "Café Sin Id",
            "accepted_terms": True,
        },
    )
    assert response.status_code == 201, response.text

    added = [
        event
        for event in db.query(AnonymousTelemetryEvent)
        .filter(AnonymousTelemetryEvent.event_name == "signup_completed")
        .all()
        if event.id not in before
    ]
    assert len(added) == 1
    assert added[0].client_id.startswith("server:")


def test_failed_signup_records_no_conversion(client, db):
    response = client.post(
        SIGNUP_URL,
        json={
            "email": "no-terms@negocio.mx",
            "password": "S3cur3pass",
            "tenant_name": "Sin Consentimiento",
            "accepted_terms": False,
        },
        headers={"X-Kova-Client-Id": "visitor-blocked"},
    )

    assert response.status_code == 400
    assert _events_for_client(db, "visitor-blocked") == []
