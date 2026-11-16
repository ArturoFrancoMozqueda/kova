"""Real PostgreSQL, signed synthetic Meta payloads; no real WhatsApp accounts."""

import hashlib
import hmac
import json
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import text

from app.customers.models import Customer
from app.messaging import app_sync, credentials, delivery, onboarding
from app.messaging.models import (
    AppContact,
    AppSync,
    ChannelConnection,
    Conversation,
    Message,
    WebhookBatch,
)
from app.messaging.signup_provider import SignupProvider
from app.messaging.whatsapp import ChannelError
from app.tests.test_whatsapp_signup import BASE, FakeMeta, begin, configured  # noqa: F401

pytestmark = pytest.mark.usefixtures("fast_business_auth", "configured")
EVENT = "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
PARTY = "525512345678"
BUSINESS = "525599999999"


class AppMeta(FakeMeta):
    def verify_business_app(self, token, waba, phone=None):
        self._call("verify_app")
        return "654", datetime.now(UTC) + timedelta(days=60)

    def sync_app_data(self, token, phone, kind):
        self._call(kind)
        return f"synthetic-{kind}-request"


def connect(client, db, monkeypatch, *, fail=None):
    account, body = begin(client, db)
    body.pop("phone_number_id")  # Meta's official coexistence completion can be account-only.
    body["event"] = EVENT
    meta = AppMeta(fail=fail)
    monkeypatch.setattr(onboarding, "SignupProvider", lambda: meta)
    response = client.post(f"{BASE}/finish", json=body)
    assert response.status_code == 200, response.text
    return account, body, meta


def payload(field, **value):
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "987",
                "changes": [
                    {
                        "field": field,
                        "value": {
                            "messaging_product": "whatsapp",
                            "metadata": {
                                "phone_number_id": "654",
                                "display_phone_number": BUSINESS,
                            },
                            **value,
                        },
                    }
                ],
            }
        ],
    }


def raw_signed(data):
    raw = json.dumps(data).encode()
    return raw, "sha256=" + hmac.new(b"test-app-secret", raw, hashlib.sha256).hexdigest()


def ingest(client, db, monkeypatch, data, *, background=True):
    @contextmanager
    def local_session():
        yield db

    monkeypatch.setattr(delivery, "SessionLocal", local_session)
    monkeypatch.setattr(delivery, "PrivilegedSessionLocal", local_session)
    if not background:
        monkeypatch.setattr(delivery, "process_captured", lambda scopes: None)
    raw, signature = raw_signed(data)
    response = client.post(
        "/api/v1/messaging/webhooks/whatsapp",
        content=raw,
        headers={"X-Hub-Signature-256": signature},
    )
    assert response.status_code == 200, response.text
    return raw


def message(mid, **changes):
    return {
        "id": f"wamid.{mid}",
        "timestamp": str(int(datetime.now(UTC).timestamp())),
        "type": "text",
        "text": {"body": "Mensaje de prueba"},
        **changes,
    }


def history(messages, progress=100):
    return payload(
        "history",
        history=[
            {
                "metadata": {"phase": 0, "chunk_order": 1, "progress": progress},
                "threads": [{"id": PARTY, "messages": messages}],
            }
        ],
    )


def test_app_number_is_never_registered_or_given_a_pin_and_requests_are_one_shot(
    client,
    db,
    monkeypatch,
):
    _, body, meta = connect(client, db, monkeypatch)
    assert meta.calls == ["exchange", "verify_app", "subscribe", "contacts", "history"]
    row = db.query(AppSync).one()
    assert row.contacts_state == row.history_state == "requested"
    stored = db.query(ChannelConnection).one()
    assert (
        credentials.decrypt(
            tenant=stored.tenant_id,
            branch=stored.branch_id,
            waba="987",
            phone="654",
            encrypted=stored.encrypted_credentials,
        )[1]
        is None
    )
    assert (
        client.patch("/api/v1/messaging/connection/sending", json={"enabled": True}).status_code
        == 409
    )
    assert client.post(f"{BASE}/finish", json=body).status_code == 200
    assert meta.calls == ["exchange", "verify_app", "subscribe", "contacts", "history"]
    status = client.get(BASE).json()
    assert status["coexistence"] and status["sync_status"] == "synchronizing"
    assert not any("synthetic-" in str(v) for v in status.values())


