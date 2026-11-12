"""Real PostgreSQL and authenticated HTTP; Meta I/O is always explicitly fake."""

import hashlib
import hmac
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from pydantic import SecretStr
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.models import Membership
from app.branches.scope import tenant_wide_branches
from app.config import settings
from app.messaging import credentials, delivery, onboarding
from app.messaging.models import ChannelBinding, ChannelConnection, Conversation, SignupSession
from app.messaging.schemas import SignupFinish
from app.messaging.signup_provider import SignupProvider
from app.messaging.whatsapp import ChannelError
from app.tests.test_catalog import _signup_verify_login
from app.tests.test_messaging_inbox import envelope

pytestmark = pytest.mark.usefixtures("fast_business_auth")
BASE = "/api/v1/messaging/onboarding"


@pytest.fixture
def configured(monkeypatch):
    for name, value in {
        "kova_whatsapp_enabled": True,
        "whatsapp_signup_enabled": True,
        "whatsapp_graph_api_version": "v25.0",
        "whatsapp_app_id": "123",
        "whatsapp_signup_config_id": "456",
        "whatsapp_app_secret": SecretStr("test-app-secret"),
        "whatsapp_webhook_verify_token": SecretStr("test-webhook-verify"),
        "whatsapp_credentials_key": SecretStr(Fernet.generate_key().decode()),
        "whatsapp_connections": None,
    }.items():
        monkeypatch.setattr(settings, name, value)


class FakeMeta:
    def __init__(self, *, fail=None):
        self.calls = []
        self.fail = fail

    def _call(self, stage):
        self.calls.append(stage)
        if stage == self.fail:
            raise ChannelError("meta_response_unknown", ambiguous=True)

    def exchange(self, code):
        self._call("exchange")
        assert code.get_secret_value() == "synthetic-exchange-code"
        return SecretStr("synthetic-merchant-token")

    def verify(self, token, waba, phone):
        self._call("verify")
        assert token.get_secret_value() == "synthetic-merchant-token"
        assert (waba, phone) == ("987", "654")
        return datetime.now(UTC) + timedelta(days=60)

    def subscribe(self, token, waba):
        self._call("subscribe")

    def register(self, token, phone, pin):
        self._call("register")
        assert len(pin) == 6 and pin.isdigit()


def begin(client):
    account = _signup_verify_login(client, f"wa-{uuid4().hex}@example.com", "Negocio WhatsApp")
    response = client.post(f"{BASE}/start", json={})
    assert response.status_code == 200, response.text
    body = {k: v for k, v in response.json().items() if k != "expires_at"}
    body.update(
        code="synthetic-exchange-code", waba_id="987", phone_number_id="654", event="FINISH"
    )
    return account, body


def test_happy_path_is_encrypted_scoped_and_replay_does_no_io(client, db, configured, monkeypatch):
    account, body = begin(client)
    meta = FakeMeta()
    monkeypatch.setattr(onboarding, "SignupProvider", lambda: meta)
    response = client.post(f"{BASE}/finish", json=body)
    assert response.status_code == 200, response.text
    assert response.json() == {
        "status": "connected",
        "send_enabled": False,
        "receive_enabled": True,
    }
    assert meta.calls == ["exchange", "verify", "subscribe", "register"]
    assert client.post(f"{BASE}/finish", json=body).json() == response.json()
    assert len(meta.calls) == 4
    connection = db.query(ChannelConnection).one()
    binding = db.query(ChannelBinding).filter_by(id=connection.binding_id).one()
    assert connection.tenant_id == UUID(account["tenant_id"])
    assert binding.branch_id == connection.tenant_id
    assert "synthetic-merchant-token" not in connection.encrypted_credentials
    assert db.query(SignupSession).one().encrypted_credentials is None
    assert (
        db.query(SignupSession).one().code_hash == hashlib.sha256(body["code"].encode()).hexdigest()
    )
    for path in [BASE, "/api/v1/messaging/connection", "/api/v1/messaging/readiness"]:
        result = client.get(path)
        assert result.status_code == 200
        assert not any(
            value in result.text
            for value in [body["code"], body["nonce"], "synthetic-merchant-token"]
        )


