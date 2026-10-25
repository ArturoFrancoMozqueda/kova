"""Local HTTP -> real PostgreSQL coverage. All Meta transports are explicit fakes."""

import hashlib
import hmac
import json
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import text

from app.config import settings
from app.messaging import connections, delivery
from app.messaging.models import Conversation, Message
from app.messaging.provisioning import provision_binding, verify_account
from app.messaging.whatsapp import ChannelError, WhatsAppCloudAdapter
from app.tests.test_crm import consent, setup
from app.tests.test_messaging_inbox import SECRET, bound, draft, envelope, post

pytestmark = pytest.mark.usefixtures("fast_business_auth")
WEBHOOK = "/api/v1/messaging/webhooks/whatsapp"


@pytest.fixture(autouse=True)
def no_live_provider(monkeypatch):
    def forbidden(_connection):
        raise AssertionError("Every delivery test must inject an explicit fake transport")

    monkeypatch.setattr(connections, "provider_for", forbidden)


def configure(monkeypatch, tenant, binding, *, send=True, limit=25):
    row = {
        "tenant_id": str(tenant),
        "branch_id": str(binding.branch_id),
        "binding_id": str(binding.id),
        "waba_id": binding.waba_id,
        "phone_number_id": binding.phone_number_id,
        "access_token": "synthetic-pilot-token",
        "send_enabled": send,
        "daily_send_limit": limit,
    }
    monkeypatch.setattr(settings, "kova_whatsapp_enabled", True)
    monkeypatch.setattr(settings, "whatsapp_graph_api_version", "v26.0")
    monkeypatch.setattr(settings, "whatsapp_app_secret", SECRET)
    monkeypatch.setattr(settings, "whatsapp_webhook_verify_token", SecretStr("synthetic-verify"))
    monkeypatch.setattr(settings, "whatsapp_connections", SecretStr(json.dumps([row])))
    return row


def local_sessions(monkeypatch, db):
    @contextmanager
    def session():
        yield db

    monkeypatch.setattr(delivery, "SessionLocal", session)


def transport(monkeypatch, binding, *, fail=False):
    calls = []

    def send(request):
        calls.append(request)
        if fail:
            raise httpx.ReadTimeout("synthetic private provider detail")
        return httpx.Response(200, json={"messages": [{"id": "wamid.live_simulated"}]})

    def provider(connection):
        adapter = WhatsAppCloudAdapter(
            access_token=connection.access_token,
            phone_number_id=connection.phone_number_id,
            api_version="v26.0",
            transport=httpx.MockTransport(send),
        )
        adapter.binding_id = binding.id
        return adapter

    monkeypatch.setattr(connections, "provider_for", provider)
    return calls


def send(client, message, key="send-once"):
    return post(
        client, f"/messages/{message['id']}/send", {"expected_version": message["version"]}, key
    )


def test_configuration_is_scoped_and_does_not_expose_credentials(client, db, monkeypatch):
    tenant, _, _, binding, _ = bound(db, client)
    configure(monkeypatch, tenant, binding)
    response = client.get("/api/v1/messaging/readiness")
    assert response.status_code == 200
    assert response.json()["status"] == "connected"
    assert response.json()["send_enabled"]
    assert "synthetic-pilot-token" not in response.text
    assert binding.phone_number_id not in response.text
    branch = client.post(
        "/api/v1/branches", json={"name": "Otra"}, headers={"Idempotency-Key": str(uuid4())}
    ).json()
    other = client.get("/api/v1/messaging/connection", headers={"X-Kova-Branch": branch["id"]})
    assert other.json() == {
        "status": "not_connected",
        "send_enabled": False,
        "receive_enabled": False,
    }
    monkeypatch.setattr(settings, "whatsapp_connections", SecretStr("secret-invalid-json"))
    response = client.get("/api/v1/messaging/connection")
    assert response.json()["status"] == "configuration_error"
    assert "secret-invalid-json" not in response.text


