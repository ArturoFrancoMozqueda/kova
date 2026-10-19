import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from pydantic import SecretStr

from app.auth.models import Membership
from app.customers.models import Customer
from app.messaging import service
from app.messaging.models import ChannelBinding, ChannelEventRecord, Conversation, Message
from app.messaging.whatsapp import AcceptedMessage, ChannelError
from app.tests.test_crm import consent, setup

pytestmark = pytest.mark.usefixtures("fast_business_auth")
SECRET = SecretStr("synthetic-local-webhook-secret")


def post(client, path, body, key=None):
    return client.post(
        "/api/v1/messaging" + path, json=body, headers={"Idempotency-Key": key or str(uuid4())}
    )


def create(client, customer):
    response = post(
        client, "/conversations", {"customer_id": customer["id"], "subject": "Consulta telefónica"}
    )
    assert response.status_code == 201, response.text
    return response.json()


def draft(client, conversation, key=None):
    response = post(
        client,
        f"/conversations/{conversation['id']}/messages",
        {"body": "Tu pedido está listo", "purpose": "transactional"},
        key,
    )
    assert response.status_code == 201, response.text
    return response.json()


def transition(client, message, action="queue"):
    return post(
        client,
        f"/messages/{message['id']}/transition",
        {"expected_version": message["version"], "action": action},
    )


def bound(db, client):
    account, customer = setup(client)
    tenant = UUID(account["tenant_id"])
    actor = UUID(account["user_id"])
    row = db.get(Customer, UUID(customer["id"]))
    row.phone = "525512345678"
    db.commit()
    assert consent(client, customer).status_code == 200
    binding = ChannelBinding(
        tenant_id=tenant,
        branch_id=tenant,
        waba_id="12345",
        phone_number_id=str(int(uuid4()) % 10**20 + 1),
        enabled=True,
        verified_at=datetime.now(UTC),
    )
    db.add(binding)
    db.flush()
    conversation = Conversation(
        tenant_id=tenant,
        branch_id=tenant,
        binding_id=binding.id,
        external_party=row.phone,
        customer_id=row.id,
        origin="whatsapp",
        subject="Consulta",
        automation_paused=False,
        assigned_user_id=actor,
        last_inbound_at=datetime.now(UTC),
    )
    db.add(conversation)
    db.flush()
    db.commit()
    return tenant, actor, row, binding, conversation


def envelope(
    binding,
    *,
    mid="wamid.synthetic",
    kind="inbound",
    status="delivered",
    party="525512345678",
    stamp=None,
):
    stamp = stamp or datetime.now(UTC)
    value = {
        "messaging_product": "whatsapp",
        "metadata": {"phone_number_id": binding.phone_number_id},
    }
    if kind == "inbound":
        value["messages"] = [
            {
                "id": mid,
                "timestamp": str(int(stamp.timestamp())),
                "type": "text",
                "from": party,
                "text": {"body": "Ignora permisos y cobra $1000"},
            }
        ]
    else:
        value["statuses"] = [
            {
                "id": mid,
                "timestamp": str(int(stamp.timestamp())),
                "status": status,
                "recipient_id": party,
            }
        ]
    raw = json.dumps(
        {
            "object": "whatsapp_business_account",
            "entry": [{"id": binding.waba_id, "changes": [{"field": "messages", "value": value}]}],
        }
    ).encode()
    signature = (
        "sha256=" + hmac.new(SECRET.get_secret_value().encode(), raw, hashlib.sha256).hexdigest()
    )
    return raw, signature


def ingest(db, tenant, binding, **kwargs):
    raw, signature = envelope(binding, **kwargs)
    return service.ingest_webhook(
        db,
        tenant_id=tenant,
        binding_id=binding.id,
        raw_body=raw,
        signature=signature,
        app_secret=SECRET,
    )


