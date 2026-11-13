"""Table requests are human-reviewed arrivals, never invented occupancy intervals."""

import hashlib
import hmac
from datetime import UTC, datetime, time, timedelta
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import or_

from app.appointments import service as agenda
from app.appointments.models import AppointmentResource
from app.bookings import service as booking
from app.bookings.models import BookingAvailability, TableReservation, TableReservationHistory
from app.config import settings
from app.idempotency import service as idempotency
from app.shared.exceptions import bad_request, conflict, not_found


def resources(db, tenant):
    return (
        booking._scope(db, tenant, AppointmentResource)
        .filter_by(kind="table", is_active=True)
        .order_by(AppointmentResource.name)
        .all()
    )


def arrivals(db, page, day):
    if not page.enabled or page.mode != "tables":
        raise not_found(booking.UNAVAILABLE)
    tables = resources(db, page.tenant_id)
    if not tables or len({r.timezone for r in tables}) != 1:
        return []
    zone = ZoneInfo(tables[0].timezone)
    stamp = datetime.now(UTC)
    if (
        not stamp.astimezone(zone).date()
        <= day
        <= stamp.astimezone(zone).date() + timedelta(days=page.horizon_days)
    ):
        return []
    schedules = (
        booking._scope(db, page.tenant_id, BookingAvailability)
        .filter(BookingAvailability.resource_id.in_([r.id for r in tables]))
        .all()
    )
    candidates = set()
    for schedule in schedules:
        windows = next((d["windows"] for d in schedule.exceptions if d["date"] == str(day)), None)
        if windows is None:
            windows = next(
                (d["windows"] for d in schedule.weekly if d["weekday"] == day.weekday()), []
            )
        for window in windows:
            cursor = datetime.combine(day, time.fromisoformat(window["start"]))
            end = datetime.combine(day, time.fromisoformat(window["end"]))
            while cursor < end:
                for instant in booking._instants(day, cursor.strftime("%H:%M"), zone):
                    if instant >= stamp + timedelta(minutes=page.notice_minutes):
                        candidates.add(instant)
                cursor += timedelta(minutes=page.slot_minutes)
    # These are arrival choices in business hours, not promises of free tables.
    return [
        {"starts_at": s.isoformat(), "timezone": tables[0].timezone} for s in sorted(candidates)
    ]


def _arrival(db, page, starts_at):
    tables = resources(db, page.tenant_id)
    if not tables:
        raise conflict("El negocio no está recibiendo solicitudes de mesa.")
    start = starts_at.astimezone(UTC)
    day = start.astimezone(ZoneInfo(tables[0].timezone)).date()
    if not any(datetime.fromisoformat(s["starts_at"]) == start for s in arrivals(db, page, day)):
        raise conflict(
            "Esa hora no está dentro del horario de solicitudes. "
            "Elige otra; tus datos se conservan."
        )
    return start, tables[0].timezone


def _history(db, row, action, actor=None):
    db.add(
        TableReservationHistory(
            tenant_id=row.tenant_id,
            branch_id=row.branch_id,
            reservation_id=row.id,
            version=row.version,
            action=action,
            actor_user_id=actor,
            starts_at=row.starts_at,
            resource_id=row.resource_id,
            status=row.status,
        )
    )


def _token(page, row):
    return booking._encode(
        "kova-table-manage",
        page,
        reservation=str(row.id),
        version=row.manage_version,
        exp=int((row.starts_at + timedelta(days=400)).timestamp()),
    )


def receipt(db, page, row, *, with_link=False, resource=None):
    resource = resource or (
        agenda._resource(db, row.tenant_id, row.resource_id) if row.resource_id else None
    )
    result = {
        "title": "Reserva de mesa",
        "starts_at": row.starts_at.isoformat(),
        "timezone": row.timezone,
        "party_size": row.party_size,
        "resource_name": resource.name if resource else None,
        "status": row.status,
        "version": row.version,
        "can_manage": row.status in {"requested", "confirmed"}
        and row.starts_at > datetime.now(UTC) + timedelta(hours=page.manage_cutoff_hours),
        "calendar_uid": hmac.new(
            settings.secret_key.encode(), f"table-calendar:{row.id}".encode(), hashlib.sha256
        ).hexdigest()[:32]
        + "@kovasuite.com",
    }
    if with_link:
        result["manage_path"] = f"/reservar/mesa#{_token(page, row)}"
    return result


def _row(db, tenant, row_id, *, lock=False):
    query = booking._scope(db, tenant, TableReservation).filter_by(id=row_id)
    row = query.populate_existing().with_for_update().first() if lock else query.first()
    if not row:
        raise not_found(booking.UNAVAILABLE)
    return row


def summary(db, page, row, resource=None):
    return {
        **receipt(db, page, row, resource=resource),
        "id": str(row.id),
        "name": row.guest_name,
        "phone": row.phone,
        "resource_id": str(row.resource_id) if row.resource_id else None,
        "customer_id": str(row.customer_id) if row.customer_id else None,
        "seated_at": row.seated_at.isoformat() if row.seated_at else None,
        "released_at": row.released_at.isoformat() if row.released_at else None,
    }


