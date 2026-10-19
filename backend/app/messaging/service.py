"""Inbox/outbox with explicit human control. No credentials or live ingress wiring."""

import hashlib
import re
from datetime import timedelta

from pydantic import SecretStr
from sqlalchemy import text

from app.audit import service as audit
from app.auth.models import Membership, User
from app.billing.access import get_billing_access_status
from app.branches.scope import active_branch_id
from app.crm.service import _assignee, _contact_fingerprint, _customer, contact_allowed
from app.idempotency import service as idempotency
from app.messaging.models import ChannelBinding, ChannelEventRecord, Conversation, Message, now
from app.messaging.schemas import ConversationResponse, MessageResponse
from app.messaging.webhooks import parse_verified_webhook
from app.messaging.whatsapp import ChannelError
from app.shared.exceptions import bad_request, conflict, not_found
from app.tenants.models import Tenant


def _scope(db, tenant, model):
    return db.query(model).filter(
        model.tenant_id == tenant, model.branch_id == active_branch_id(db, tenant)
    )


def _lock(db, tenant):
    # Serialize mutation/dispatch/receipt decisions in this branch. No content in lock IDs.
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:scope,0))"),
        {"scope": f"messaging:{tenant}:{active_branch_id(db, tenant)}"},
    )


def _conversation(db, tenant, identifier):
    row = _scope(db, tenant, Conversation).filter_by(id=identifier).first()
    if row is None:
        raise not_found("Conversación no encontrada")
    return row


def _message(db, tenant, identifier):
    row = _scope(db, tenant, Message).filter_by(id=identifier).first()
    if row is None:
        raise not_found("Mensaje no encontrado")
    return row


def _conversation_response(db, row):
    values = {
        key: getattr(row, key)
        for key in ConversationResponse.model_fields
        if key != "customer_name"
    }
    customer = _customer(db, row.tenant_id, row.customer_id) if row.customer_id else None
    return ConversationResponse(
        **values, customer_name=customer.name if customer else None
    ).model_dump(mode="json")


def _message_response(row):
    return MessageResponse.model_validate(row).model_dump(mode="json")


def _claim(db, tenant, key, scope, body):
    if not key or not key.strip() or len(key) > 255:
        raise bad_request("Idempotency-Key debe contener entre 1 y 255 caracteres")
    fingerprint = hashlib.sha256(f"messaging:{scope}:{body.model_dump_json()}".encode()).hexdigest()
    replay = idempotency.claim(db, tenant_id=tenant, key=key, request_hash=fingerprint)
    return fingerprint, replay


def _finish(db, tenant, actor, key, fingerprint, row, result, status, action):
    audit.log(
        db,
        tenant_id=tenant,
        user_id=actor,
        action=action,
        resource_type="messaging",
        resource_id=row.id,
        changes={"version": row.version},
    )
    idempotency.store(
        db,
        tenant_id=tenant,
        key=key,
        request_hash=fingerprint,
        response_status=status,
        response_body=result,
    )
    db.commit()
    return status, result