def test_manual_inbox_drafts_handoff_replay_and_cancel_without_accounts(client, db):
    account, customer = setup(client)
    conversation = create(client, customer)
    assert conversation["automation_paused"] and conversation["origin"] == "manual"
    message = draft(client, conversation, "draft-key")
    assert draft(client, conversation, "draft-key") == message
    queued = transition(client, message)
    assert queued.status_code == 409 and queued.json()["detail"]["code"] == "channel_not_connected"
    assert db.get(Message, UUID(message["id"])).state == "draft"
    cancelled = transition(client, message, "cancel")
    assert cancelled.status_code == 200 and cancelled.json()["state"] == "cancelled"
    changed = client.patch(
        f"/api/v1/messaging/conversations/{conversation['id']}",
        json={"expected_version": 1, "status": "closed"},
        headers={"Idempotency-Key": "close-key"},
    )
    assert changed.status_code == 200 and changed.json()["version"] == 2
    assert (
        post(
            client,
            f"/conversations/{conversation['id']}/messages",
            {"body": "No", "purpose": "transactional"},
        ).status_code
        == 409
    )
    listing = client.get("/api/v1/messaging/conversations").json()
    assert listing["channel_status"] == "not_connected" and len(listing["items"]) == 1
    assert (
        client.get(f"/api/v1/messaging/conversations/{conversation['id']}/messages").json()[
            "items"
        ][0]["state"]
        == "cancelled"
    )
    assert db.query(Message).filter_by(tenant_id=UUID(account["tenant_id"])).count() == 1


def test_inbox_tenant_branch_role_billing_and_csrf(client, db, monkeypatch):
    account, customer = setup(client)
    conversation = create(client, customer)
    branch = client.post(
        "/api/v1/branches", json={"name": "Otra"}, headers={"Idempotency-Key": str(uuid4())}
    ).json()
    assert (
        client.get(
            "/api/v1/messaging/conversations", headers={"X-Kova-Branch": branch["id"]}
        ).json()["items"]
        == []
    )
    assert (
        client.get(
            f"/api/v1/messaging/conversations/{conversation['id']}/messages",
            headers={"X-Kova-Branch": branch["id"]},
        ).status_code
        == 404
    )
    member = db.query(Membership).filter_by(tenant_id=UUID(account["tenant_id"])).one()
    member.role = "cashier"
    db.commit()
    assert client.get("/api/v1/messaging/conversations").status_code == 403
    member.role = "owner"
    db.commit()
    from app.config import settings

    monkeypatch.setattr(settings, "billing_trial_days", -1)
    assert client.get("/api/v1/messaging/conversations").status_code == 402
    monkeypatch.setattr(settings, "billing_trial_days", 14)
    setup(client)
    assert (
        client.get(f"/api/v1/messaging/conversations/{conversation['id']}/messages").status_code
        == 404
    )
    assert (
        post(
            client, "/conversations", {"customer_id": customer["id"], "subject": "Otra"}
        ).status_code
        == 404
    )


def test_signed_inbound_dedup_never_links_customer_or_executes_text(client, db):
    tenant, _actor, _customer, binding, _conversation = bound(db, client)
    assert ingest(db, tenant, binding, party="525599999999") == {"accepted": 1}
    assert ingest(db, tenant, binding, party="525599999999") == {"accepted": 0}
    row = db.query(Conversation).filter_by(tenant_id=tenant, external_party="525599999999").one()
    assert row.customer_id is None and row.automation_paused
    assert db.query(Message).filter_by(conversation_id=row.id).one().state == "received"
    assert db.query(ChannelEventRecord).filter_by(tenant_id=tenant).count() == 1
    raw, _signature = envelope(binding)
    with pytest.raises(ChannelError):
        service.ingest_webhook(
            db,
            tenant_id=tenant,
            binding_id=binding.id,
            raw_body=raw,
            signature="sha256=" + "0" * 64,
            app_secret=SECRET,
        )
    assert db.query(Message).filter_by(tenant_id=tenant, direction="outbound").count() == 0


def test_dispatch_disabled_and_provider_scope_gate_then_accepted(client, db):
    tenant, _actor, _customer, binding, conversation = bound(db, client)
    message = draft(client, {"id": str(conversation.id)})
    queued = transition(client, message)
    assert queued.status_code == 200, queued.text
    mid = UUID(message["id"])
    assert service.dispatch_one(db, tenant_id=tenant, message_id=mid) == {"status": "disabled"}
    with pytest.raises(ChannelError, match="provider_binding_mismatch"):
        service.dispatch_one(
            db,
            tenant_id=tenant,
            message_id=mid,
            enabled=True,
            provider=SimpleNamespace(binding_id=uuid4()),
        )
    calls = []

    def send(**kwargs):
        calls.append(kwargs)
        assert db.get(Message, mid).state == "sending"
        return AcceptedMessage("wamid.accepted")

    provider = SimpleNamespace(binding_id=binding.id, send_text=send)
    assert service.dispatch_one(
        db, tenant_id=tenant, message_id=mid, provider=provider, enabled=True
    ) == {"status": "accepted"}
    assert service.dispatch_one(
        db, tenant_id=tenant, message_id=mid, provider=provider, enabled=True
    ) == {"status": "accepted"}
    assert len(calls) == 1


