import json
import logging

from app.config import settings
from app.observability.logging import configure_logging
from app.observability.sentry import sanitize_sentry_event


def test_request_log_has_request_tenant_and_user_fields(client, capsys):
    configure_logging()

    response = client.get("/health", headers={"x-request-id": "test-request-id"})

    assert response.status_code == 200
    assert response.headers["x-request-id"] == "test-request-id"

    logging.shutdown()
    captured = capsys.readouterr().err
    log_lines = [line for line in captured.splitlines() if "http_request" in line]
    assert log_lines
    payload = json.loads(log_lines[-1])
    assert payload["request_id"] == "test-request-id"
    assert "tenant_id" in payload
    assert "user_id" in payload


def test_health_exposes_release_identity(client, monkeypatch):
    monkeypatch.setattr(settings, "kova_release_sha", "abc123")

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "release_sha": "abc123"}


def test_openapi_docs_endpoint_loads(client):
    response = client.get("/docs")

    assert response.status_code == 200
    assert "Swagger UI" in response.text


def test_json_logs_redact_message_values_and_omit_exception_detail(capsys):
    configure_logging()
    logger = logging.getLogger("app.test.redaction")
    email = "customer-canary@example.com"
    token = "synthetic-token-canary"
    customer_name = "Synthetic Customer Name"

    try:
        raise RuntimeError(f"constraint DETAIL contains {email} {token} {customer_name}")
    except RuntimeError:
        logger.exception("write failed email=%s token=%s", email, token)

    logging.shutdown()
    captured = capsys.readouterr().err
    assert email not in captured
    assert token not in captured
    assert customer_name not in captured
    payload = json.loads(captured.splitlines()[-1])
    assert payload["message"] == "write failed email=[redacted-email] token=[redacted]"
    assert payload["exception"]["type"] == "RuntimeError"
    assert payload["exception"]["frames"]


def test_sentry_event_redacts_exception_request_and_customer_canaries():
    canaries = {
        "email": "sentry-canary@example.com",
        "token": "sentry-token-canary",
        "name": "Sentry Customer Name",
        "reference": "private-reference-canary",
    }
    event = {
        "exception": {
            "values": [{
                "type": "IntegrityError",
                "value": " ".join(canaries.values()),
                "stacktrace": {"frames": [{"filename": "service.py", "lineno": 10}]},
            }]
        },
        "request": {
            "data": canaries,
            "headers": {"Authorization": "Bearer sentry-token-canary"},
        },
    }

    sanitized = sanitize_sentry_event(event)
    rendered = json.dumps(sanitized)
    assert all(value not in rendered for value in canaries.values())
    assert sanitized["exception"]["values"][0]["type"] == "IntegrityError"
    assert sanitized["exception"]["values"][0]["stacktrace"]["frames"]