@pytest.mark.parametrize("stage", ["exchange", "verify", "subscribe", "register"])
def test_ambiguous_steps_are_journaled_and_never_replayed(
    client, db, configured, monkeypatch, stage
):
    _, body = begin(client)
    meta = FakeMeta(fail=stage)
    monkeypatch.setattr(onboarding, "SignupProvider", lambda: meta)
    assert client.post(f"{BASE}/finish", json=body).status_code == 409
    calls = list(meta.calls)
    assert client.post(f"{BASE}/finish", json=body).status_code == 409
    assert meta.calls == calls
    assert db.query(ChannelConnection).count() == 0
    assert db.query(ChannelBinding).count() == 0
    state = db.query(SignupSession).one().state
    assert state == ("review_required" if stage in {"subscribe", "register"} else "failed")


def test_expired_nonce_foreign_scope_and_csrf_fail_before_meta(client, db, configured, monkeypatch):
    _, body = begin(client)
    meta = FakeMeta()
    monkeypatch.setattr(onboarding, "SignupProvider", lambda: meta)
    wrong = {**body, "nonce": "x" * 43}
    assert client.post(f"{BASE}/finish", json=wrong).status_code == 403
    assert (
        client.post(f"{BASE}/finish", json=body, headers={"X-CSRF-Token": "wrong"}).status_code
        == 403
    )
    row = db.query(SignupSession).one()
    row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()
    assert client.post(f"{BASE}/finish", json=body).status_code == 409
    assert meta.calls == []
    assert (
        client.post(f"{BASE}/finish", json={**body, "tenant_id": str(uuid4())}).status_code == 422
    )


def test_encryption_cannot_be_moved_to_another_tenant_or_phone(configured):
    tenant, branch = uuid4(), uuid4()
    value = credentials.encrypt(
        tenant=tenant,
        branch=branch,
        waba="987",
        phone="654",
        token=SecretStr("synthetic-merchant-token"),
        pin="123456",
    )
    for other, number in [(uuid4(), "654"), (tenant, "655")]:
        with pytest.raises(ChannelError, match="channel_configuration_invalid"):
            credentials.decrypt(
                tenant=other, branch=branch, waba="987", phone=number, encrypted=value
            )


def test_runtime_cannot_create_or_change_connections(owner_engine, kova_app_engine):
    with kova_app_engine.connect() as db:
        for table in [
            "messaging_channel_bindings",
            "messaging_channel_connections",
            "messaging_signup_sessions",
        ]:
            assert db.execute(
                text("SELECT has_table_privilege(current_user,:table,'SELECT')"), {"table": table}
            ).scalar()
            for privilege in ["INSERT", "UPDATE", "DELETE"]:
                assert not db.execute(
                    text("SELECT has_table_privilege(current_user,:table,:privilege)"),
                    {"table": table, "privilege": privilege},
                ).scalar()


def test_provider_proves_granted_waba_and_exact_number_before_writes(configured):
    calls = []

    def handle(request):
        calls.append(request)
        assert request.url.host == "graph.facebook.com"
        assert request.url.path.startswith("/v25.0/")
        if request.url.path.endswith("debug_token"):
            return httpx.Response(
                200,
                json={
                    "data": {
                        "is_valid": True,
                        "app_id": "123",
                        "scopes": ["whatsapp_business_management", "whatsapp_business_messaging"],
                        "granular_scopes": [
                            {"scope": permission, "target_ids": ["987"]}
                            for permission in [
                                "whatsapp_business_management",
                                "whatsapp_business_messaging",
                            ]
                        ],
                    }
                },
            )
        return httpx.Response(
            200, json={"data": [{"id": "654", "code_verification_status": "VERIFIED"}]}
        )

    provider = SignupProvider(transport=httpx.MockTransport(handle))
    assert provider.verify(SecretStr("test-token"), "987", "654") is None
    with pytest.raises(ChannelError, match="meta_assets_not_authorized"):
        provider.verify(SecretStr("test-token"), "988", "654")
    with pytest.raises(ChannelError, match="meta_number_not_verified"):
        provider.verify(SecretStr("test-token"), "987", "655")
    assert all(request.method == "GET" for request in calls)