@pytest.mark.parametrize("stage", ["contacts", "history"])
def test_ambiguous_sync_requires_review_without_repeating_requests(
    client,
    db,
    monkeypatch,
    stage,
):
    _, body, meta = connect(client, db, monkeypatch, fail=stage)
    calls = list(meta.calls)
    assert client.get(BASE).json()["sync_status"] == "review_required"
    assert client.post(f"{BASE}/finish", json=body).status_code == 200
    assert client.post(f"{BASE}/sync", json={}).status_code == 200
    assert meta.calls == calls
    assert db.query(AppSync).one().history_state == (
        "pending" if stage == "contacts" else "review_required"
    )


def test_history_does_not_open_window_echoes_do_not_send_and_duplicates_preserve_live_window(
    client,
    db,
    monkeypatch,
):
    connect(client, db, monkeypatch)
    original = datetime.now(UTC) - timedelta(days=3)
    old = message("old", **{"from": PARTY, "timestamp": str(int(original.timestamp()))})
    ingest(client, db, monkeypatch, history([old]))
    conversation = db.query(Conversation).one()
    assert conversation.last_inbound_at is None and conversation.customer_id is None
    assert db.query(Message).one().source == "history"
    echo = payload(
        "smb_message_echoes", message_echoes=[message("mobile", to=PARTY, **{"from": BUSINESS})]
    )
    ingest(client, db, monkeypatch, echo)
    ingest(client, db, monkeypatch, echo)
    assert db.query(Message).count() == 2
    outbound = db.query(Message).filter_by(direction="outbound").one()
    assert outbound.state == "sent" and outbound.source == "whatsapp_app"
    assert outbound.requested_by_user_id is None
    assert conversation.last_inbound_at is None
    # A live copy that arrives AFTER historical import still opens the real window.
    live = message("live", **{"from": PARTY})
    ingest(client, db, monkeypatch, history([live], progress=50))
    assert conversation.last_inbound_at is None
    ingest(client, db, monkeypatch, payload("messages", messages=[live]))
    assert conversation.last_inbound_at is not None
    assert db.query(Message).count() == 3
    stamp = conversation.last_inbound_at
    ingest(client, db, monkeypatch, history([live]))
    assert conversation.last_inbound_at == stamp
    assert db.query(Message).count() == 3
    assert db.query(Customer).count() == 0
    assert client.get(BASE).json()["sync_status"] == "ready"
    assert (
        client.patch("/api/v1/messaging/connection/sending", json={"enabled": True}).status_code
        == 200
    )


def test_contacts_are_separate_and_out_of_order_remove_cannot_resurrect_them(
    client,
    db,
    monkeypatch,
):
    connect(client, db, monkeypatch)
    stamp = int(datetime.now(UTC).timestamp())

    def contact(action, timestamp):
        return payload(
            "smb_app_state_sync",
            state_sync=[
                {
                    "type": "contact",
                    "action": action,
                    "contact": {"phone_number": PARTY, "full_name": "Cliente del celular"},
                    "metadata": {"timestamp": str(timestamp)},
                }
            ],
        )

    ingest(client, db, monkeypatch, contact("add", stamp - 10))
    ingest(client, db, monkeypatch, contact("remove", stamp))
    ingest(client, db, monkeypatch, contact("add", stamp - 5))
    assert db.query(AppContact).one().removed
    assert db.query(AppContact).one().name is None
    assert db.query(Customer).count() == db.query(Conversation).count() == 0


