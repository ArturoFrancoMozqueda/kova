"""Owner opt-in and bounded template delivery through the existing durable outbox."""

import hashlib
import re
from datetime import timedelta

from sqlalchemy import or_, select

from app.appointments import service as agenda
from app.appointments.models import Appointment, AppointmentResource
from app.audit import service as audit
from app.auth.models import Membership, User
from app.bookings.models import PublicBooking, TableReservation
from app.branches.scope import active_branch_id
from app.business_settings.models import BusinessProfile
from app.config import settings
from app.customers.models import Customer
from app.messaging import connections, reservations, service
from app.messaging.models import Conversation, Message, ReservationNotice, ReservationNoticePolicy
from app.messaging.reservation_templates import DEFINITIONS, render
from app.messaging.whatsapp import ChannelError
from app.shared.exceptions import conflict
from app.tenants.models import Tenant


def policy(db, tenant):
    return reservations._scope(db, tenant, ReservationNoticePolicy).first()


def admitted(tenant):
    return str(tenant) in {
        value.strip() for value in settings.automation_tenant_ids.split(",") if value.strip()
    }


def status(db, tenant):
    row = policy(db, tenant)
    return {
        "platform_available": settings.whatsapp_reservation_sending_enabled and admitted(tenant),
        "enabled": bool(row and row.enabled),
        "version": row.version if row else 0,
        "daily_limit": row.daily_limit if row else 10,
    }


def configure(db, tenant, actor, body):
    service._lock(db, tenant)
    row = policy(db, tenant)
    if body.expected_version != (row.version if row else 0):
        raise conflict("La configuración cambió; actualiza antes de continuar")
    if body.enabled:
        if (
            not settings.whatsapp_reservation_sending_enabled
            or not admitted(tenant)
            or not body.accept_costs
        ):
            raise conflict("Los avisos automáticos todavía no están disponibles")
        connection = connections.resolve_connection(db, tenant)
        if not connection or not connection.send_enabled:
            raise conflict("Conecta y habilita WhatsApp antes de activar los avisos")
        try:
            for name in DEFINITIONS:
                connections.reservation_provider_for(connection).require_reservation_template(
                    waba_id=connection.waba_id, name=name
                )
        except ChannelError:
            raise conflict(
                "Las cuatro plantillas de reservas deben estar aprobadas por Meta"
            ) from None
    if row is not None:
        for notice in (
            reservations._scope(db, tenant, ReservationNotice)
            .filter_by(
                policy_version=row.version,
                state="prepared",
            )
            .all()
        ):
            notice.state = "suppressed"
            if notice.message_id:
                message = service._message(db, tenant, notice.message_id)
                if message.state == "queued":
                    service._state(message, "suppressed", "reservation_authorization_changed")
    if row is None:
        row = ReservationNoticePolicy(
            tenant_id=tenant,
            branch_id=active_branch_id(db, tenant),
            authorized_by_user_id=actor,
            version=0,
        )
        db.add(row)
    row.version += 1
    if body.enabled:
        row.binding_id = connection.binding_id
    row.enabled = body.enabled
    row.authorized_by_user_id = actor
    row.daily_limit = body.daily_limit
    row.enabled_since = reservations.now() if body.enabled else None
    row.updated_at = reservations.now()
    db.flush()
    audit.log(
        db,
        tenant_id=tenant,
        user_id=actor,
        action="messaging.reservations.configured",
        resource_type="reservation_policy",
        resource_id=row.id,
        changes={
            "enabled": row.enabled,
            "version": row.version,
            "daily_limit": row.daily_limit,
            "accept_costs": body.accept_costs,
        },
    )
    return status(db, tenant)


