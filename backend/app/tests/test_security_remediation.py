import asyncio
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app import db
from app.config import settings
from app.main import _validate_config
from app.middleware.body_size import MAX_REQUEST_BYTES, BodySizeLimitMiddleware
from app.middleware.rate_limit import _get_client_ip


def _complete_posture():
    return {
        table: (True, spec[1], spec[3], spec[4])
        for table, spec in db.EXPECTED_RLS_POLICY_SPECS.items()
    }


def _complete_policy_catalog():
    catalog = {}
    for table, (
        name,
        _force,
        command,
        has_using,
        has_check,
        expected_expression,
    ) in db.EXPECTED_RLS_POLICY_SPECS.items():
        using_expression = None
        check_expression = None
        if has_using:
            using_expression = expected_expression
        if has_check:
            check_expression = expected_expression
        catalog[table] = [
            (
                name,
                True,
                command,
                (0,),
                has_using,
                has_check,
                using_expression,
                check_expression,
            )
        ]
    for table, spec in db.EXPECTED_ADDITIONAL_RLS_POLICY_SPECS.items():
        catalog[table].append(
            (
                spec[0],
                spec[1],
                spec[2],
                spec[3],
                spec[4],
                spec[5],
                spec[6] if spec[4] else None,
                spec[6] if spec[5] else None,
            )
        )
    return catalog


def test_rls_posture_accepts_non_owner_non_bypass_role():
    assert (
        db._rls_posture_errors(
            role_is_super=False,
            role_bypasses_rls=False,
            owned_tables=set(),
            table_posture=_complete_posture(),
        )
        == []
    )


@pytest.mark.parametrize(
    ("changes", "expected"),
    [
        ({"role_is_super": True}, "superuser"),
        ({"role_bypasses_rls": True}, "BYPASSRLS"),
        ({"owned_tables": {"products"}}, "owns tenant tables"),
    ],
)
def test_rls_posture_rejects_privileged_runtime_role(changes, expected):
    values = {
        "role_is_super": False,
        "role_bypasses_rls": False,
        "owned_tables": set(),
        "table_posture": _complete_posture(),
        **changes,
    }
    assert expected in " ".join(db._rls_posture_errors(**values))


@pytest.mark.parametrize(
    ("posture", "expected"),
    [
        ((True, False, True, True), "FORCE RLS"),
        ((True, True, False, True), "policy USING"),
        ((True, True, True, False), "policy WITH CHECK"),
    ],
)
def test_rls_posture_rejects_incomplete_table(posture, expected):
    tables = _complete_posture()
    tables["products"] = posture
    errors = db._rls_posture_errors(
        role_is_super=False,
        role_bypasses_rls=False,
        owned_tables=set(),
        table_posture=tables,
    )
    assert any("products" in error and expected in error for error in errors)


def test_rls_posture_rejects_missing_canonical_table():
    tables = _complete_posture()
    del tables["products"]
    errors = db._rls_posture_errors(
        role_is_super=False,
        role_bypasses_rls=False,
        owned_tables=set(),
        table_posture=tables,
    )
    assert "products: table missing" in errors


def test_rls_posture_rejects_an_additional_permissive_policy():
    policies = _complete_policy_catalog()
    policies["products"].append(("allow_everything", True, "*", (0,), True, True, "true", "true"))
    errors = db._rls_posture_errors(
        role_is_super=False,
        role_bypasses_rls=False,
        owned_tables=set(),
        table_posture=_complete_posture(),
        policy_catalog=policies,
    )
    assert "products: unexpected permissive policies allow_everything" in errors


@pytest.mark.parametrize("table", ["tenants", "users", "anonymous_telemetry_events"])
def test_rls_posture_rejects_additional_permissive_policy_on_special_runtime_table(table):
    policies = _complete_policy_catalog()
    policies[table].append(("allow_everything", True, "*", (0,), True, True, "true", "true"))
    errors = db._rls_posture_errors(
        role_is_super=False,
        role_bypasses_rls=False,
        owned_tables=set(),
        table_posture=_complete_posture(),
        policy_catalog=policies,
    )
    assert f"{table}: unexpected permissive policies allow_everything" in errors


@pytest.mark.parametrize(
    "policy",
    [
        ("tenant_isolation", False, "*", (0,), True, True, "true", "true"),
        ("tenant_isolation", True, "r", (0,), True, True, "true", "true"),
        ("tenant_isolation", True, "*", (123,), True, True, "true", "true"),
    ],
)
def test_rls_posture_rejects_an_unsafe_canonical_policy(policy):
    policies = _complete_policy_catalog()
    policies["products"] = [policy]
    errors = db._rls_posture_errors(
        role_is_super=False,
        role_bypasses_rls=False,
        owned_tables=set(),
        table_posture=_complete_posture(),
        policy_catalog=policies,
    )
    assert "products: canonical policy has unsafe scope" in errors