def test_large_history_is_captured_encrypted_and_resumes_after_lost_worker(
    client,
    db,
    monkeypatch,
):
    connect(client, db, monkeypatch)
    data = history([message(f"bulk{i}", **{"from": PARTY}) for i in range(125)])
    ingest(client, db, monkeypatch, data, background=False)
    batch = db.query(WebhookBatch).one()
    assert batch.cursor == 0 and db.query(Message).count() == 0
    assert (
        "Mensaje de prueba" not in batch.encrypted_payload and PARTY not in batch.encrypted_payload
    )
    assert app_sync.process_pending(db, batch.tenant_id, limit=50) == 50
    db.commit()
    assert batch.cursor == 50 and db.query(Message).count() == 50
    assert client.post(f"{BASE}/sync", json={}).json()["sync_status"] == "ready"
    assert db.query(Message).count() == 125
    assert batch.state == "completed" and batch.encrypted_payload is None
    ingest(client, db, monkeypatch, data)
    assert db.query(WebhookBatch).count() == 1
    assert db.query(Message).count() == 125


def test_declined_history_is_respected_and_disconnect_blocks_sending(
    client,
    db,
    monkeypatch,
):
    connect(client, db, monkeypatch)
    ingest(client, db, monkeypatch, payload("history", history=[{"errors": [{"code": 2593109}]}]))
    assert db.query(AppSync).one().history_state == "declined"
    assert db.query(Message).count() == 0
    assert (
        client.patch("/api/v1/messaging/connection/sending", json={"enabled": True}).status_code
        == 200
    )
    removed = {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "123",
                "changes": [
                    {
                        "field": "account_update",
                        "value": {"event": "PARTNER_REMOVED", "waba_info": {"waba_id": "987"}},
                    }
                ],
            }
        ],
    }
    ingest(client, db, monkeypatch, removed)
    assert client.get(BASE).json()["sync_status"] == "review_required"
    assert not client.get("/api/v1/messaging/connection").json()["send_enabled"]
    assert (
        client.patch("/api/v1/messaging/connection/sending", json={"enabled": True}).status_code
        == 409
    )


@pytest.mark.parametrize(
    "app,platform,extra",
    [(False, "CLOUD_API", False), (True, "NOT_APPLICABLE", False), (True, "CLOUD_API", True)],
)
def test_provider_refuses_unproven_or_ambiguous_app_numbers(app, platform, extra):
    def handle(request):
        if request.url.path.endswith("debug_token"):
            return httpx.Response(
                200,
                json={
                    "data": {
                        "is_valid": True,
                        "app_id": "123",
                        "scopes": ["whatsapp_business_management", "whatsapp_business_messaging"],
                        "granular_scopes": [
                            {"scope": s, "target_ids": ["987"]}
                            for s in ["whatsapp_business_management", "whatsapp_business_messaging"]
                        ],
                    }
                },
            )
        number = {
            "id": "654",
            "code_verification_status": "VERIFIED",
            "is_on_biz_app": app,
            "platform_type": platform,
        }
        return httpx.Response(
            200, json={"data": [number, {**number, "id": "655"}] if extra else [number]}
        )

    provider = SignupProvider(transport=httpx.MockTransport(handle))
    with pytest.raises(ChannelError, match="meta_number_not_verified"):
        provider.verify_business_app(SecretStr("synthetic-token"), "987")


def test_sync_post_contract_is_fixed_and_never_registers():
    calls = []

    def handle(request):
        calls.append(request)
        assert request.url.path == "/v25.0/654/smb_app_data"
        assert request.method == "POST"
        assert json.loads(request.content)["sync_type"] in {"history", "smb_app_state_sync"}
        return httpx.Response(200, json={"request_id": "synthetic-request"})

    provider = SignupProvider(transport=httpx.MockTransport(handle))
    for kind in ["contacts", "history"]:
        assert (
            provider.sync_app_data(SecretStr("synthetic-token"), "654", kind) == "synthetic-request"
        )
    assert len(calls) == 2


def test_sync_route_preserves_csrf_and_server_branch_scope(client, db, monkeypatch):
    connect(client, db, monkeypatch)
    assert (
        client.post(f"{BASE}/sync", json={}, headers={"X-CSRF-Token": "wrong"}).status_code == 403
    )
    other = client.post(
        "/api/v1/branches", json={"name": "Otra"}, headers={"Idempotency-Key": "coex-other"}
    )
    assert other.status_code == 201
    response = client.post(f"{BASE}/sync", json={}, headers={"X-Kova-Branch": other.json()["id"]})
    assert response.status_code == 200 and not response.json()["coexistence"]