def test_registry_rejects_duplicate_numbers_and_branches_without_printing_tokens(monkeypatch):
    tenant, binding_id = uuid4(), uuid4()
    row = {
        "tenant_id": str(tenant),
        "branch_id": str(tenant),
        "binding_id": str(binding_id),
        "waba_id": "123",
        "phone_number_id": "456",
        "access_token": "synthetic-private-token",
    }
    monkeypatch.setattr(settings, "whatsapp_connections", SecretStr(json.dumps([row, row])))
    with pytest.raises(ChannelError) as exc:
        connections.configured_connections()
    assert str(exc.value) == "channel_configuration_invalid"
    monkeypatch.setattr(settings, "whatsapp_connections", SecretStr(json.dumps([row])))
    assert "synthetic-private-token" not in repr(connections.configured_connections())


def test_signed_http_ingress_is_deduplicated_and_ignores_cookie_tenant(client, db, monkeypatch):
    tenant, _, _, binding, _ = bound(db, client)
    configure(monkeypatch, tenant, binding)
    # The active browser now belongs to an unrelated business.
    setup(client)
    local_sessions(monkeypatch, db)
    raw, signature = envelope(binding, party="525599999999")
    response = client.post(WEBHOOK, content=raw, headers={"X-Hub-Signature-256": signature})
    assert response.status_code == 200, response.text
    assert (
        client.post(WEBHOOK, content=raw, headers={"X-Hub-Signature-256": signature}).status_code
        == 200
    )
    row = db.query(Conversation).filter_by(tenant_id=tenant, external_party="525599999999").one()
    assert row.customer_id is None and row.automation_paused
    assert db.query(Message).filter_by(conversation_id=row.id).count() == 1


