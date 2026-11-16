"""Transactional reservation snapshots and private previews; delivery has separate gates."""

import hashlib
import json
import re
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from app.appointments.models import Appointment, AppointmentResource
from app.bookings.models import PublicBooking, TableReservation
from app.branches.scope import active_branch_id
from app.business_settings.models import BusinessProfile
from app.config import settings
from app.crm.service import contact_allowed
from app.customers.models import Customer
from app.messaging.models import ReservationNotice, ReservationNoticePolicy
from app.tenants.models import Tenant

TEMPLATES = {
    "confirmation": "kova_reserva_confirmacion_v1",
    "reminder": "kova_reserva_recordatorio_v1",
}


def now():
    return datetime.now(UTC)


def _scope(db, tenant, model):
    return db.query(model).filter_by(tenant_id=tenant, branch_id=active_branch_id(db, tenant))


def _snapshot(row, appointment, resource):
    effective = appointment or row
    return {
        "starts_at": effective.starts_at.astimezone(UTC).isoformat(),
        "ends_at": getattr(effective, "ends_at", effective.starts_at).astimezone(UTC).isoformat(),
        "resource": str(effective.resource_id),
        "timezone": resource.timezone if isinstance(row, Appointment) else row.timezone,
        "party_size": getattr(row, "party_size", None),
    }


def _fingerprint(snapshot):
    return hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()


def _suppress(db, tenant, column, identifier):
    for notice in (
        _scope(db, tenant, ReservationNotice)
        .filter_by(**{column: identifier}, state="prepared")
        .all()
    ):
        notice.state = "suppressed"
        if notice.message_id:
            from app.messaging import service
            from app.messaging.models import Message

            message = _scope(db, tenant, Message).filter_by(id=notice.message_id).first()
            if message and message.state == "queued":
                service._state(message, "suppressed", "reservation_changed")
    # Flush updates before inserts under the partial unique index.
    db.flush()


def refresh(db, row, *, appointment=None):
    """Called under the domain's existing resource lock, in the same transaction."""
    db.flush()
    tenant = row.tenant_id
    column = (
        "appointment_id"
        if isinstance(row, Appointment)
        else "booking_id"
        if isinstance(row, PublicBooking)
        else "reservation_id"
    )
    if isinstance(row, Appointment):
        booking = _scope(db, tenant, PublicBooking).filter_by(appointment_id=row.id).first()
        if booking:
            return refresh(db, booking, appointment=row)
    elif isinstance(row, PublicBooking) and row.appointment_id:
        # Materializing an online reservation must not create a second notice.
        _suppress(db, tenant, "appointment_id", row.appointment_id)
        appointment = (
            appointment or _scope(db, tenant, Appointment).filter_by(id=row.appointment_id).one()
        )
    effective = appointment or row
    status = "confirmed" if isinstance(row, TableReservation) else "scheduled"
    eligible = effective.status == status and row.status == status and effective.starts_at > now()
    active = (
        _scope(db, tenant, ReservationNotice).filter_by(**{column: row.id}, state="prepared").all()
    )
    if not eligible:
        _suppress(db, tenant, column, row.id)
        return
    resource = _scope(db, tenant, AppointmentResource).filter_by(id=effective.resource_id).one()
    fingerprint = _fingerprint(_snapshot(row, appointment, resource))
    if active and all(n.snapshot_hash == fingerprint for n in active):
        return
    _suppress(db, tenant, column, row.id)
    stamp = now()
    revision = f"{row.version}:{appointment.version if appointment else 0}"
    customer = (
        db.query(Customer).filter_by(tenant_id=tenant, id=row.customer_id).first()
        if isinstance(row, Appointment)
        else None
    )
    phone = customer.phone if customer else getattr(row, "phone", None)
    recipient_hash = hashlib.sha256(_phone(phone).encode()).hexdigest()
    from app.messaging.reservation_delivery import admitted

    policy = (
        _scope(db, tenant, ReservationNoticePolicy).filter_by(enabled=True).first()
        if settings.whatsapp_reservation_sending_enabled and admitted(tenant)
        else None
    )
    for kind, due in (
        ("confirmation", stamp),
        ("reminder", effective.starts_at - timedelta(hours=24)),
    ):
        # Close reservations get a confirmation only, not an overdue reminder too.
        if kind == "reminder" and due <= stamp:
            continue
        db.add(
            ReservationNotice(
                tenant_id=tenant,
                branch_id=row.branch_id,
                **{column: row.id},
                source_revision=revision,
                policy_version=policy.version if policy else None,
                snapshot_hash=fingerprint,
                kind=kind,
                recipient_hash=recipient_hash,
                starts_at=effective.starts_at,
                due_at=due,
                created_at=stamp,
            )
        )
    db.flush()


def _phone(value):
    # Exact comparison only; never infer identity or a country code from a match.
    return "".join(c for c in (value or "") if c.isascii() and c.isdigit())


def international_phone(value):
    return bool(
        value
        and re.fullmatch(r"\+[1-9][0-9 ()-]{7,29}", value.strip())
        and 8 <= len(_phone(value)) <= 15
    )


