import json
import logging

from app.observability.logging import configure_logging


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


def test_openapi_docs_endpoint_loads(client):
    response = client.get("/docs")

    assert response.status_code == 200
    assert "Swagger UI" in response.text
