"""Real PostgreSQL and HTTP, fake Meta only: template outbox and activation gates."""

import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest

from app.auth.models import Membership
from app.config import settings
from app.messaging import connections, reservations, service
from app.messaging import reservation_delivery as delivery
from app.messaging.models import Conversation, Message, ReservationNotice, ReservationNoticePolicy
from app.messaging.reservation_templates import DEFINITIONS, LANGUAGE
from app.messaging.whatsapp import WhatsAppCloudAdapter
from app.tests.test_appointments import book, post, resource
from app.tests.test_crm import consent
from app.tests.test_messaging_inbox import SECRET, bound, envelope
from app.tests.test_whatsapp_delivery import configure

pytestmark = pytest.mark.usefixtures("fast_business_auth")
URL = "/api/v1/messaging/reservation-notices/settings"


@pytest.fixture
def pilot(client, db, monkeypatch):
    tenant, actor, customer, binding, conversation = bound(db, client)
    conversation.last_inbound_at = None
    db.commit()
    configure(monkeypatch, tenant, binding)
    monkeypatch.setattr(settings, "whatsapp_reservation_sending_enabled", True)
    monkeypatch.setattr(settings, "automation_tenant_ids", str(tenant))
    calls = []
    behavior = {"status": "APPROVED", "category": "UTILITY", "fail": False, "extra": False}

    def transport(request):
        calls.append(request)
        if request.method == "GET":
            name = request.url.params["name"]
            components = [{"type": "BODY", "text": DEFINITIONS[name]}]
            if behavior["extra"]:
                components.append({"type": "BUTTONS", "buttons": []})
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "name": name,
                            "language": LANGUAGE,
                            "status": behavior["status"],
                            "category": behavior["category"],
                            "parameter_format": "POSITIONAL",
                            "components": components,
                        }
                    ]
                },
            )
        if behavior["fail"]:
            raise httpx.ReadTimeout("synthetic private detail")
        return httpx.Response(200, json={"messages": [{"id": "wamid." + uuid4().hex}]})

    def provider(connection):
        adapter = WhatsAppCloudAdapter(
            access_token=connection.access_token,
            phone_number_id=connection.phone_number_id,
            api_version="v26.0",
            transport=httpx.MockTransport(transport),
        )
        adapter.binding_id = binding.id
        return adapter

    monkeypatch.setattr(connections, "provider_for", provider)
    return tenant, actor, customer, binding, conversation, calls, behavior


def enable(client, *, version=0, enabled=True, costs=True, limit=10):
    return client.put(
        URL,
        json={
            "expected_version": version,
            "enabled": enabled,
            "accept_costs": costs,
            "daily_limit": limit,
        },
    )


def booking(client, customer, *, selected=None):
    return book(
        client,
        {"id": str(customer.id)},
        selected or resource(client),
        start=(datetime.now(UTC) + timedelta(days=3)).replace(microsecond=0),
    )


def posts(calls):
    return [json.loads(r.content) for r in calls if r.method == "POST"]


def test_default_off_blocks_activation_and_scheduler_before_credentials(
    client, db, monkeypatch, pilot
):
    tenant, _, customer, _, _, calls, _ = pilot
    monkeypatch.setattr(settings, "whatsapp_reservation_sending_enabled", False)

    def forbidden(*args, **kwargs):
        raise AssertionError("OFF must never resolve credentials")

    monkeypatch.setattr(connections, "resolve_connection", forbidden)
    assert enable(client).status_code == 409
    booking(client, customer)
    assert delivery.process_due(db, tenant) == 0
    assert calls == [] and db.query(Message).count() == 0
    assert all(n.policy_version is None for n in db.query(ReservationNotice))
    assert client.get(URL).json()["platform_available"] is False


def test_owner_opt_in_requires_costs_approval_and_version(client, db, pilot):
    tenant, actor, _, _, _, calls, behavior = pilot
    assert enable(client, costs=False).status_code == 409
    behavior["status"] = "PENDING"
    assert enable(client).status_code == 409
    assert db.query(ReservationNoticePolicy).count() == 0
    behavior["status"] = "APPROVED"
    result = enable(client)
    assert result.status_code == 200, result.text
    assert result.json()["version"] == 1
    assert posts(calls) == []
    assert enable(client).status_code == 409
    member = db.query(Membership).filter_by(tenant_id=tenant, user_id=actor).one()
    member.role = "manager"
    db.commit()
    assert enable(client, version=1, enabled=False).status_code == 403
    assert client.get(URL).json()["can_manage"] is False


def test_confirmation_and_due_reminder_use_exact_templates_without_service_window(
    client, db, monkeypatch, pilot
):
    tenant, _, customer, binding, conversation, calls, _ = pilot
    assert enable(client).status_code == 200
    booking(client, customer)
    assert delivery.process_due(db, tenant) == 1
    sent = posts(calls)
    assert len(sent) == 1
    assert sent[0]["type"] == "template"
    template = sent[0]["template"]
    assert template["name"] == "kova_reserva_confirmacion_v1"
    assert template["language"]["code"] == "es_MX"
    assert [p["text"] for p in template["components"][0]["parameters"]][:2] == ["Ana García", "CRM"]
    message = db.query(Message).one()
    assert message.state == "accepted" and conversation.last_inbound_at is None
    assert delivery.process_due(db, tenant) == 0
    reminder = db.query(ReservationNotice).filter_by(kind="reminder").one()
    due = reminder.due_at + timedelta(seconds=1)
    monkeypatch.setattr(reservations, "now", lambda: due)
    monkeypatch.setattr(service, "now", lambda: due)
    assert delivery.process_due(db, tenant) == 1
    assert len(posts(calls)) == 2
    assert posts(calls)[1]["template"]["name"] == "kova_reserva_recordatorio_v1"
    # Signed, exact-binding receipt, not an HTTP success, establishes delivery.
    raw, signature = envelope(
        binding, kind="status", mid=message.provider_message_id, party=customer.phone
    )
    service.ingest_webhook(
        db,
        tenant_id=tenant,
        binding_id=binding.id,
        raw_body=raw,
        signature=signature,
        app_secret=SECRET,
    )
    db.commit()
    db.refresh(message)
    assert message.state == "delivered"
    assert db.query(Message).filter_by(state="accepted").count() == 1