def conversations(db, tenant, *, limit=100, offset=0):
    rows = (
        _scope(db, tenant, Conversation)
        .order_by(Conversation.updated_at.desc(), Conversation.id)
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    return {
        "items": [_conversation_response(db, row) for row in rows[:limit]],
        "has_more": len(rows) > limit,
        "channel_status": "not_connected",
    }


def create_conversation(db, tenant, actor, body, key):
    fingerprint, replay = _claim(db, tenant, key, "conversation.create", body)
    if replay:
        return replay.response_status, replay.response_body
    _lock(db, tenant)
    customer = _customer(db, tenant, body.customer_id)
    if not customer.is_active:
        raise conflict("El cliente está inactivo")
    row = Conversation(
        tenant_id=tenant,
        customer_id=customer.id,
        subject=body.subject,
        origin="manual",
        automation_paused=True,
        assigned_user_id=actor,
    )
    db.add(row)
    db.flush()
    return _finish(
        db,
        tenant,
        actor,
        key,
        fingerprint,
        row,
        _conversation_response(db, row),
        201,
        "messaging.conversation.created",
    )


def _phone(value):
    return re.sub(r"[^0-9]", "", value or "")


def update_conversation(db, tenant, actor, identifier, body, key):
    fingerprint, replay = _claim(db, tenant, key, f"conversation.{identifier}", body)
    if replay:
        return replay.response_status, replay.response_body
    _lock(db, tenant)
    row = _conversation(db, tenant, identifier)
    if row.version != body.expected_version:
        raise conflict("La conversación cambió; actualiza antes de continuar")
    changes = body.model_dump(exclude_unset=True, exclude={"expected_version"})
    if "assigned_user_id" in changes:
        _assignee(db, tenant, changes["assigned_user_id"])
    if "customer_id" in changes and changes["customer_id"] is not None:
        customer = _customer(db, tenant, changes["customer_id"])
        if not customer.is_active or (
            row.origin == "whatsapp" and _phone(customer.phone) != row.external_party
        ):
            raise conflict("Verifica que el contacto corresponde al cliente activo elegido")
    for name, value in changes.items():
        setattr(row, name, value)
    row.version += 1
    row.updated_at = now()
    # Closing, handoff or relinking revokes unsent authorizations immediately.
    if row.status == "closed" or row.automation_paused or "customer_id" in changes:
        for message in (
            _scope(db, tenant, Message).filter_by(conversation_id=row.id, state="queued").all()
        ):
            _state(message, "suppressed", "conversation_changed")
    db.flush()
    return _finish(
        db,
        tenant,
        actor,
        key,
        fingerprint,
        row,
        _conversation_response(db, row),
        200,
        "messaging.conversation.updated",
    )


def messages(db, tenant, identifier, *, limit=100, offset=0):
    _conversation(db, tenant, identifier)
    rows = (
        _scope(db, tenant, Message)
        .filter_by(conversation_id=identifier)
        .order_by(Message.created_at, Message.id)
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    return {
        "items": [_message_response(row) for row in rows[:limit]],
        "has_more": len(rows) > limit,
    }


def create_message(db, tenant, actor, identifier, body, key):
    fingerprint, replay = _claim(db, tenant, key, f"message.create.{identifier}", body)
    if replay:
        return replay.response_status, replay.response_body
    _lock(db, tenant)
    conversation = _conversation(db, tenant, identifier)
    if conversation.status != "open":
        raise conflict("Reabre la conversación antes de preparar un mensaje")
    row = Message(
        tenant_id=tenant,
        conversation_id=conversation.id,
        direction="outbound",
        body=body.body,
        purpose=body.purpose,
        state="draft",
        requested_by_user_id=actor,
    )
    db.add(row)
    db.flush()
    return _finish(
        db,
        tenant,
        actor,
        key,
        fingerprint,
        row,
        _message_response(row),
        201,
        "messaging.message.drafted",
    )


def _state(row, state, error=None):
    row.state = state
    row.error_code = error
    row.version += 1
    row.updated_at = now()


def _send_policy(db, tenant, message, conversation, *, stamp):
    if message.source_run_id:
        try:
            _automation_source(db, tenant, conversation, message.source_run_id)
        except Exception as exc:
            from fastapi import HTTPException

            if not isinstance(exc, HTTPException):
                raise
            return "source_changed", None
    binding = (
        _scope(db, tenant, ChannelBinding).filter_by(id=conversation.binding_id).first()
        if conversation.binding_id
        else None
    )
    if binding is None or not binding.enabled or binding.verified_at is None:
        return "channel_not_connected", None
    active_tenant = db.query(Tenant).filter_by(id=tenant, is_active=True).first()
    if active_tenant is None or not get_billing_access_status(db, tenant_id=tenant).allowed:
        return "business_access_revoked", None
    member = (
        db.query(Membership)
        .join(User, User.id == Membership.user_id)
        .filter(
            Membership.tenant_id == tenant,
            Membership.user_id == message.requested_by_user_id,
            Membership.is_active.is_(True),
            User.is_active.is_(True),
            Membership.role.in_(["owner", "manager"]),
        )
        .first()
    )
    if member is None or (
        member.allowed_branch_id is not None and member.allowed_branch_id != conversation.branch_id
    ):
        return "authorization_revoked", None
    if conversation.status != "open" or conversation.automation_paused:
        return "human_handoff", None
    if conversation.customer_id is None:
        return "customer_link_required", None
    customer = _customer(db, tenant, conversation.customer_id)
    current = _contact_fingerprint(customer, "whatsapp")
    if not contact_allowed(
        db,
        tenant_id=tenant,
        branch_id=conversation.branch_id,
        customer_id=customer.id,
        channel="whatsapp",
        purpose=message.purpose,
    ):
        return "consent_required", None
    if message.contact_fingerprint and message.contact_fingerprint != current:
        return "contact_changed", None
    party = conversation.external_party
    if not party or not re.fullmatch(r"[1-9][0-9]{7,14}", party) or _phone(customer.phone) != party:
        return "contact_mismatch", None
    # This delivery path intentionally only implements transactional free text.
    if message.purpose != "transactional":
        return "approved_template_required", None
    inbound = conversation.last_inbound_at
    if inbound is None or not stamp - timedelta(hours=24) < inbound <= stamp:
        return "service_window_closed", None
    return None, (binding, current, party)


def transition_message(db, tenant, actor, identifier, body, key):
    fingerprint, replay = _claim(db, tenant, key, f"message.transition.{identifier}", body)
    if replay:
        return replay.response_status, replay.response_body
    _lock(db, tenant)
    row = _message(db, tenant, identifier)
    if row.version != body.expected_version or row.direction != "outbound":
        raise conflict("El mensaje cambió; actualiza antes de continuar")
    if body.action == "cancel":
        if row.state not in {"draft", "queued"}:
            raise conflict("El envío ya no se puede cancelar con certeza")
        _state(row, "cancelled")
    else:
        if row.state != "draft":
            raise conflict("Sólo se puede autorizar un borrador")
        conversation = _conversation(db, tenant, row.conversation_id)
        error, context = _send_policy(db, tenant, row, conversation, stamp=now())
        if error:
            raise conflict(
                {
                    "code": error,
                    "message": (
                        "El mensaje permanece como borrador; "
                        "revisa canal, permiso y atención humana"
                    ),
                }
            )
        binding, contact, _party = context
        row.binding_id = binding.id
        row.contact_fingerprint = contact
        _state(row, "queued")
    db.flush()
    return _finish(
        db,
        tenant,
        actor,
        key,
        fingerprint,
        row,
        _message_response(row),
        200,
        "messaging.message.authorized" if body.action == "queue" else "messaging.message.cancelled",
    )


def _apply_receipts(db, tenant, message):
    if not message.provider_message_id or message.direction != "outbound":
        return
    conversation = _conversation(db, tenant, message.conversation_id)
    events = (
        _scope(db, tenant, ChannelEventRecord)
        .filter_by(
            binding_id=message.binding_id,
            kind="receipt",
            provider_message_id=message.provider_message_id,
            recipient=conversation.external_party,
        )
        .all()
    )
    # Delivery/read evidence wins over failure; out-of-order receipts cannot downgrade.
    rank = {"accepted": 0, "sent": 1, "failed": 1, "delivered": 2, "read": 3}
    for event in sorted(events, key=lambda event: (rank.get(event.status, 0), event.happened_at)):
        if rank.get(event.status, -1) > rank.get(message.state, -1) or (
            event.status == "failed"
            and message.state in {"accepted", "sent", "uncertain", "sending"}
        ):
            _state(message, event.status)


def ingest_webhook(
    db, *, tenant_id, binding_id, raw_body: bytes, signature: str, app_secret: SecretStr
):
    """Internal caller must resolve tenant/binding from trusted configuration, never payload."""
    _lock(db, tenant_id)
    binding = _scope(db, tenant_id, ChannelBinding).filter_by(id=binding_id).first()
    if binding is None or binding.verified_at is None or not binding.enabled:
        raise ChannelError("trusted_channel_binding_required")
    envelope = parse_verified_webhook(
        raw_body=raw_body,
        signature=signature,
        app_secret=app_secret,
        expected_waba_id=binding.waba_id,
        expected_phone_number_id=binding.phone_number_id,
    )
    accepted = 0
    stamp = now()
    for event in envelope.events:
        if event.timestamp > stamp + timedelta(minutes=5):
            raise ChannelError("webhook_timestamp_invalid")
        if (
            _scope(db, tenant_id, ChannelEventRecord)
            .filter_by(binding_id=binding.id, dedupe_key=event.dedupe_key)
            .first()
        ):
            continue
        db.add(
            ChannelEventRecord(
                tenant_id=tenant_id,
                binding_id=binding.id,
                dedupe_key=event.dedupe_key,
                kind=event.kind,
                provider_message_id=event.message_id,
                status=event.status,
                recipient=event.recipient,
                happened_at=event.timestamp,
            )
        )
        if event.kind == "inbound":
            conversation = (
                _scope(db, tenant_id, Conversation)
                .filter_by(binding_id=binding.id, external_party=event.sender)
                .first()
            )
            if conversation is None:
                conversation = Conversation(
                    tenant_id=tenant_id,
                    binding_id=binding.id,
                    external_party=event.sender,
                    origin="whatsapp",
                    subject="Consulta por WhatsApp",
                    automation_paused=True,
                )
                db.add(conversation)
                db.flush()
            if (
                conversation.last_inbound_at is None
                or event.timestamp > conversation.last_inbound_at
            ):
                conversation.last_inbound_at = event.timestamp
            conversation.version += 1
            conversation.updated_at = stamp
            db.add(
                Message(
                    tenant_id=tenant_id,
                    conversation_id=conversation.id,
                    binding_id=binding.id,
                    provider_message_id=event.message_id,
                    direction="inbound",
                    body=event.text,
                    message_type=event.message_type,
                    state="received",
                    created_at=event.timestamp,
                )
            )
        else:
            db.flush()
            message = (
                _scope(db, tenant_id, Message)
                .filter_by(
                    binding_id=binding.id,
                    provider_message_id=event.message_id,
                    direction="outbound",
                )
                .first()
            )
            if message:
                _apply_receipts(db, tenant_id, message)
        accepted += 1
    db.flush()
    return {"accepted": accepted}


def dispatch_one(db, *, tenant_id, message_id, provider=None, enabled=False):
    """Worker-only. Persist sending BEFORE I/O; a crash never makes it eligible for resend.

    Caller injects one adapter already resolved for the binding by its trusted resolver.
    Disabled by default; no route or global settings can enable network delivery.
    """
    if not enabled or provider is None:
        return {"status": "disabled"}
    _lock(db, tenant_id)
    row = _message(db, tenant_id, message_id)
    if row.state != "queued":
        return {"status": row.state}
    conversation = _conversation(db, tenant_id, row.conversation_id)
    error, context = _send_policy(db, tenant_id, row, conversation, stamp=now())
    if error:
        _state(row, "suppressed", error)
        db.commit()
        return {"status": row.state}
    binding, _contact, party = context
    if getattr(provider, "binding_id", None) != binding.id:
        raise ChannelError("provider_binding_mismatch")
    _state(row, "sending")
    db.commit()
    try:
        result = provider.send_text(to=party, text=row.body)
    except Exception as exc:
        # Fixed local codes only; arbitrary SDK/provider exception text is never stored.
        _lock(db, tenant_id)
        db.refresh(row)
        _state(
            row,
            "uncertain" if not isinstance(exc, ChannelError) or exc.ambiguous else "failed",
            "provider_result_ambiguous"
            if not isinstance(exc, ChannelError) or exc.ambiguous
            else "provider_rejected",
        )
        db.commit()
        return {"status": row.state}
    _lock(db, tenant_id)
    db.refresh(row)
    row.provider_message_id = result.message_id
    _state(row, "accepted")
    db.flush()
    _apply_receipts(db, tenant_id, row)
    db.commit()
    return {"status": row.state}


def recover_uncertain(db, *, tenant_id, stamp=None, limit=100):
    """Mark interrupted I/O visible, without requeue. Receipt ledger can reconcile later."""
    _lock(db, tenant_id)
    stamp = stamp or now()
    rows = (
        _scope(db, tenant_id, Message)
        .filter(Message.state == "sending", Message.updated_at < stamp - timedelta(minutes=1))
        .order_by(Message.updated_at, Message.id)
        .limit(min(max(limit, 1), 100))
        .all()
    )
    for row in rows:
        _state(row, "uncertain", "interrupted_delivery")
    db.flush()
    return len(rows)


def _automation_source(db, tenant, conversation, run_id, expected_version=None):
    from sqlalchemy import func

    from app.automations.models import AutomationRule, AutomationRun
    from app.automations.service import _authorized, _source_valid
    from app.customer_orders.models import CustomerOrder
    from app.customers.models import Customer

    run = _scope(db, tenant, AutomationRun).filter_by(id=run_id).first()
    if (
        run is None
        or run.status != "pending"
        or (expected_version is not None and run.version != expected_version)
        or run.template_key not in {"order_ready", "order_fulfilled"}
    ):
        raise conflict("La tarea de pedido cambió o ya no está pendiente")
    rule = _scope(db, tenant, AutomationRule).filter_by(id=run.rule_id).first()
    if (
        not rule
        or not rule.enabled
        or rule.version != run.rule_version
        or not _authorized(db, rule)
        or not _source_valid(
            db,
            tenant_id=tenant,
            branch_id=conversation.branch_id,
            template_key=run.template_key,
            entity_id=run.entity_id,
            entity_version=run.entity_version,
        )
    ):
        raise conflict("La autorización o los datos del pedido cambiaron")
    if conversation.customer_id is None or conversation.status != "open":
        raise conflict("Elige una conversación abierta con cliente vinculado")
    customer = _customer(db, tenant, conversation.customer_id)
    order = _scope(db, tenant, CustomerOrder).filter_by(id=run.entity_id).first()
    phone = _phone(order.customer_phone)
    if not customer.is_active or not phone or phone != _phone(customer.phone):
        raise conflict("El contacto del pedido no coincide con el cliente elegido")
    matches = (
        db.query(func.count(Customer.id))
        .filter(
            Customer.tenant_id == tenant,
            Customer.is_active.is_(True),
            func.regexp_replace(Customer.phone, r"\D", "", "g") == phone,
        )
        .scalar()
    )
    if matches != 1:
        raise conflict("El teléfono es ambiguo; revisa los clientes antes de preparar el aviso")
    return run, order, customer


def draft_from_automation(db, tenant, actor, body, key):
    fingerprint, replay = _claim(db, tenant, key, "draft.from_automation", body)
    if replay:
        return replay.response_status, replay.response_body
    _lock(db, tenant)
    conversation = _conversation(db, tenant, body.conversation_id)
    run, order, customer = _automation_source(
        db, tenant, conversation, body.automation_run_id, body.expected_run_version
    )
    existing = _scope(db, tenant, Message).filter_by(source_run_id=run.id).first()
    if existing:
        if existing.conversation_id != conversation.id:
            raise conflict("La tarea ya tiene un borrador en otra conversación")
        return _finish(
            db,
            tenant,
            actor,
            key,
            fingerprint,
            existing,
            _message_response(existing),
            200,
            "messaging.message.source_replayed",
        )
    text = (
        f"Tu pedido {order.folio} está listo."
        if run.template_key == "order_ready"
        else f"Gracias por tu compra. Registramos la entrega del pedido {order.folio}."
    )
    row = Message(
        tenant_id=tenant,
        conversation_id=conversation.id,
        source_run_id=run.id,
        direction="outbound",
        body=text,
        purpose="transactional",
        state="draft",
        requested_by_user_id=actor,
        contact_fingerprint=_contact_fingerprint(customer, "whatsapp"),
    )
    db.add(row)
    db.flush()
    return _finish(
        db,
        tenant,
        actor,
        key,
        fingerprint,
        row,
        _message_response(row),
        201,
        "messaging.message.from_automation",
    )