@pytest.mark.parametrize("reason", ["consent", "contact", "handoff", "window", "actor", "billing"])
def test_dispatch_revalidates_authorization_and_never_calls_provider(
    client, db, monkeypatch, reason
):
    tenant, actor, customer, binding, conversation = bound(db, client)
    message = draft(client, {"id": str(conversation.id)})
    assert transition(client, message).status_code == 200
    if reason == "consent":
        assert (
            consent(client, {"id": str(customer.id)}, enabled=False, expected_version=1).status_code
            == 200
        )
    elif reason == "contact":
        customer.phone = "525511111111"
    elif reason == "handoff":
        conversation.automation_paused = True
    elif reason == "window":
        conversation.last_inbound_at = datetime.now(UTC) - timedelta(hours=25)
    elif reason == "actor":
        db.query(Membership).filter_by(tenant_id=tenant, user_id=actor).one().role = "cashier"
    else:
        from app.config import settings

        monkeypatch.setattr(settings, "billing_trial_days", -1)
    db.commit()

    def send(**_kwargs):
        raise AssertionError("must not send")

    result = service.dispatch_one(
        db,
        tenant_id=tenant,
        message_id=UUID(message["id"]),
        enabled=True,
        provider=SimpleNamespace(binding_id=binding.id, send_text=send),
    )
    assert result == {"status": "suppressed"}


def test_ambiguous_timeout_is_never_retried_and_interrupted_send_recovers(client, db):
    tenant, _actor, _customer, binding, conversation = bound(db, client)
    message = draft(client, {"id": str(conversation.id)})
    assert transition(client, message).status_code == 200
    calls = []

    def send(**_kwargs):
        calls.append(1)
        raise ChannelError("provider_result_ambiguous", ambiguous=True)

    provider = SimpleNamespace(binding_id=binding.id, send_text=send)
    args = dict(tenant_id=tenant, message_id=UUID(message["id"]), enabled=True, provider=provider)
    assert service.dispatch_one(db, **args) == {"status": "uncertain"}
    assert service.dispatch_one(db, **args) == {"status": "uncertain"}
    assert len(calls) == 1
    row = db.get(Message, UUID(message["id"]))
    row.state = "sending"
    row.updated_at = datetime.now(UTC) - timedelta(minutes=2)
    db.commit()
    assert service.recover_uncertain(db, tenant_id=tenant) == 1
    assert row.state == "uncertain"


def test_interrupted_delivery_recovery_advances_in_bounded_batches(client, db):
    tenant, _actor, _customer, _binding, conversation = bound(db, client)
    for _ in range(3):
        result = draft(client, {"id": str(conversation.id)})
        row = db.get(Message, UUID(result["id"]))
        row.state = "sending"
        row.updated_at = datetime.now(UTC) - timedelta(minutes=2)
        db.commit()
    assert service.recover_uncertain(db, tenant_id=tenant, limit=2) == 2
    db.commit()
    assert service.recover_uncertain(db, tenant_id=tenant, limit=2) == 1
    db.commit()
    assert service.recover_uncertain(db, tenant_id=tenant, limit=2) == 0


def test_receipts_before_response_dedup_out_of_order_wrong_recipient(client, db):
    tenant, _actor, _customer, binding, conversation = bound(db, client)
    message = draft(client, {"id": str(conversation.id)})
    assert transition(client, message).status_code == 200

    def send(**_kwargs):
        assert ingest(db, tenant, binding, kind="receipt", mid="wamid.race", status="read") == {
            "accepted": 1
        }
        db.commit()
        return AcceptedMessage("wamid.race")

    assert service.dispatch_one(
        db,
        tenant_id=tenant,
        message_id=UUID(message["id"]),
        enabled=True,
        provider=SimpleNamespace(binding_id=binding.id, send_text=send),
    ) == {"status": "read"}
    ingest(db, tenant, binding, kind="receipt", mid="wamid.race", status="sent")
    ingest(db, tenant, binding, kind="receipt", mid="wamid.race", status="failed")
    assert db.get(Message, UUID(message["id"])).state == "read"
    other = draft(client, {"id": str(conversation.id)})
    row = db.get(Message, UUID(other["id"]))
    row.binding_id = binding.id
    row.provider_message_id = "wamid.other"
    row.state = "accepted"
    db.commit()
    ingest(db, tenant, binding, kind="receipt", mid="wamid.other", party="525599999999")
    assert row.state == "accepted"