def test_activation_never_releases_previews_or_previous_policy_revision(client, db, pilot):
    tenant, _, customer, _, _, calls, _ = pilot
    selected = resource(client)
    old = booking(client, customer, selected=selected)
    assert all(n.policy_version is None for n in db.query(ReservationNotice))
    assert enable(client).status_code == 200
    assert delivery.process_due(db, tenant) == 0
    assert posts(calls) == []
    # A genuine new reservation after activation is eligible; disable/re-enable revokes it.
    booking(client, customer, selected=resource(client, name="Cabina dos"))
    assert enable(client, version=1, enabled=False).status_code == 200
    assert enable(client, version=2).status_code == 200
    assert delivery.process_due(db, tenant) == 0
    assert posts(calls) == [] and db.query(Message).count() == 0
    assert old["status"] == "scheduled"


@pytest.mark.parametrize(
    "change", ["cancel", "pause", "consent", "phone", "owner", "platform", "expired"]
)
def test_revocation_blocks_before_provider_post(client, db, monkeypatch, pilot, change):
    tenant, actor, customer, _, conversation, calls, _ = pilot
    assert enable(client).status_code == 200
    row = booking(client, customer)
    if change == "cancel":
        assert (
            post(
                client, f"/{row['id']}/transition", {"expected_version": 1, "status": "cancelled"}
            ).status_code
            == 200
        )
    elif change == "pause":
        conversation.automation_paused = True
        db.commit()
    elif change == "consent":
        assert (
            consent(client, {"id": str(customer.id)}, enabled=False, expected_version=1).status_code
            == 200
        )
    elif change == "phone":
        customer.phone = "525599999999"
        db.commit()
    elif change == "owner":
        db.query(Membership).filter_by(tenant_id=tenant, user_id=actor).one().is_active = False
        db.commit()
    elif change == "platform":
        monkeypatch.setattr(settings, "whatsapp_reservation_sending_enabled", False)
    elif change == "expired":
        stamp = reservations.now() + timedelta(hours=2)
        monkeypatch.setattr(reservations, "now", lambda: stamp)
    delivery.process_due(db, tenant)
    assert posts(calls) == []


@pytest.mark.parametrize("change", ["status", "category", "extra"])
def test_template_must_still_be_approved_utility_and_exact_at_delivery(client, db, pilot, change):
    tenant, _, customer, _, _, calls, behavior = pilot
    assert enable(client).status_code == 200
    booking(client, customer)
    behavior[change] = {"status": "PAUSED", "category": "MARKETING", "extra": True}[change]
    assert delivery.process_due(db, tenant) == 1
    assert posts(calls) == []
    assert db.query(Message).one().state == "suppressed"
    assert delivery.process_due(db, tenant) == 0


def test_ambiguous_post_is_visible_and_never_automatically_retried(client, db, pilot):
    tenant, _, customer, _, _, calls, behavior = pilot
    assert enable(client).status_code == 200
    booking(client, customer)
    behavior["fail"] = True
    assert delivery.process_due(db, tenant) == 1
    assert db.query(Message).one().state == "uncertain"
    behavior["fail"] = False
    assert delivery.process_due(db, tenant) == 0
    assert len(posts(calls)) == 1


def test_daily_cap_counts_attempts_and_proactive_conversation_does_not_open_free_text_window(
    client, db, pilot
):
    tenant, _, customer, _, conversation, calls, _ = pilot
    assert enable(client, limit=1).status_code == 200
    db.delete(conversation)
    db.commit()
    booking(client, customer)
    booking(client, customer, selected=resource(client, name="Cabina dos"))
    assert delivery.process_due(db, tenant) == 2
    assert len(posts(calls)) == 1
    convo = db.query(Conversation).one()
    assert convo.origin == "business" and convo.last_inbound_at is None
    assert db.query(Message).filter_by(error_code="daily_send_limit").count() == 1


def test_private_scheduler_discovers_policy_branch_and_does_not_duplicate(
    client, db, monkeypatch, pilot
):
    from contextlib import contextmanager

    from app.automations import worker

    tenant, _, customer, _, _, calls, _ = pilot
    assert enable(client).status_code == 200
    booking(client, customer)

    @contextmanager
    def local_session():
        yield db

    monkeypatch.setattr(worker, "SessionLocal", local_session)
    assert worker.process_tenant(tenant) == 1
    assert worker.process_tenant(tenant) == 0
    db.expire_all()
    assert len(posts(calls)) == 1 and db.query(Message).one().state == "accepted"


def test_runtime_sender_and_configuration_keep_real_rls(
    client, db, monkeypatch, kova_app_engine, pilot
):
    from sqlalchemy import text

    tenant, _, customer, _, _, calls, _ = pilot
    db.execute(text("SET LOCAL ROLE kova_app"))
    assert enable(client).status_code == 200
    booking(client, customer)
    assert delivery.process_due(db, tenant) == 1
    assert len(posts(calls)) == 1
    db.execute(text("SELECT set_config('app.tenant_id', :other, true)"), {"other": str(uuid4())})
    assert db.query(ReservationNotice).count() == 0
    assert db.query(ReservationNoticePolicy).count() == 0
    db.execute(text("SET LOCAL ROLE pos"))