def source_context(db, tenant, notice, *, stamp):
    """Lock the same resource as reservation writers and re-read authoritative state."""
    column, model = next(
        (c, m)
        for c, m in (
            ("appointment_id", Appointment),
            ("booking_id", PublicBooking),
            ("reservation_id", TableReservation),
        )
        if getattr(notice, c)
    )
    row = reservations._scope(db, tenant, model).filter_by(id=getattr(notice, column)).first()
    if row is None:
        return None
    agenda._lock(db, tenant, row.resource_id)
    db.refresh(row)
    appointment = (
        reservations._scope(db, tenant, Appointment)
        .filter_by(id=row.appointment_id)
        .populate_existing()
        .first()
        if isinstance(row, PublicBooking) and row.appointment_id
        else None
    )
    effective = appointment or row
    resource = (
        reservations._scope(db, tenant, AppointmentResource)
        .filter_by(id=effective.resource_id)
        .populate_existing()
        .first()
    )
    expected = "confirmed" if isinstance(row, TableReservation) else "scheduled"
    if (
        not resource
        or not resource.is_active
        or row.status != expected
        or effective.status != expected
        or effective.starts_at <= stamp
        or notice.snapshot_hash
        != reservations._fingerprint(reservations._snapshot(row, appointment, resource))
    ):
        return None
    customer = (
        db.query(Customer)
        .filter_by(tenant_id=tenant, id=row.customer_id)
        .populate_existing()
        .first()
        if row.customer_id
        else None
    )
    phone = (
        customer.phone if isinstance(row, Appointment) and customer else getattr(row, "phone", None)
    )
    party = reservations._phone(phone)
    if (
        not customer
        or not customer.is_active
        or not re.fullmatch(r"[1-9][0-9]{7,14}", party)
        or party != reservations._phone(customer.phone)
        or hashlib.sha256(party.encode()).hexdigest() != notice.recipient_hash
    ):
        return None
    from zoneinfo import ZoneInfo

    zone = resource.timezone if isinstance(row, Appointment) else row.timezone
    local = effective.starts_at.astimezone(ZoneInfo(zone))
    profile = db.query(BusinessProfile).filter_by(tenant_id=tenant).first()
    business = profile.public_name if profile else db.query(Tenant).filter_by(id=tenant).one().name
    name = reservations.TEMPLATES[notice.kind]
    parameters = [
        getattr(row, "guest_name", None) or customer.name,
        business,
        local.strftime("%d/%m/%Y"),
        local.strftime("%H:%M"),
    ]
    if isinstance(row, TableReservation):
        name = name.replace("reserva", "mesa")
        parameters.append(str(row.party_size))
    # Meta text parameters cannot contain line breaks, tabs, or excessive spaces.
    if any(
        not p.strip()
        or len(p) > 1024
        or any(c in p for c in ("\n", "\r", "\t", "\x00"))
        or "    " in p
        for p in parameters
    ):
        return None
    body = render(name, parameters)
    if len(body) > 4096:
        return None
    return customer, party, name, parameters, body


def authorized(db, tenant, notice, *, stamp, actor=None):
    if not settings.whatsapp_reservation_sending_enabled or not admitted(tenant):
        return False
    row = policy(db, tenant)
    if (
        not row
        or not row.enabled
        or row.version != notice.policy_version
        or not row.enabled_since
        or notice.created_at < row.enabled_since
        or notice.state != "prepared"
        or notice.due_at > stamp
        or stamp - notice.due_at > timedelta(minutes=15 if notice.kind == "confirmation" else 60)
        or (actor is not None and actor != row.authorized_by_user_id)
    ):
        return False
    member = (
        db.query(Membership)
        .join(User, User.id == Membership.user_id)
        .filter(
            Membership.tenant_id == tenant,
            Membership.user_id == row.authorized_by_user_id,
            Membership.is_active.is_(True),
            Membership.role == "owner",
            User.is_active.is_(True),
            User.is_email_verified.is_(True),
        )
        .first()
    )
    return bool(
        member
        and (member.allowed_branch_id is None or member.allowed_branch_id == notice.branch_id)
    )


def message_context(db, tenant, message, conversation, *, stamp):
    notice = (
        reservations._scope(db, tenant, ReservationNotice)
        .filter_by(message_id=message.id)
        .populate_existing()
        .first()
    )
    if not notice or not authorized(
        db, tenant, notice, stamp=stamp, actor=message.requested_by_user_id
    ):
        return None
    connection = connections.resolve_connection(db, tenant)
    current_policy = policy(db, tenant)
    if (
        not connection
        or not connection.send_enabled
        or connection.binding_id != conversation.binding_id
        or current_policy.binding_id != conversation.binding_id
    ):
        return None
    detail = source_context(db, tenant, notice, stamp=stamp)
    if not detail:
        return None
    customer, party, name, parameters, body = detail
    if (
        customer.id != conversation.customer_id
        or party != conversation.external_party
        or message.body != body
    ):
        return None
    return name, parameters