def test_provider_never_follows_redirects_or_retries_or_leaks_errors(configured):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(302, headers={"Location": "https://other.invalid/secret"})

    with pytest.raises(ChannelError) as caught:
        SignupProvider(transport=httpx.MockTransport(handle)).exchange(
            SecretStr("synthetic-exchange-code")
        )
    assert len(calls) == 1
    assert "synthetic" not in str(caught.value)
    assert "test-app-secret" not in str(caught.value)


def test_signed_ingress_resolves_stored_credentials_and_deduplicates(
    client, db, configured, monkeypatch
):
    _, body = begin(client)
    monkeypatch.setattr(onboarding, "SignupProvider", FakeMeta)
    assert client.post(f"{BASE}/finish", json=body).status_code == 200
    binding = db.query(ChannelBinding).one()
    raw, _ = envelope(binding)
    signature = "sha256=" + hmac.new(b"test-app-secret", raw, hashlib.sha256).hexdigest()

    @contextmanager
    def local_session():
        yield db

    monkeypatch.setattr(delivery, "SessionLocal", local_session)
    monkeypatch.setattr(delivery, "PrivilegedSessionLocal", local_session)
    for _ in range(2):
        response = client.post(
            "/api/v1/messaging/webhooks/whatsapp",
            content=raw,
            headers={"X-Hub-Signature-256": signature},
        )
        assert response.status_code == 200, response.text
    assert db.query(Conversation).count() == 1
    response = client.get("/api/v1/messaging/conversations")
    assert response.status_code == 200
    assert "synthetic-merchant-token" not in response.text


def test_branch_and_tenant_changes_cannot_finish_another_session(client, configured, monkeypatch):
    _, body = begin(client)
    meta = FakeMeta()
    monkeypatch.setattr(onboarding, "SignupProvider", lambda: meta)
    created = client.post(
        "/api/v1/branches",
        json={"name": "Otra sucursal"},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert created.status_code == 201
    assert (
        client.post(
            f"{BASE}/finish", json=body, headers={"X-Kova-Branch": created.json()["id"]}
        ).status_code
        == 404
    )
    _signup_verify_login(client, f"other-{uuid4().hex}@example.com", "Otro negocio")
    assert client.post(f"{BASE}/finish", json=body).status_code == 404
    assert meta.calls == []


def test_rotation_keeps_binding_and_pin_without_registering_again(
    client, db, configured, monkeypatch
):
    _, body = begin(client)
    meta = FakeMeta()
    monkeypatch.setattr(onboarding, "SignupProvider", lambda: meta)
    assert client.post(f"{BASE}/finish", json=body).status_code == 200
    original = db.query(ChannelConnection).one()
    original_pin = credentials.decrypt(
        tenant=original.tenant_id,
        branch=original.branch_id,
        waba="987",
        phone="654",
        encrypted=original.encrypted_credentials,
    )[1]
    session = client.post(f"{BASE}/start", json={}).json()
    changed = {
        **body,
        "session_id": session["session_id"],
        "nonce": session["nonce"],
        "code": "new-synthetic-code",
    }
    meta.exchange = lambda code: SecretStr("synthetic-merchant-token")
    assert client.post(f"{BASE}/finish", json=changed).status_code == 200
    assert meta.calls.count("register") == 1
    assert db.query(ChannelBinding).count() == 1
    renewed = db.query(ChannelConnection).one()
    assert renewed.binding_id == original.binding_id
    assert (
        credentials.decrypt(
            tenant=renewed.tenant_id,
            branch=renewed.branch_id,
            waba="987",
            phone="654",
            encrypted=renewed.encrypted_credentials,
        )[1]
        == original_pin
    )


@pytest.mark.parametrize(
    "payload",
    [{"data": None}, {"data": {"scopes": None}}, {"data": {"scopes": [], "granular_scopes": None}}],
)
def test_malformed_authorization_data_fails_without_provider_details(configured, payload):
    provider = SignupProvider(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=payload))
    )
    with pytest.raises(ChannelError, match="meta_assets_not_authorized"):
        provider.verify(SecretStr("synthetic-merchant-token"), "987", "654")