def test_webhook_verification_signatures_size_and_emergency_stop(client, db, monkeypatch):
    tenant, _, _, binding, _ = bound(db, client)
    configure(monkeypatch, tenant, binding)
    response = client.get(
        WEBHOOK,
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": "synthetic-verify",
            "hub.challenge": "12345",
        },
    )
    assert response.status_code == 200 and response.text == "12345"
    assert response.headers["content-type"].startswith("text/plain")
    assert (
        client.get(
            WEBHOOK,
            params={"hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "12345"},
        ).status_code
        == 403
    )
    assert client.post(WEBHOOK, content=b"{}").status_code == 403
    assert client.post(WEBHOOK, content=b"x" * 262145).status_code == 413
    monkeypatch.setattr(settings, "kova_whatsapp_enabled", False)
    assert client.post(WEBHOOK, content=b"{}").status_code == 503


def test_human_reply_keeps_handoff_and_replay_never_sends_twice(client, db, monkeypatch):
    tenant, actor, _, binding, conversation = bound(db, client)
    configure(monkeypatch, tenant, binding)
    conversation.automation_paused = True
    db.commit()
    calls = transport(monkeypatch, binding)
    message = draft(client, {"id": str(conversation.id)})
    response = send(client, message)
    assert response.status_code == 200, response.text
    assert response.json()["state"] == "accepted"
    assert send(client, message).json()["state"] == "accepted"
    assert len(calls) == 1
    assert db.get(Conversation, conversation.id).automation_paused
    assert json.loads(calls[0].content)["to"] == "525512345678"
    # Even a fresh command cannot repeat the same message.
    assert send(client, message, "fresh-key").status_code == 409
    assert len(calls) == 1
    local_sessions(monkeypatch, db)
    raw, signature = envelope(binding, mid="wamid.live_simulated", kind="receipt")
    assert (
        client.post(WEBHOOK, content=raw, headers={"X-Hub-Signature-256": signature}).status_code
        == 200
    )
    assert send(client, message).json()["state"] == "delivered"
    assert len(calls) == 1
    assert actor == db.get(Message, UUID(message["id"])).requested_by_user_id


@pytest.mark.parametrize(
    "reason",
    ["consent", "window", "assignee", "unpaused_assignee", "disabled", "binding", "marketing"],
)
def test_human_reply_revalidates_gates_before_network(client, db, monkeypatch, reason):
    tenant, _, customer, binding, conversation = bound(db, client)
    configure(monkeypatch, tenant, binding, send=reason != "disabled")
    conversation.automation_paused = True
    if reason == "consent":
        assert (
            consent(client, {"id": str(customer.id)}, enabled=False, expected_version=1).status_code
            == 200
        )
    if reason == "window":
        conversation.last_inbound_at = datetime.now(UTC) - timedelta(hours=25)
    if reason in {"assignee", "unpaused_assignee"}:
        conversation.assigned_user_id = None
        if reason == "unpaused_assignee":
            conversation.automation_paused = False
    if reason == "binding":
        binding.enabled = False
    db.commit()
    calls = transport(monkeypatch, binding)
    message = draft(client, {"id": str(conversation.id)})
    if reason == "marketing":
        db.get(Message, UUID(message["id"])).purpose = "marketing"
        db.commit()
    assert send(client, message).status_code == 409
    assert not calls
    assert db.get(Message, UUID(message["id"])).state == "draft"


def test_timeout_is_visible_and_never_retried_by_http_replay(client, db, monkeypatch):
    tenant, _, _, binding, conversation = bound(db, client)
    configure(monkeypatch, tenant, binding)
    calls = transport(monkeypatch, binding, fail=True)
    message = draft(client, {"id": str(conversation.id)})
    assert send(client, message).json()["state"] == "uncertain"
    assert send(client, message).json()["state"] == "uncertain"
    assert len(calls) == 1


def test_daily_cap_prevents_an_extra_provider_call(client, db, monkeypatch):
    tenant, _, _, binding, conversation = bound(db, client)
    configure(monkeypatch, tenant, binding, limit=1)
    calls = transport(monkeypatch, binding)
    first = draft(client, {"id": str(conversation.id)})
    assert send(client, first).json()["state"] == "accepted"
    second = draft(client, {"id": str(conversation.id)}, "second-draft")
    response = send(client, second, "second-send")
    assert response.json()["state"] == "suppressed"
    assert response.json()["error_code"] == "daily_send_limit"
    assert len(calls) == 1


def test_catalog_draft_uses_published_branch_link_and_is_idempotent(client, db):
    from app.tests.test_customer_orders import _product
    from app.tests.test_storefront import _save

    _, _, _, _, conversation = bound(db, client)
    path = f"/conversations/{conversation.id}/catalog-draft"
    body = {"expected_version": conversation.version}
    assert post(client, path, body).status_code == 409
    product = _product(client)
    catalog = _save(client, [product]).json()
    response = post(client, path, body, "catalog-once")
    assert response.status_code == 201, response.text
    assert response.json()["state"] == "draft"
    assert settings.frontend_url + catalog["share_path"] in response.json()["body"]
    assert post(client, path, body, "catalog-once").json() == response.json()


def test_send_endpoint_preserves_cookie_csrf_and_role_gates(client, db, monkeypatch):
    tenant, actor, _, binding, conversation = bound(db, client)
    configure(monkeypatch, tenant, binding)
    message = draft(client, {"id": str(conversation.id)})
    calls = transport(monkeypatch, binding)
    response = client.post(
        f"/api/v1/messaging/messages/{message['id']}/send",
        json={"expected_version": message["version"]},
        headers={"Idempotency-Key": "csrf-denied", "X-CSRF-Token": "wrong"},
    )
    assert response.status_code == 403
    assert not calls
    from app.auth.models import Membership

    db.query(Membership).filter_by(tenant_id=tenant, user_id=actor).one().role = "cashier"
    db.commit()
    assert send(client, message).status_code == 403


def test_runtime_ingress_uses_real_rls_without_binding_write_grants(
    client, db, monkeypatch, kova_app_engine
):
    tenant, _, _, binding, _ = bound(db, client)
    configure(monkeypatch, tenant, binding)
    local_sessions(monkeypatch, db)
    # Existing fixture owns the outer test transaction. Switch its live SQL role
    # to the actual NOBYPASSRLS runtime role for the entire HTTP ingestion.
    db.execute(text("SET LOCAL ROLE kova_app"))
    raw, signature = envelope(binding, party="525588888888")
    response = client.post(WEBHOOK, content=raw, headers={"X-Hub-Signature-256": signature})
    assert response.status_code == 200, response.text
    assert db.query(Conversation).filter_by(external_party="525588888888").count() == 1
    db.execute(text("SELECT set_config('app.tenant_id', :other, true)"), {"other": str(uuid4())})
    assert db.query(Conversation).count() == 0
    db.execute(text("SET LOCAL ROLE pos"))


def test_assisted_provisioning_checks_meta_and_rejects_wrong_number(db, client, monkeypatch):
    tenant, actor, _, binding, _ = bound(db, client)
    configure(monkeypatch, tenant, binding)
    connection = connections.configured_connections()[0]
    seen = []

    def handle(request):
        seen.append(request)
        return httpx.Response(200, json={"data": [{"id": binding.phone_number_id}]})

    verify_account(connection, transport=httpx.MockTransport(handle))
    assert seen[0].url.host == "graph.facebook.com"
    assert "synthetic-pilot-token" not in str(seen[0].url)
    with pytest.raises(ChannelError):
        verify_account(
            connection,
            transport=httpx.MockTransport(
                lambda _: httpx.Response(200, json={"data": [{"id": "999"}]})
            ),
        )
    assert provision_binding(db, connection, authorized_by=actor).id == binding.id
    with pytest.raises(ChannelError):
        provision_binding(db, connection, authorized_by=uuid4())
    other = connection.model_copy(update={"tenant_id": uuid4()})
    with pytest.raises(ChannelError):
        provision_binding(db, other, authorized_by=actor)


def test_mixed_signed_batch_routes_each_account_only_to_its_registered_business(
    client, db, monkeypatch
):
    first_tenant, _, _, first_binding, _ = bound(db, client)
    first_config = configure(monkeypatch, first_tenant, first_binding)
    second_tenant, _, _, second_binding, _ = bound(db, client)
    second_config = configure(monkeypatch, second_tenant, second_binding)
    monkeypatch.setattr(
        settings, "whatsapp_connections", SecretStr(json.dumps([first_config, second_config]))
    )
    first, _ = envelope(first_binding, mid="wamid.first_account", party="525511111111")
    second, _ = envelope(second_binding, mid="wamid.second_account", party="525522222222")
    payload = json.loads(first)
    payload["entry"].extend(json.loads(second)["entry"])
    raw = json.dumps(payload).encode()
    signature = (
        "sha256=" + hmac.new(SECRET.get_secret_value().encode(), raw, hashlib.sha256).hexdigest()
    )
    local_sessions(monkeypatch, db)
    assert (
        client.post(WEBHOOK, content=raw, headers={"X-Hub-Signature-256": signature}).status_code
        == 200
    )
    db.info.pop("kova_branch_id", None)
    first_messages = db.query(Message).filter_by(tenant_id=first_tenant, direction="inbound").all()
    second_messages = (
        db.query(Message).filter_by(tenant_id=second_tenant, direction="inbound").all()
    )
    assert [row.provider_message_id for row in first_messages] == ["wamid.first_account"]
    assert [row.provider_message_id for row in second_messages] == ["wamid.second_account"]


def test_latest_messages_page_preserves_chronology_without_changing_default_contract(client, db):
    _, _, _, _, conversation = bound(db, client)
    first = draft(client, {"id": str(conversation.id)}, "first-draft")
    second = draft(client, {"id": str(conversation.id)}, "second-draft")
    path = f"/api/v1/messaging/conversations/{conversation.id}/messages?limit=1"
    assert client.get(path).json()["items"][0]["id"] == first["id"]
    latest = client.get(path + "&latest=true").json()
    assert latest["has_more"] and latest["items"][0]["id"] == second["id"]