def process_due(db, tenant, *, limit=25):
    # OFF means zero credential resolution, provider requests or outbox mutation.
    if not settings.whatsapp_reservation_sending_enabled or not admitted(tenant):
        return 0
    service._lock(db, tenant)
    row = policy(db, tenant)
    if not row or not row.enabled:
        return 0
    connection = connections.resolve_connection(db, tenant)
    if not connection or not connection.send_enabled or row.binding_id != connection.binding_id:
        return 0
    identifiers = [
        n.id
        for n in reservations._scope(db, tenant, ReservationNotice)
        .filter(
            ReservationNotice.state == "prepared",
            ReservationNotice.policy_version == row.version,
            ReservationNotice.due_at <= reservations.now(),
            or_(
                ReservationNotice.message_id.is_(None),
                ReservationNotice.message_id.in_(
                    select(Message.id).where(Message.tenant_id == tenant, Message.state == "queued")
                ),
            ),
        )
        .order_by(ReservationNotice.due_at, ReservationNotice.id)
        .limit(min(max(limit, 1), 25))
        .all()
    ]
    processed = 0
    for identifier in identifiers:
        service._lock(db, tenant)
        notice = (
            reservations._scope(db, tenant, ReservationNotice)
            .filter_by(id=identifier)
            .populate_existing()
            .one()
        )
        row = policy(db, tenant)
        if row is None:
            break
        if notice.message_id:
            existing = service._message(db, tenant, notice.message_id)
            if existing.state != "queued":
                continue  # Accepted, uncertain and failed sends are never automatically retried.
        if not authorized(db, tenant, notice, stamp=reservations.now()):
            notice.state = "suppressed"
            if notice.message_id:
                service._state(
                    service._message(db, tenant, notice.message_id),
                    "suppressed",
                    "reservation_authorization_changed",
                )
            db.flush()
            continue
        detail = source_context(db, tenant, notice, stamp=reservations.now())
        if not detail:
            notice.state = "suppressed"
            if notice.message_id:
                service._state(
                    service._message(db, tenant, notice.message_id),
                    "suppressed",
                    "reservation_authorization_changed",
                )
            db.flush()
            continue
        customer, party, _name, _parameters, body = detail
        conversation = (
            reservations._scope(db, tenant, Conversation)
            .filter_by(
                binding_id=connection.binding_id,
                external_party=party,
            )
            .first()
        )
        if conversation is None:
            conversation = Conversation(
                tenant_id=tenant,
                branch_id=notice.branch_id,
                customer_id=customer.id,
                binding_id=connection.binding_id,
                external_party=party,
                origin="business",
                subject="Avisos de reservas",
                automation_paused=False,
                assigned_user_id=row.authorized_by_user_id,
                last_inbound_at=None,
            )
            db.add(conversation)
            db.flush()
        if (
            conversation.customer_id != customer.id
            or conversation.status != "open"
            or conversation.automation_paused
        ):
            notice.state = "suppressed"
            if notice.message_id:
                service._state(
                    service._message(db, tenant, notice.message_id),
                    "suppressed",
                    "reservation_authorization_changed",
                )
            db.flush()
            continue
        if not notice.message_id:
            message = Message(
                tenant_id=tenant,
                branch_id=notice.branch_id,
                conversation_id=conversation.id,
                binding_id=connection.binding_id,
                direction="outbound",
                body=body,
                message_type="template",
                state="queued",
                purpose="transactional",
                requested_by_user_id=row.authorized_by_user_id,
                contact_fingerprint=service._contact_fingerprint(customer, "whatsapp"),
            )
            db.add(message)
            db.flush()
            notice.message_id = message.id
            db.flush()
        provider = connections.reservation_provider_for(connection)
        service.dispatch_one(
            db,
            tenant_id=tenant,
            message_id=notice.message_id,
            provider=provider,
            enabled=True,
            daily_send_limit=min(row.daily_limit, connection.daily_send_limit),
        )
        processed += 1
    return processed
