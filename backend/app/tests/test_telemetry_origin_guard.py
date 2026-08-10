"""The anonymous funnel endpoint only accepts writes from our own front end.

Regression cover for the contamination described in
``docs/audits/DIAGNOSTICO-CRECIMIENTO-2026-08-09.md``: production accumulated
~48 ``signup_completed`` events in 30 days against 2 accounts actually created,
because any client could post a well-formed funnel event. Two independent
guards now stand in the way — an Origin check, and moving the conversion rung to
the server — and both are exercised here.
"""
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app as fastapi_app
from app.telemetry.models import AnonymousTelemetryEvent

ANON_URL = "/api/v1/telemetry/events/anonymous"
SIGNUP_URL = "/api/v1/auth/signup"


def _landing_event(client_event_id: str = "landing:1") -> dict:
    return {
        "event_name": "landing_viewed",
        "client_event_id": client_event_id,
        "client_id": "visitor-origin",
        "properties": {"path": "/", "device_class": "mobile"},
    }


def _raw_client() -> TestClient:
    """A client that sends exactly the headers a test gives it.

    The shared `client` fixture mirrors a browser by attaching Origin
    automatically, which is what we want everywhere else and precisely what we
    must not have when testing the guard itself.
    """
    raw = TestClient(fastapi_app, raise_server_exceptions=True)
    raw._disable_auto_csrf = True  # type: ignore[attr-defined]
    return raw


def test_accepts_events_from_the_configured_front_end(client, db):
    response = client.post(ANON_URL, json=_landing_event())

    assert response.status_code == 202, response.text
    assert db.query(AnonymousTelemetryEvent).count() == 1


def test_accepts_the_www_sibling_of_the_configured_origin(db):
    # kovasuite.com and www.kovasuite.com both resolve to the landing; dropping
    # one of them would silently halve the funnel.
    scheme, _, host = settings.frontend_url.partition("://")
    response = _raw_client().post(
        ANON_URL,
        json=_landing_event("landing:www"),
        headers={"origin": f"{scheme}://www.{host}"},
    )

    assert response.status_code == 202, response.text
    assert db.query(AnonymousTelemetryEvent).count() == 1


def test_rejects_events_with_no_origin_at_all(db):
    # The shape a naive script produces: correct JSON, no browser context.
    response = _raw_client().post(ANON_URL, json=_landing_event("landing:naked"))

    assert response.status_code == 403
    assert db.query(AnonymousTelemetryEvent).count() == 0


def test_rejects_events_from_a_foreign_origin(db):
    response = _raw_client().post(
        ANON_URL,
        json=_landing_event("landing:foreign"),
        headers={"origin": "https://not-kova.example"},
    )

    assert response.status_code == 403
    assert db.query(AnonymousTelemetryEvent).count() == 0


def test_falls_back_to_referer_when_origin_is_absent(db):
    # Referrer-Policy variations can strip Origin on some navigations; the host
    # of a same-site Referer is still evidence of a real page.
    response = _raw_client().post(
        ANON_URL,
        json=_landing_event("landing:referer"),
        headers={"referer": f"{settings.frontend_url}/precio"},
    )

    assert response.status_code == 202, response.text
    assert db.query(AnonymousTelemetryEvent).count() == 1


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
    assert db.query(AnonymousTelemetryEvent).count() == 0


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

    events = db.query(AnonymousTelemetryEvent).all()
    assert [event.event_name for event in events] == ["signup_completed"]
    assert events[0].client_id == "visitor-real"
    assert events[0].ingest_source == "server"
    assert events[0].is_trusted is True


def test_signup_still_records_the_conversion_without_a_stitching_id(client, db):
    # localStorage can be blocked. We lose the attribution join, never the count.
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

    events = db.query(AnonymousTelemetryEvent).all()
    assert [event.event_name for event in events] == ["signup_completed"]
    assert events[0].client_id.startswith("server:")


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
    assert db.query(AnonymousTelemetryEvent).count() == 0