def test_runtime_keeps_credentials_and_new_ownership_immutable(kova_app_engine):
    with kova_app_engine.connect() as db:
        for table in ["messaging_app_sync", "messaging_app_contacts", "messaging_webhook_batches"]:
            assert db.execute(
                text(
                    "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE relname=:t"
                ),
                {"t": table},
            ).scalar()
            for column in ["tenant_id", "branch_id", "binding_id"]:
                assert not db.execute(
                    text("SELECT has_column_privilege(current_user,:t,:c,'UPDATE')"),
                    {"t": table, "c": column},
                ).scalar()
        assert not db.execute(
            text("SELECT has_table_privilege(current_user,'messaging_app_sync','INSERT')")
        ).scalar()


def test_runtime_import_commits_under_rls_and_cannot_read_another_tenant(
    client,
    db,
    monkeypatch,
    kova_app_engine,
):
    from app.branches.scope import bind_branch
    from app.db import set_tenant_context
    from app.messaging.models import ChannelBinding
    from app.messaging.webhooks import parse_verified_webhook

    connect(client, db, monkeypatch)
    binding = db.query(ChannelBinding).one()
    tenant, branch = binding.tenant_id, binding.branch_id
    raw, signature = raw_signed(history([message("runtime", **{"from": PARTY})]))
    envelope = parse_verified_webhook(
        raw_body=raw,
        signature=signature,
        app_secret=SecretStr("test-app-secret"),
        expected_waba_id="987",
        expected_phone_number_id="654",
    )
    db.execute(text("SET LOCAL ROLE kova_app"))
    set_tenant_context(db, tenant)
    bind_branch(db, tenant_id=tenant, branch_id=branch)
    app_sync.capture(db, tenant, binding, envelope, hashlib.sha256(raw).hexdigest())
    db.commit()
    assert app_sync.process_pending(db, tenant, limit=100) == 2
    db.commit()
    assert db.query(Message).one().source == "history"
    assert db.query(Conversation).one().last_inbound_at is None
    from uuid import uuid4

    set_tenant_context(db, uuid4())
    assert (
        db.query(WebhookBatch).count()
        == db.query(AppContact).count()
        == db.query(AppSync).count()
        == 0
    )
    db.execute(text("SET LOCAL ROLE pos"))


def test_signed_large_payload_uses_app_limit_and_preserves_invalid_signature_rejection(
    client,
    db,
    monkeypatch,
):
    connect(client, db, monkeypatch)
    data = history([message(f"many{i}", **{"from": PARTY}) for i in range(2200)])
    raw = ingest(client, db, monkeypatch, data, background=False)
    assert len(raw) > 262144
    assert db.query(Message).count() == 0
    assert (
        client.post(
            "/api/v1/messaging/webhooks/whatsapp",
            content=raw,
            headers={"X-Hub-Signature-256": "sha256=" + "0" * 64},
        ).status_code
        == 403
    )


def test_invalid_future_history_is_quarantined_atomically(client, db, monkeypatch):
    connect(client, db, monkeypatch)
    future = message(
        "future",
        **{
            "from": PARTY,
            "timestamp": str(int((datetime.now(UTC) + timedelta(hours=1)).timestamp())),
        },
    )
    ingest(client, db, monkeypatch, history([message("valid", **{"from": PARTY}), future]))
    assert db.query(Message).count() == db.query(Conversation).count() == 0
    assert db.query(WebhookBatch).one().state == "review_required"
    assert client.get(BASE).json()["sync_status"] == "review_required"