def listing(db, tenant, *, limit=50, offset=0, owner=False):
    stamp = now()
    notices = (
        _scope(db, tenant, ReservationNotice)
        .filter(
            ReservationNotice.state == "prepared",
            ReservationNotice.message_id.is_(None),
            ReservationNotice.starts_at > stamp,
        )
        .order_by(ReservationNotice.starts_at, ReservationNotice.due_at, ReservationNotice.id)
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    selected = notices[:limit]
    sources = {}
    for column, model in (
        ("appointment_id", Appointment),
        ("booking_id", PublicBooking),
        ("reservation_id", TableReservation),
    ):
        identifiers = [getattr(n, column) for n in selected if getattr(n, column)]
        sources[column] = (
            {r.id: r for r in _scope(db, tenant, model).filter(model.id.in_(identifiers)).all()}
            if identifiers
            else {}
        )
    appointment_ids = [r.appointment_id for r in sources["booking_id"].values() if r.appointment_id]
    appointments = (
        {
            r.id: r
            for r in _scope(db, tenant, Appointment)
            .filter(Appointment.id.in_(appointment_ids))
            .all()
        }
        if appointment_ids
        else {}
    )
    rows = [r for group in sources.values() for r in group.values()]
    resource_ids = {r.resource_id for r in [*rows, *appointments.values()] if r.resource_id}
    resources = {
        r.id: r
        for r in _scope(db, tenant, AppointmentResource)
        .filter(AppointmentResource.id.in_(resource_ids))
        .all()
    }
    customer_ids = {r.customer_id for r in rows if r.customer_id}
    customers = {
        c.id: c
        for c in db.query(Customer)
        .filter(Customer.tenant_id == tenant, Customer.id.in_(customer_ids))
        .all()
    }
    profile = db.query(BusinessProfile).filter_by(tenant_id=tenant).first()
    business = profile.public_name if profile else db.query(Tenant).filter_by(id=tenant).one().name
    items = []
    contact_cache = {}
    for notice in selected:
        column = (
            "appointment_id"
            if notice.appointment_id
            else "booking_id"
            if notice.booking_id
            else "reservation_id"
        )
        row = sources[column].get(getattr(notice, column))
        appointment = (
            appointments.get(row.appointment_id) if isinstance(row, PublicBooking) else None
        )
        effective = appointment or row
        resource = resources.get(effective.resource_id) if effective else None
        expected = "confirmed" if isinstance(row, TableReservation) else "scheduled"
        if (
            not row
            or not resource
            or row.status != expected
            or effective.status != expected
            or notice.snapshot_hash != _fingerprint(_snapshot(row, appointment, resource))
        ):
            continue
        customer = customers.get(row.customer_id)
        recipient = getattr(row, "guest_name", None) or (customer.name if customer else "Cliente")
        phone = (
            getattr(row, "phone", None)
            if not isinstance(row, Appointment)
            else (customer.phone if customer else None)
        )
        if not customer:
            contact_status = "customer_required"
        elif not customer.is_active or not resource.is_active:
            contact_status = "inactive"
        elif hashlib.sha256(_phone(phone).encode()).hexdigest() != notice.recipient_hash:
            contact_status = "contact_changed"
        elif not _phone(phone) or _phone(phone) != _phone(customer.phone):
            contact_status = "contact_mismatch"
        else:
            if customer.id not in contact_cache:
                contact_cache[customer.id] = contact_allowed(
                    db,
                    tenant_id=tenant,
                    branch_id=row.branch_id,
                    customer_id=customer.id,
                    channel="whatsapp",
                    purpose="transactional",
                )
            contact_status = (
                "consent_required"
                if not contact_cache[customer.id]
                else "international_phone_required"
                if not international_phone(customer.phone)
                else "permitted"
            )
        zone = row.timezone if not isinstance(row, Appointment) else resource.timezone
        local = effective.starts_at.astimezone(ZoneInfo(zone))
        timing = f"el {local:%d/%m/%Y} a las {local:%H:%M}"
        lead = "Tu reserva" if notice.kind == "confirmation" else "Te recordamos tu reserva"
        action = "está confirmada para" if notice.kind == "confirmation" else "para"
        body = f"Hola {recipient}. {lead} en {business} {action} {timing}."
        if isinstance(row, TableReservation):
            body += f" Te esperamos con tu grupo de {row.party_size} personas."
        items.append(
            {
                "id": notice.id,
                "source": column.removesuffix("_id"),
                "source_id": row.id,
                "kind": notice.kind,
                "recipient_name": recipient,
                "body": body,
                "starts_at": effective.starts_at,
                "due_at": notice.due_at,
                "timezone": zone,
                "status": "scheduled" if notice.due_at > stamp else "prepared",
                "contact_status": contact_status,
                "template_name": TEMPLATES[notice.kind].replace("reserva", "mesa")
                if isinstance(row, TableReservation)
                else TEMPLATES[notice.kind],
            }
        )
    from app.messaging.reservation_delivery import status

    configuration = {**status(db, tenant), "can_manage": owner}
    return {
        "items": items,
        "has_more": len(notices) > limit,
        "send_enabled": configuration["platform_available"] and configuration["enabled"],
        "template_status": "not_checked",
        "reminder_hours": 24,
        "sending_settings": configuration,
    }