def test_rls_posture_rejects_an_unscoped_canonical_expression():
    policies = _complete_policy_catalog()
    policies["products"] = [("tenant_isolation", True, "*", (0,), True, True, "true", "true")]
    errors = db._rls_posture_errors(
        role_is_super=False,
        role_bypasses_rls=False,
        owned_tables=set(),
        table_posture=_complete_posture(),
        policy_catalog=policies,
    )
    assert "products: canonical policy has unsafe expression" in errors


def test_rls_posture_rejects_an_unsafe_tenant_name_update_policy():
    policies = _complete_policy_catalog()
    policies["tenants"][-1] = (
        "current_tenant_name_update",
        True,
        "w",
        (0,),
        True,
        True,
        "true",
        "true",
    )
    errors = db._rls_posture_errors(
        role_is_super=False,
        role_bypasses_rls=False,
        owned_tables=set(),
        table_posture=_complete_posture(),
        policy_catalog=policies,
    )
    assert "tenants: current_tenant_name_update policy has unsafe scope" in errors


def test_rls_check_fails_closed_on_database_error_in_production(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(db.engine, "connect", MagicMock(side_effect=OSError("unreachable")))
    with pytest.raises(RuntimeError, match="Could not verify RLS posture"):
        db.assert_rls_active()


def test_production_requires_explicit_distinct_runtime_database_url(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "secret_key", "a-secure-non-default-key")
    monkeypatch.setattr(settings, "app_database_url", None)
    with pytest.raises(RuntimeError, match="APP_DATABASE_URL must be set"):
        _validate_config()

    owner_url = "postgresql+psycopg://owner:hidden@db.example/postgres"
    monkeypatch.setattr(settings, "app_database_url", owner_url)
    monkeypatch.setattr(settings, "migration_database_url", owner_url)
    with pytest.raises(RuntimeError, match="must differ"):
        _validate_config()


def _body_limit_client():
    app = FastAPI()
    app.add_middleware(BodySizeLimitMiddleware)

    @app.post("/")
    async def sink(request: Request):
        return {"size": len(await request.body())}

    return TestClient(app)


@pytest.mark.parametrize("content_type", ["application/json", "multipart/form-data; boundary=kova"])
def test_streaming_body_without_content_length_is_counted_across_chunks(content_type):
    response = _body_limit_client().post(
        "/",
        content=(chunk for chunk in (b"x" * MAX_REQUEST_BYTES, b"x")),
        headers={"content-type": content_type},
    )
    assert response.status_code == 413


def test_streaming_body_exactly_at_limit_is_allowed():
    response = _body_limit_client().post(
        "/", content=(chunk for chunk in (b"x" * MAX_REQUEST_BYTES,))
    )
    assert response.status_code == 200


@pytest.mark.parametrize("value", [b"invalid", b"-1"])
def test_invalid_content_length_is_rejected(value):
    response = _body_limit_client().post("/", content=b"", headers={"content-length": value})
    assert response.status_code == 400


def test_client_disconnect_message_is_preserved():
    observed = []

    async def app(_scope, receive, _send):
        observed.append(await receive())

    async def receive():
        return {"type": "http.disconnect"}

    async def send(_message):
        raise AssertionError("disconnect must not become an HTTP response")

    scope = {"type": "http", "method": "POST", "path": "/", "headers": []}
    asyncio.run(BodySizeLimitMiddleware(app)(scope, receive, send))
    assert observed == [{"type": "http.disconnect"}]


def _fake_request(*, headers=None, host="203.0.113.9"):
    request = MagicMock()
    request.headers = headers or {}
    request.client.host = host
    return request


def test_client_ip_ignores_spoofed_x_forwarded_for():
    request = _fake_request(headers={"x-forwarded-for": "198.51.100.1"})
    assert _get_client_ip(request) == "203.0.113.9"


def test_client_ip_uses_fly_edge_header_and_normalizes_ipv6():
    request = _fake_request(headers={"fly-client-ip": "2001:0db8:0:0:0:0:0:1"})
    assert _get_client_ip(request) == "2001:db8::1"


def test_invalid_trusted_header_falls_back_to_socket_peer():
    request = _fake_request(headers={"fly-client-ip": "not-an-ip"})
    assert _get_client_ip(request) == "203.0.113.9"


def test_ipv4_mapped_ipv6_shares_ipv4_bucket():
    request = _fake_request(headers={"fly-client-ip": "::ffff:192.0.2.1"})
    assert _get_client_ip(request) == "192.0.2.1"