def test_handoff_revokes_queued_message_immediately(client, db):
    _tenant, _actor, _customer, _binding, conversation = bound(db, client)
    message = draft(client, {"id": str(conversation.id)})
    assert transition(client, message).status_code == 200
    response = client.patch(
        f"/api/v1/messaging/conversations/{conversation.id}",
        json={"expected_version": 1, "automation_paused": True},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 200, response.text
    assert db.get(Message, UUID(message["id"])).state == "suppressed"


def test_private_channel_binding_and_content_are_immutable_to_runtime(
    owner_engine, kova_app_engine
):
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError

    tenant, other, binding, conversation, message = uuid4(), uuid4(), uuid4(), uuid4(), uuid4()
    with owner_engine.begin() as connection:
        for identifier in (tenant, other):
            connection.execute(
                text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Inbox RLS',:slug)"),
                {"id": identifier, "slug": str(identifier)},
            )
        connection.execute(
            text(
                "INSERT INTO messaging_channel_bindings(id,tenant_id,branch_id,waba_id,phone_number_id,enabled,verified_at,created_at) VALUES(:id,:tenant,:tenant,'123',:phone,false,now(),now())"
            ),
            {"id": binding, "tenant": tenant, "phone": str(int(uuid4()) % 10**20 + 1)},
        )
        connection.execute(
            text(
                "INSERT INTO messaging_conversations(id,tenant_id,branch_id,subject,origin,status,automation_paused,version,created_at,updated_at) VALUES(:id,:tenant,:tenant,'Privado','manual','open',true,1,now(),now())"
            ),
            {"id": conversation, "tenant": tenant},
        )
        connection.execute(
            text(
                "INSERT INTO messaging_messages(id,tenant_id,branch_id,conversation_id,direction,body,message_type,state,version,created_at,updated_at) VALUES(:id,:tenant,:tenant,:conversation,'outbound','Privado','text','draft',1,now(),now())"
            ),
            {"id": message, "tenant": tenant, "conversation": conversation},
        )
    try:
        with kova_app_engine.connect() as connection:
            tables = (
                "messaging_channel_bindings",
                "messaging_conversations",
                "messaging_messages",
                "messaging_channel_events",
            )
            for visible in (None, other, tenant):
                if visible:
                    connection.execute(
                        text("SELECT set_config('app.tenant_id',:id,true)"), {"id": str(visible)}
                    )
                for table in tables:
                    rows = connection.execute(
                        text(f"SELECT id FROM {table} WHERE tenant_id=:tenant"), {"tenant": tenant}
                    ).all()
                    assert bool(rows) == (visible == tenant and table != "messaging_channel_events")
                connection.rollback()
            for query in (
                "UPDATE messaging_channel_bindings SET enabled=true WHERE id=:id",
                "UPDATE messaging_messages SET body='changed' WHERE id=:id",
                "UPDATE messaging_conversations SET tenant_id=:other WHERE id=:id",
            ):
                connection.execute(
                    text("SELECT set_config('app.tenant_id',:id,true)"), {"id": str(tenant)}
                )
                with pytest.raises(DBAPIError):
                    connection.execute(
                        text(query),
                        {
                            "id": binding
                            if "bindings" in query
                            else message
                            if "messages" in query
                            else conversation,
                            "other": other,
                        },
                    )
                connection.rollback()
    finally:
        with owner_engine.begin() as connection:
            for table in (
                "messaging_channel_events",
                "messaging_messages",
                "messaging_conversations",
                "messaging_channel_bindings",
            ):
                connection.execute(text(f"DELETE FROM {table} WHERE tenant_id=:id"), {"id": tenant})
            connection.execute(
                text("DELETE FROM tenants WHERE id IN (:a,:b)"), {"a": tenant, "b": other}
            )


def source_setup(client, db):
    from app.customer_orders.models import CustomerOrder
    from app.tests.test_automations import _ready

    tenant, order = _ready(client, db)
    row = db.get(CustomerOrder, UUID(order["id"]))
    row.customer_phone = "525512345678"
    db.commit()
    response = client.post(
        "/api/v1/customers",
        json={"name": "Cliente del pedido", "phone": "525512345678"},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 201, response.text
    customer = response.json()
    conversation = create(client, customer)
    client.post("/api/v1/automations/process")
    run = client.get("/api/v1/automations").json()["runs"][0]
    body = {
        "automation_run_id": run["id"],
        "expected_run_version": run["version"],
        "conversation_id": conversation["id"],
    }
    return tenant, row, customer, conversation, run, body


def test_automation_source_draft_is_real_idempotent_and_invalidated_by_order_change(client, db):
    _tenant, order, _customer, _conversation, run, body = source_setup(client, db)
    response = post(client, "/drafts/from-automation", body, "from-run")
    assert response.status_code == 201, response.text
    message = response.json()
    assert message["source_run_id"] == run["id"] and message["state"] == "draft"
    assert order.folio in message["body"]
    assert post(client, "/drafts/from-automation", body, "from-run").json() == message
    replay = post(client, "/drafts/from-automation", body, "different-key")
    assert replay.status_code == 200 and replay.json()["id"] == message["id"]
    order.status = "cancelled"
    order.version += 1
    db.commit()
    assert post(client, "/drafts/from-automation", body).status_code == 409
    queued = transition(client, message)
    assert queued.status_code == 409 and queued.json()["detail"]["code"] == "source_changed"


def test_automation_source_never_guesses_customer_when_contact_is_ambiguous(client, db):
    _tenant, _order, _customer, _conversation, _run, body = source_setup(client, db)
    assert (
        client.post(
            "/api/v1/customers",
            json={"name": "Otra persona", "phone": "525512345678"},
            headers={"Idempotency-Key": str(uuid4())},
        ).status_code
        == 201
    )
    response = post(client, "/drafts/from-automation", body)
    assert response.status_code == 409 and "ambiguo" in response.json()["detail"]


def test_automation_source_requires_current_version_and_rule(client, db):
    _tenant, _order, _customer, _conversation, run, body = source_setup(client, db)
    assert (
        post(
            client, "/drafts/from-automation", {**body, "expected_run_version": run["version"] + 1}
        ).status_code
        == 409
    )
    rules = client.get("/api/v1/automations").json()["rules"]
    rule = next(rule for rule in rules if rule["template_key"] == "order_ready")
    assert (
        client.put(
            "/api/v1/automations/rules/order_ready",
            json={"enabled": False, "expected_version": rule["version"]},
        ).status_code
        == 200
    )
    assert post(client, "/drafts/from-automation", body).status_code == 409


def test_worker_recovers_secondary_branch_without_rule_or_policy_and_never_sends(
    client, db, monkeypatch
):
    from sqlalchemy.orm import Session

    from app.automations import worker

    tenant, _actor, _customer, _binding, main_conversation = bound(db, client)
    main_message = draft(client, {"id": str(main_conversation.id)})
    branch = client.post(
        "/api/v1/branches",
        json={"name": "Mensajería sin reglas"},
        headers={"Idempotency-Key": str(uuid4())},
    ).json()
    branch_id = UUID(branch["id"])
    db.info["kova_branch_id"] = branch_id
    binding = ChannelBinding(
        tenant_id=tenant,
        branch_id=branch_id,
        waba_id="9876",
        phone_number_id=str(int(uuid4()) % 10**20 + 1),
        verified_at=datetime.now(UTC),
        enabled=True,
    )
    db.add(binding)
    db.flush()
    conversation = Conversation(
        tenant_id=tenant,
        branch_id=branch_id,
        binding_id=binding.id,
        external_party="525511111111",
        origin="whatsapp",
        subject="Entrega interrumpida",
        automation_paused=False,
    )
    db.add(conversation)
    db.flush()
    interrupted = Message(
        tenant_id=tenant,
        branch_id=branch_id,
        conversation_id=conversation.id,
        binding_id=binding.id,
        direction="outbound",
        body="Texto",
        purpose="transactional",
        state="sending",
        updated_at=datetime.now(UTC) - timedelta(minutes=2),
    )
    db.add(interrupted)
    db.flush()
    db.commit()
    db.info.pop("kova_branch_id", None)
    connection = db.get_bind()
    monkeypatch.setattr(
        worker,
        "SessionLocal",
        lambda: Session(bind=connection, join_transaction_mode="create_savepoint"),
    )
    monkeypatch.setattr(
        service, "dispatch_one", lambda **_kwargs: pytest.fail("No envío en recuperación")
    )
    assert worker.process_tenant(tenant) == 0
    db.expire_all()
    assert db.get(Message, interrupted.id).state == "uncertain"
    assert db.get(Message, UUID(main_message["id"])).state == "draft"
