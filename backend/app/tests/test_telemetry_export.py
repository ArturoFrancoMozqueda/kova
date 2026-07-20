import csv
import io

from app.config import settings


def _signup_and_login(client) -> None:
    signup = client.post(
        "/api/v1/auth/signup",
        json={
            "email": "cro-export@example.com",
            "password": "S3cur3pass!",
            "tenant_name": "Negocio CRO",
            "accepted_terms": True,
        },
    )
    assert signup.status_code == 201, signup.text
    token = signup.json()["dev_verification_token"]
    assert client.post("/api/v1/auth/verify", json={"token": token}).status_code == 200
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "cro-export@example.com", "password": "S3cur3pass!"},
    )
    assert login.status_code == 200, login.text


def test_cro_export_requires_internal_key(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_api_key", "cro-secret")
    assert client.get("/api/v1/telemetry/internal/cro-export").status_code == 403
    assert (
        client.get(
            "/api/v1/telemetry/internal/cro-export",
            headers={"X-Internal-Key": "wrong"},
        ).status_code
        == 403
    )


def test_cro_export_joins_anonymous_and_authenticated_by_client_id(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_api_key", "cro-secret")
    client_id = "cro-client-123"
    common = {
        "device_class": "mobile",
        "viewport_bucket": "mobile_390",
        "source": "google",
        "medium": "cpc",
        "campaign": "julio-pos",
    }
    anonymous = client.post(
        "/api/v1/telemetry/events/anonymous",
        json={
            "event_name": "signup_completed",
            "client_event_id": "signup_completed:export",
            "client_id": client_id,
            "properties": {**common, "path": "/signup", "cta": "hero"},
        },
    )
    assert anonymous.status_code == 202, anonymous.text

    _signup_and_login(client)
    authenticated = client.post(
        "/api/v1/telemetry/events",
        json={
            "event_name": "first_sale_completed",
            "client_event_id": "first_sale_completed:export",
            "properties": {**common, "client_id": client_id, "path": "/register"},
        },
    )
    assert authenticated.status_code == 202, authenticated.text

    response = client.get(
        "/api/v1/telemetry/internal/cro-export",
        headers={"X-Internal-Key": "cro-secret"},
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(response.text)))
    client_rows = [row for row in rows if row["client_id"] == client_id]
    assert {row["event"] for row in client_rows} == {
        "signup_completed",
        "first_sale_completed",
    }
    assert {row["conversion_state"] for row in client_rows} == {"activated"}
    assert {row["device_class"] for row in client_rows} == {"mobile"}
    assert "tenant_id" not in rows[0]
    assert "user_id" not in rows[0]
    assert "total_amount" not in rows[0]