def detail(db, tenant, row_id):
    row = _row(db, tenant, row_id)
    events = (
        booking._scope(db, tenant, TableReservationHistory)
        .filter_by(reservation_id=row.id)
        .order_by(TableReservationHistory.version.desc())
        .limit(100)
        .all()
    )
    return {
        **summary(db, booking._page(db, tenant), row),
        "history": [
            {
                "action": h.action,
                "status": h.status,
                "starts_at": h.starts_at.isoformat(),
                "created_at": h.created_at.isoformat(),
            }
            for h in events
        ],
    }


def listing(db, tenant, *, status=None, start=None, end=None, resource_id=None, limit=50, offset=0):
    query = booking._scope(db, tenant, TableReservation)
    if status:
        query = query.filter_by(status=status)
    if start:
        query = query.filter(TableReservation.starts_at >= start)
    if end:
        query = query.filter(TableReservation.starts_at < end)
    if resource_id:
        agenda._resource(db, tenant, resource_id)
        query = query.filter_by(resource_id=resource_id)
    rows = (
        query.order_by(TableReservation.starts_at, TableReservation.id)
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    page = booking._page(db, tenant)
    resource_map = {r.id: r for r in booking._scope(db, tenant, AppointmentResource).all()}
    return {
        "items": [
            summary(db, page, row, resource_map.get(row.resource_id)) for row in rows[:limit]
        ],
        "has_more": len(rows) > limit,
    }


def review(db, tenant, row_id, resource_id):
    row = _row(db, tenant, row_id)
    resource = agenda._resource(db, tenant, resource_id)
    if resource.kind != "table":
        raise bad_request("Elige una mesa para revisar su agenda.")
    zone = ZoneInfo(resource.timezone)
    day = row.starts_at.astimezone(zone).date()
    start = datetime.combine(day, time.min, zone).astimezone(UTC)
    end = datetime.combine(day + timedelta(days=1), time.min, zone).astimezone(UTC)
    rows = (
        booking._scope(db, tenant, TableReservation)
        .filter(
            TableReservation.resource_id == resource.id,
            TableReservation.id != row.id,
            TableReservation.status.in_(["confirmed", "seated"]),
            or_(
                TableReservation.status == "seated",
                (TableReservation.starts_at >= start) & (TableReservation.starts_at < end),
            ),
        )
        .order_by(TableReservation.starts_at, TableReservation.id)
        .limit(101)
        .all()
    )
    page = booking._page(db, tenant)
    return {
        "items": [summary(db, page, other, resource) for other in rows[:100]],
        "has_more": len(rows) > 100,
    }


def create(db, body, key):
    try:
        UUID(key or "")
    except (TypeError, ValueError):
        raise bad_request("Vuelve a enviar la solicitud desde el formulario.") from None
    page = booking.resolve_page(db, body.page_token)
    booking._config_lock(db, page.tenant_id)
    page = booking.resolve_page(db, body.page_token)
    if page.mode != "tables":
        raise not_found(booking.UNAVAILABLE)
    op_hash = hmac.new(
        settings.secret_key.encode(), f"table-request:{page.id}:{key}".encode(), hashlib.sha256
    ).hexdigest()
    request_hash = hashlib.sha256(body.model_dump_json().encode()).hexdigest()
    existing = (
        booking._scope(db, page.tenant_id, TableReservation)
        .filter_by(operation_hash=op_hash)
        .first()
    )
    if existing:
        if not hmac.compare_digest(existing.request_hash, request_hash):
            raise conflict("Esta solicitud ya se envió con otros datos.")
        return receipt(db, page, existing, with_link=True)
    start, zone = _arrival(db, page, body.starts_at)
    row = TableReservation(
        id=uuid4(),
        tenant_id=page.tenant_id,
        branch_id=page.branch_id,
        customer_id=booking._identity(db, page, body.identity_token),
        resource_id=None,
        guest_name=body.name,
        phone=body.phone,
        party_size=body.party_size,
        starts_at=start,
        timezone=zone,
        status="requested",
        version=1,
        manage_version=1,
        operation_hash=op_hash,
        request_hash=request_hash,
    )
    db.add(row)
    db.flush()
    _history(db, row, "requested")
    result = receipt(db, page, row, with_link=True)
    db.commit()
    return result


def resolve_manage(db, token):
    claims = booking._decode(token, "kova-table-manage")
    page = booking._resolve(db, claims)
    try:
        row_id = UUID(claims["reservation"])
    except (ValueError, TypeError, KeyError):
        raise not_found(booking.UNAVAILABLE) from None
    row = _row(db, page.tenant_id, row_id)
    if claims.get("version") != row.manage_version:
        raise not_found(booking.UNAVAILABLE)
    return page, row


def manage(db, body, key):
    page, observed = resolve_manage(db, body.token)
    booking._config_lock(db, page.tenant_id)
    page, _ = resolve_manage(db, body.token)
    row = _row(db, page.tenant_id, observed.id, lock=True)
    digest, replay = booking._claim(db, page.tenant_id, key, f"table-manage:{row.id}", body)
    if replay:
        return replay.response_body
    if not receipt(db, page, row)["can_manage"]:
        raise conflict("Para cambiar esta solicitud, contacta al negocio.")
    if row.version != body.expected_version:
        raise conflict("El estado cambió. Vuelve a consultarlo.")
    if body.action == "cancel":
        row.status = "cancelled"
    else:
        if not body.starts_at:
            raise bad_request("Elige una nueva hora de llegada.")
        row.starts_at, row.timezone = _arrival(db, page, body.starts_at)
        row.status = "requested"
        row.resource_id = None
    row.version += 1
    _history(db, row, body.action)
    db.flush()
    result = receipt(db, page, row)
    idempotency.store(
        db,
        tenant_id=page.tenant_id,
        key=key,
        request_hash=digest,
        response_status=200,
        response_body=result,
    )
    db.commit()
    return result


def act(db, tenant, actor, row_id, body, key):
    booking._config_lock(db, tenant)
    observed = _row(db, tenant, row_id)
    for resource_id in sorted({r for r in (observed.resource_id, body.resource_id) if r}):
        agenda._lock(db, tenant, resource_id)
        agenda._resource(db, tenant, resource_id, lock=True)
    row = _row(db, tenant, row_id, lock=True)
    digest, replay = booking._claim(db, tenant, key, f"table-act:{row.id}", body)
    if replay:
        return replay.response_body
    if row.version != body.expected_version:
        raise conflict("La solicitud cambió. Consulta su estado actual.")
    allowed = {
        "confirm": {"requested"},
        "decline": {"requested"},
        "cancel": {"requested", "confirmed"},
        "seat": {"confirmed"},
        "release": {"seated"},
        "no_show": {"confirmed"},
        "revoke": set(),
    }
    if body.action != "revoke" and row.status not in allowed[body.action]:
        raise conflict("Esta acción no corresponde al estado actual de la reserva.")
    stamp = datetime.now(UTC)
    if body.action == "confirm":
        resource = agenda._resource(db, tenant, body.resource_id)
        if resource.kind != "table" or not resource.is_active or resource.timezone != row.timezone:
            raise bad_request("Elige una mesa activa de la misma zona horaria.")
        if row.starts_at <= stamp:
            raise conflict("La hora solicitada ya pasó. Contacta al cliente antes de confirmar.")
        schedule = booking.availability(db, tenant, resource.id)
        local = row.starts_at.astimezone(ZoneInfo(resource.timezone))
        windows = next(
            (d["windows"] for d in schedule["exceptions"] if d["date"] == str(local.date())), None
        )
        if windows is None:
            windows = next(
                (d["windows"] for d in schedule["weekly"] if d["weekday"] == local.weekday()), []
            )
        if not any(w["start"] <= local.strftime("%H:%M") < w["end"] for w in windows):
            raise conflict("La mesa no recibe solicitudes a esa hora. Revisa sus horarios.")
        if (
            booking._scope(db, tenant, TableReservation)
            .filter(
                TableReservation.resource_id == resource.id,
                TableReservation.starts_at == row.starts_at,
                TableReservation.status.in_(["confirmed", "seated"]),
                TableReservation.id != row.id,
            )
            .first()
        ):
            raise conflict("Esa mesa ya tiene una reserva confirmada para la misma llegada.")
        row.resource_id, row.status = resource.id, "confirmed"
    elif body.action == "seat":
        resource = agenda._resource(db, tenant, row.resource_id)
        if not resource.is_active:
            raise conflict("La mesa está desactivada.")
        if row.starts_at > stamp:
            raise conflict("Aún no es la hora de llegada de esta reserva.")
        if (
            booking._scope(db, tenant, TableReservation)
            .filter_by(resource_id=row.resource_id, status="seated")
            .first()
        ):
            raise conflict("La mesa sigue ocupada. Libérala cuando el cliente se retire.")
        row.status, row.seated_at = "seated", stamp
    elif body.action == "release":
        row.status, row.released_at = "completed", stamp
    elif body.action == "revoke":
        row.manage_version += 1
    elif body.action == "no_show":
        if row.starts_at > stamp:
            raise conflict("Aún no es la hora de llegada de esta reserva.")
        row.status = "no_show"
    else:
        row.status = "declined" if body.action == "decline" else "cancelled"
    row.version += 1
    _history(db, row, body.action, actor)
    db.flush()
    return booking._finish(
        db,
        tenant,
        actor,
        key,
        digest,
        detail(db, tenant, row.id),
        action=f"table-reservation.{body.action}",
        row=row,
    )