def test_owner_controls_sending_and_can_pause_after_token_expiry(
    client, db, configured, monkeypatch
):
    _, body = begin(client)
    monkeypatch.setattr(onboarding, "SignupProvider", FakeMeta)
    assert client.post(f"{BASE}/finish", json=body).status_code == 200
    endpoint = "/api/v1/messaging/connection/sending"
    response = client.patch(endpoint, json={"enabled": True})
    assert response.status_code == 200, response.text
    assert response.json()["send_enabled"] is True
    row = db.query(ChannelConnection).one()
    row.token_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()
    assert client.patch(endpoint, json={"enabled": True}).status_code == 409
    assert client.patch(endpoint, json={"enabled": False}).status_code == 200
    assert db.query(ChannelConnection).one().send_enabled is False
    member = db.query(Membership).filter_by(tenant_id=row.tenant_id, role="owner").one()
    member.role = "manager"
    db.commit()
    assert client.post(f"{BASE}/start", json={}).status_code == 403
    assert client.patch(endpoint, json={"enabled": True}).status_code == 403


@pytest.mark.parametrize("competing_state", ["registering", "connected"])
def test_competing_verified_phone_claims_fail_before_any_external_write(
    client, db, configured, competing_state
):
    account, body = begin(client)
    other, other_body = begin(client)
    tenant, other_tenant = UUID(account["tenant_id"]), UUID(other["tenant_id"])
    actor = db.query(Membership).filter_by(tenant_id=tenant, role="owner").one().user_id
    meta = FakeMeta()
    verify = meta.verify

    def competing_verification(token, waba, phone):
        expiry = verify(token, waba, phone)
        with Session(bind=db.get_bind()) as competitor:
            row = competitor.query(SignupSession).filter_by(id=UUID(other_body["session_id"])).one()
            row.state, row.waba_id, row.phone_number_id = competing_state, waba, phone
            if competing_state == "connected":
                competitor.add(ChannelBinding(
                    id=uuid4(), tenant_id=other_tenant, branch_id=other_tenant,
                    waba_id=waba, phone_number_id=phone, verified_at=datetime.now(UTC), enabled=True,
                ))
            competitor.commit()
        return expiry

    meta.verify = competing_verification
    with pytest.raises(HTTPException) as caught:
        onboarding.finish(db, tenant, tenant, actor, SignupFinish.model_validate(body), provider=meta)
    assert caught.value.status_code == 409
    assert caught.value.detail.startswith("No se completó"), caught.value.detail
    assert meta.calls == ["exchange", "verify"]
    with tenant_wide_branches(db):
        row = db.query(SignupSession).filter_by(id=UUID(body["session_id"])).one()
        assert row.state == "failed"
        assert db.query(ChannelConnection).count() == 0


def test_crm_and_dashboard_project_real_configuration_for_the_selected_branch(
    client, configured, monkeypatch
):
    account, body = begin(client)
    monkeypatch.setattr(onboarding, "SignupProvider", FakeMeta)
    assert client.post(f"{BASE}/finish", json=body).status_code == 200
    assert client.get("/api/v1/crm").json()["capabilities"]["whatsapp"] == "connected"
    other = client.post(
        "/api/v1/branches",
        json={"name": "Otra sucursal"},
        headers={"Idempotency-Key": str(uuid4())},
    ).json()
    for scope, expected in [
        (account["tenant_id"], "Configurado"),
        (other["id"], "Sin conexión"),
        ("all", "Consultar por sucursal"),
    ]:
        response = client.get(
            "/api/v1/reports/dashboard", params={"period": "day", "branch_id": scope}
        )
        assert response.status_code == 200, response.text
        metrics = {
            metric["key"]: metric
            for area in response.json()["control_center"]["areas"]
            for metric in area["metrics"]
        }
        assert metrics["whatsapp"]["value"] == expected
    assert client.get("/api/v1/messaging/connection").json()["status"] == "connected"