def test_receipt_before_mobile_echo_reconciles_without_claiming_api_delivery(
    client,
    db,
    monkeypatch,
):
    connect(client, db, monkeypatch)
    stamp = str(int(datetime.now(UTC).timestamp()))
    ingest(
        client,
        db,
        monkeypatch,
        payload(
            "messages",
            statuses=[
                {
                    "id": "wamid.receipt_first",
                    "timestamp": stamp,
                    "status": "delivered",
                    "recipient_id": PARTY,
                }
            ],
        ),
    )
    ingest(
        client,
        db,
        monkeypatch,
        payload(
            "smb_message_echoes",
            message_echoes=[
                message("receipt_first", to=PARTY, **{"from": BUSINESS}),
            ],
        ),
    )
    row = db.query(Message).one()
    assert row.state == "delivered" and row.source == "whatsapp_app"


def test_bsuid_contacts_never_become_phone_numbers_or_crm_customers(
    client,
    db,
    monkeypatch,
):
    connect(client, db, monkeypatch)
    ingest(
        client,
        db,
        monkeypatch,
        payload(
            "smb_app_state_sync",
            state_sync=[
                {
                    "type": "contact",
                    "action": "add",
                    "contact": {"user_id": "1234567", "full_name": "Contacto privado"},
                    "metadata": {"timestamp": str(int(datetime.now(UTC).timestamp()))},
                }
            ],
        ),
    )
    ingest(
        client,
        db,
        monkeypatch,
        payload(
            "smb_message_echoes",
            message_echoes=[
                message("opaque", to_user_id="1234567", **{"from": BUSINESS}),
            ],
        ),
    )
    conversation = client.get("/api/v1/messaging/conversations").json()["items"][0]
    assert conversation["contact_phone"] is None
    assert conversation["customer_name"] == "Contacto privado"
    assert conversation["customer_id"] is None
    assert db.query(Customer).count() == 0
    assert "bsuid:" not in str(conversation)


def test_modified_encrypted_import_scope_is_quarantined_without_leaking_messages(
    client,
    db,
    monkeypatch,
):
    connect(client, db, monkeypatch)
    ingest(
        client, db, monkeypatch, history([message("private", **{"from": PARTY})]), background=False
    )
    batch = db.query(WebhookBatch).one()
    data = json.loads(credentials._cipher().decrypt(batch.encrypted_payload.encode()))
    data["branch"] = "different-branch"
    batch.encrypted_payload = credentials._cipher().encrypt(json.dumps(data).encode()).decode()
    db.commit()
    response = client.post(f"{BASE}/sync", json={})
    assert response.json()["sync_status"] == "review_required"
    assert db.query(Message).count() == 0
    assert batch.cursor == 0


@pytest.mark.parametrize("revoke", [False, True])
def test_dispatch_rechecks_sync_and_mobile_messages_do_not_consume_api_limit(
    client,
    db,
    revoke,
):
    from types import SimpleNamespace
    from uuid import UUID

    from app.messaging import service
    from app.messaging.whatsapp import AcceptedMessage
    from app.tests.test_messaging_inbox import bound, draft, transition

    tenant, _, _, binding, conversation = bound(db, client)
    for i in range(30):
        db.add(
            Message(
                tenant_id=tenant,
                branch_id=conversation.branch_id,
                conversation_id=conversation.id,
                binding_id=binding.id,
                provider_message_id=f"wamid.mobile_limit{i}",
                direction="outbound",
                source="whatsapp_app",
                body="Desde celular",
                message_type="text",
                state="sent",
            )
        )
    db.commit()
    body = draft(client, {"id": str(conversation.id)})
    assert transition(client, body).status_code == 200
    if revoke:
        # Revocation after queue authorization must still stop network dispatch.
        db.add(
            AppSync(
                tenant_id=tenant,
                branch_id=conversation.branch_id,
                binding_id=binding.id,
                contacts_state="requested",
                history_state="review_required",
            )
        )
        db.commit()
    calls = []

    def send(**kwargs):
        calls.append(kwargs)
        return AcceptedMessage("wamid.api_limit")

    result = service.dispatch_one(
        db,
        tenant_id=tenant,
        message_id=UUID(body["id"]),
        provider=SimpleNamespace(binding_id=binding.id, send_text=send),
        enabled=True,
        daily_send_limit=1,
    )
    assert result["status"] == ("suppressed" if revoke else "accepted")
    assert len(calls) == (0 if revoke else 1)
