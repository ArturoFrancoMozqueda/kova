"""Public reservations: signed scopes, no identity inference, shared transaction locks."""

import hashlib
import hmac
from datetime import UTC, datetime, time, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import jwt
from sqlalchemy import or_, text

from app.appointments import service as agenda
from app.appointments.models import Appointment, AppointmentReminder, AppointmentResource
from app.audit import service as audit
from app.auth.models import Membership, User
from app.billing.access import get_billing_access_status
from app.bookings.models import (
    BookingAvailability,
    BookingHistory,
    BookingPage,
    BookingService,
    BookingServiceResource,
    PublicBooking,
    TableReservation,
)
from app.branches.models import Branch
from app.branches.scope import active_branch_id, bind_branch
from app.business_settings.models import BusinessProfile
from app.config import settings
from app.db import set_tenant_context
from app.idempotency import service as idempotency
from app.loyalty.cards import _customer_revision
from app.shared.exceptions import bad_request, conflict, not_found
from app.tenants.models import Tenant

UNAVAILABLE = "Esta reserva no está disponible. Consulta al negocio."


def _scope(db, tenant, model):
    return db.query(model).filter_by(tenant_id=tenant, branch_id=active_branch_id(db, tenant))


def _page(db, tenant):
    return _scope(db, tenant, BookingPage).first()


def _config_lock(db, tenant):
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
        {"key": f"booking-config:{tenant}:{active_branch_id(db, tenant)}"},
    )


def _authorized(db, row):
    return (
        db.query(Membership)
        .join(User, User.id == Membership.user_id)
        .filter(
            Membership.tenant_id == row.tenant_id,
            Membership.user_id == row.authorized_by_user_id,
            Membership.is_active.is_(True),
            Membership.role.in_(["owner", "manager"]),
            User.is_active.is_(True),
            or_(
                Membership.allowed_branch_id.is_(None),
                Membership.allowed_branch_id == row.branch_id,
            ),
        )
        .first()
        is not None
    )


def _encode(audience, page, **claims):
    return jwt.encode(
        {
            "aud": audience,
            "tenant": str(page.tenant_id),
            "branch": str(page.branch_id),
            "page": str(page.id),
            **claims,
        },
        settings.secret_key,
        algorithm="HS256",
    )


def page_token(page):
    # A public address, not a customer credential. Publication/version authorizes its projection.
    return _encode("kova-booking-page", page, version=page.link_version)


def _decode(token, audience, *, exp=True):
    try:
        if len(token) > 2500:
            raise ValueError
        required = ["aud", "tenant", "branch", "page"] + (["exp"] if exp else ["version"])
        claims = jwt.decode(
            token,
            settings.secret_key,
            algorithms=["HS256"],
            audience=audience,
            options={"require": required},
        )
        if claims["aud"] != audience:
            raise ValueError
        for key in ("tenant", "branch", "page"):
            claims[key] = UUID(claims[key])
        return claims
    except (jwt.InvalidTokenError, ValueError, TypeError, KeyError):
        raise not_found(UNAVAILABLE) from None


def _resolve(db, claims, *, published=False):
    tenant = claims["tenant"]
    set_tenant_context(db, tenant)
    bind_branch(db, tenant_id=tenant, branch_id=claims["branch"])
    page = _scope(db, tenant, BookingPage).filter_by(id=claims["page"]).populate_existing().first()
    if (
        not page
        or not _authorized(db, page)
        or not db.query(Tenant.id).filter_by(id=tenant, is_active=True).first()
        or not get_billing_access_status(db, tenant_id=tenant).allowed
        or (published and (not page.enabled or claims.get("version") != page.link_version))
    ):
        raise not_found(UNAVAILABLE)
    return page


def resolve_page(db, token):
    return _resolve(db, _decode(token, "kova-booking-page", exp=False), published=True)


def describe_page(page):
    return {
        "mode": page.mode if page else "appointments",
        "enabled": page.enabled if page else False,
        "version": page.version if page else 0,
        "horizon_days": page.horizon_days if page else 30,
        "notice_minutes": page.notice_minutes if page else 120,
        "slot_minutes": page.slot_minutes if page else 15,
        "manage_cutoff_hours": page.manage_cutoff_hours if page else 24,
        "share_path": f"/reservar/{page_token(page)}" if page and page.enabled else None,
    }


def _claim(db, tenant, key, scope, body):
    return agenda._claim(db, tenant, key, f"booking.{scope}", body)


def _finish(db, tenant, actor, key, digest, result, *, action, row):
    audit.log(
        db,
        tenant_id=tenant,
        user_id=actor,
        action=action,
        resource_type=row.__tablename__,
        resource_id=row.id,
        changes={"version": row.version},
    )
    idempotency.store(
        db,
        tenant_id=tenant,
        key=key,
        request_hash=digest,
        response_status=200,
        response_body=result,
    )
    db.commit()
    return result


def save_page(db, tenant, actor, body, key):
    _config_lock(db, tenant)
    digest, replay = _claim(db, tenant, key, "page", body)
    if replay:
        return replay.response_body
    row = _page(db, tenant)
    if body.expected_version != (row.version if row else 0):
        raise conflict("La configuración cambió. Vuelve a consultarla.")
    mode = body.mode or (row.mode if row else "appointments")
    if body.enabled:
        configured = {
            a.resource_id
            for a in _scope(db, tenant, BookingAvailability).all()
            if any(day.get("windows") for day in [*a.weekly, *a.exceptions])
        }
        active_resources = {
            r.id
            for r in _scope(db, tenant, AppointmentResource)
            .filter_by(is_active=True, kind="table" if mode == "tables" else "appointment")
            .all()
        }
        available_resources = configured & active_resources
        if mode == "tables":
            table_zones = {
                r.timezone
                for r in _scope(db, tenant, AppointmentResource)
                .filter_by(is_active=True, kind="table")
                .all()
            }
            if len(table_zones) > 1:
                raise bad_request("Las mesas de esta sucursal deben usar la misma zona horaria.")
        active_services = {
            s.id for s in _scope(db, tenant, BookingService).filter_by(is_active=True).all()
        }
        if mode == "tables" and not available_resources:
            raise bad_request("Agrega una mesa activa y sus horarios antes de recibir solicitudes.")
        if mode == "appointments" and (
            not _scope(db, tenant, BookingServiceResource)
            .filter(
                BookingServiceResource.service_id.in_(active_services),
                BookingServiceResource.resource_id.in_(available_resources),
            )
            .first()
        ):
            raise bad_request(
                "Define un servicio con una persona o espacio activo y horarios antes de publicar."
            )
    if row is None:
        row = BookingPage(
            tenant_id=tenant, branch_id=active_branch_id(db, tenant), version=0, link_version=1
        )
        db.add(row)
    for name in (
        "enabled",
        "horizon_days",
        "notice_minutes",
        "slot_minutes",
        "manage_cutoff_hours",
    ):
        setattr(row, name, getattr(body, name))
    row.authorized_by_user_id = actor
    row.mode = mode
    row.version += 1
    if body.rotate_link:
        row.link_version += 1
    db.flush()
    return _finish(
        db, tenant, actor, key, digest, describe_page(row), action="booking.page.saved", row=row
    )


def services(db, tenant, *, public=False):
    rows = (
        _scope(db, tenant, BookingService)
        .order_by(BookingService.name, BookingService.id)
        .limit(200)
        .all()
    )
    assignments = _scope(db, tenant, BookingServiceResource).all()
    return [
        {
            "id": str(row.id),
            "name": row.name,
            "description": row.description,
            "duration_minutes": row.duration_minutes,
            "is_active": row.is_active,
            "version": row.version,
            "resource_ids": [str(a.resource_id) for a in assignments if a.service_id == row.id],
        }
        for row in rows
        if not public or row.is_active
    ]


def save_service(db, tenant, actor, body, key, service_id=None):
    _config_lock(db, tenant)
    digest, replay = _claim(db, tenant, key, f"service:{service_id}", body)
    if replay:
        return replay.response_body
    row = (
        _scope(db, tenant, BookingService).filter_by(id=service_id).first() if service_id else None
    )
    if service_id and not row:
        raise not_found(UNAVAILABLE)
    if body.expected_version != (row.version if row else 0):
        raise conflict("El servicio cambió. Consulta su configuración.")
    for resource_id in sorted(body.resource_ids):
        agenda._lock(db, tenant, resource_id)
        if agenda._resource(db, tenant, resource_id, lock=True).kind == "table":
            raise bad_request(
                "Las mesas reciben solicitudes sin duración fija; "
                "no se asignan a servicios con cita."
            )
    if row is None:
        if _scope(db, tenant, BookingService).count() >= 200:
            raise bad_request("Puedes configurar hasta 200 servicios por sucursal.")
        row = BookingService(tenant_id=tenant, branch_id=active_branch_id(db, tenant), version=0)
        db.add(row)
    for name in ("name", "description", "duration_minutes", "is_active"):
        setattr(row, name, getattr(body, name))
    row.version += 1
    db.flush()
    _scope(db, tenant, BookingServiceResource).filter_by(service_id=row.id).delete(
        synchronize_session=False
    )
    for resource_id in body.resource_ids:
        db.add(
            BookingServiceResource(
                tenant_id=tenant,
                branch_id=row.branch_id,
                service_id=row.id,
                resource_id=resource_id,
            )
        )
    db.flush()
    result = next(s for s in services(db, tenant) if s["id"] == str(row.id))
    return _finish(db, tenant, actor, key, digest, result, action="booking.service.saved", row=row)


def availability(db, tenant, resource_id):
    agenda._resource(db, tenant, resource_id)
    row = _scope(db, tenant, BookingAvailability).filter_by(resource_id=resource_id).first()
    return {
        "resource_id": str(resource_id),
        "weekly": row.weekly if row else [],
        "exceptions": row.exceptions if row else [],
        "version": row.version if row else 0,
    }


def save_availability(db, tenant, actor, resource_id, body, key):
    _config_lock(db, tenant)
    agenda._lock(db, tenant, resource_id)
    agenda._resource(db, tenant, resource_id, lock=True)
    digest, replay = _claim(db, tenant, key, f"availability:{resource_id}", body)
    if replay:
        return replay.response_body
    row = _scope(db, tenant, BookingAvailability).filter_by(resource_id=resource_id).first()
    if body.expected_version != (row.version if row else 0):
        raise conflict("Los horarios cambiaron. Vuelve a consultarlos.")
    if row is None:
        row = BookingAvailability(
            tenant_id=tenant,
            branch_id=active_branch_id(db, tenant),
            resource_id=resource_id,
            version=0,
        )
        db.add(row)
    row.weekly = [d.model_dump(mode="json") for d in body.weekly]
    row.exceptions = [d.model_dump(mode="json") for d in body.exceptions]
    row.version += 1
    db.flush()
    return _finish(
        db,
        tenant,
        actor,
        key,
        digest,
        availability(db, tenant, resource_id),
        action="booking.availability.saved",
        row=row,
    )


def context(db, token):
    return _context(db, resolve_page(db, token))


def _context(db, page):
    """Public context for a page; the owner preview passes an unsaved draft."""
    profile = db.query(BusinessProfile).filter_by(tenant_id=page.tenant_id).first()
    tenant = db.query(Tenant).filter_by(id=page.tenant_id).one()
    branch = db.query(Branch).filter_by(tenant_id=page.tenant_id, id=page.branch_id).one()
    resources = agenda.resources(db, page.tenant_id)["items"]
    return {
        "mode": page.mode,
        "timezone": next(
            (r["timezone"] for r in resources if r["kind"] == "table" and r["is_active"]), None
        )
        if page.mode == "tables"
        else None,
        "business_name": profile.public_name if profile else tenant.name,
        "branch_name": branch.name,
        "services": [
            {k: v for k, v in s.items() if k not in {"version", "is_active"}}
            for s in (
                services(db, page.tenant_id, public=True) if page.mode == "appointments" else []
            )
        ],
        "resources": [
            {k: r[k] for k in ("id", "name", "timezone")}
            for r in resources
            if r["is_active"] and r["kind"] == "appointment" and page.mode == "appointments"
        ],
        "horizon_days": page.horizon_days,
        "manage_cutoff_hours": page.manage_cutoff_hours,
    }


def _selection(db, page, service_id, resource_id):
    service = (
        _scope(db, page.tenant_id, BookingService).filter_by(id=service_id, is_active=True).first()
    )
    assignment = (
        _scope(db, page.tenant_id, BookingServiceResource)
        .filter_by(service_id=service_id, resource_id=resource_id)
        .first()
    )
    resource = agenda._resource(db, page.tenant_id, resource_id)
    if not service or not assignment or not resource.is_active or resource.kind != "appointment":
        raise not_found("El servicio o la persona ya no están disponibles.")
    return service, resource


def _instants(day, clock, zone):
    local = datetime.combine(day, time.fromisoformat(clock))
    # Offer both actual offsets on an ambiguous clock, and none on a nonexistent clock.
    result = set()
    for fold in (0, 1):
        utc = local.replace(tzinfo=zone, fold=fold).astimezone(UTC)
        if utc.astimezone(zone).replace(tzinfo=None) == local:
            result.add(utc)
    return sorted(result)


def busy_intervals(
    db, tenant, resource_id, start, end, *, excluding_booking=None, excluding_appointment=None
):
    internal = _scope(db, tenant, Appointment).filter(
        Appointment.resource_id == resource_id,
        Appointment.status == "scheduled",
        Appointment.starts_at < end,
        Appointment.ends_at > start,
    )
    if excluding_appointment:
        internal = internal.filter(Appointment.id != excluding_appointment)
    public = _scope(db, tenant, PublicBooking).filter(
        PublicBooking.resource_id == resource_id,
        PublicBooking.status == "scheduled",
        PublicBooking.appointment_id.is_(None),
        PublicBooking.starts_at < end,
        PublicBooking.ends_at > start,
    )
    if excluding_booking:
        public = public.filter(PublicBooking.id != excluding_booking)
    return [(row.starts_at, row.ends_at) for row in [*internal.all(), *public.all()]]


def slots(db, page, service_id, resource_id, day, *, excluding=None, availability=None):
    service, resource = _selection(db, page, service_id, resource_id)
    zone = ZoneInfo(resource.timezone)
    stamp = datetime.now(UTC)
    today = stamp.astimezone(zone).date()
    if not today <= day <= today + timedelta(days=page.horizon_days):
        return []
    if availability is None:
        configured = (
            _scope(db, page.tenant_id, BookingAvailability)
            .filter_by(resource_id=resource_id)
            .first()
        )
        if not configured:
            return []
        availability = {"weekly": configured.weekly, "exceptions": configured.exceptions}
    windows = next(
        (d["windows"] for d in availability["exceptions"] if d["date"] == str(day)), None
    )
    if windows is None:
        windows = next(
            (d["windows"] for d in availability["weekly"] if d["weekday"] == day.weekday()), []
        )
    start = datetime.combine(day, time.min, zone).astimezone(UTC)
    end = datetime.combine(day + timedelta(days=1), time.min, zone).astimezone(UTC)
    occupied = busy_intervals(
        db,
        page.tenant_id,
        resource_id,
        start,
        end,
        excluding_booking=excluding.id if excluding else None,
        excluding_appointment=excluding.appointment_id if excluding else None,
    )
    result = []
    duration = (
        excluding.ends_at - excluding.starts_at
        if excluding
        else timedelta(minutes=service.duration_minutes)
    )
    for window in windows:
        local = datetime.combine(day, time.fromisoformat(window["start"]))
        local_end = datetime.combine(day, time.fromisoformat(window["end"]))
        while local < local_end:
            for candidate in _instants(day, local.strftime("%H:%M"), zone):
                finish = candidate + duration
                finish_local = finish.astimezone(zone).replace(tzinfo=None)
                if (
                    candidate >= stamp + timedelta(minutes=page.notice_minutes)
                    and finish_local <= local_end
                    and not any(a < finish and b > candidate for a, b in occupied)
                ):
                    result.append(
                        {
                            "starts_at": candidate.isoformat(),
                            "ends_at": finish.isoformat(),
                            "timezone": resource.timezone,
                        }
                    )
            local += timedelta(minutes=page.slot_minutes)
    return sorted(result, key=lambda item: item["starts_at"])


PREVIEW_SCAN_DAYS = 31


def preview(db, tenant, body):
    """Render unsaved settings with the public page's own rules. Read-only:
    nothing is stored, and real appointments still block their slots."""
    saved = _page(db, tenant)
    draft = body.page
    page = SimpleNamespace(
        tenant_id=tenant,
        branch_id=active_branch_id(db, tenant),
        mode=draft.mode if draft else (saved.mode if saved else "appointments"),
        horizon_days=draft.horizon_days if draft else (saved.horizon_days if saved else 30),
        notice_minutes=draft.notice_minutes if draft else (saved.notice_minutes if saved else 120),
        slot_minutes=draft.slot_minutes if draft else (saved.slot_minutes if saved else 15),
        manage_cutoff_hours=(
            draft.manage_cutoff_hours if draft else (saved.manage_cutoff_hours if saved else 24)
        ),
    )
    public = _context(db, page)
    empty = {"context": public, "selection": None, "slots": []}
    if page.mode != "appointments" or not public["services"]:
        return empty
    resource_ids = {r["id"] for r in public["resources"]}
    override = body.availability.model_dump(mode="json") if body.availability else None
    preferred = override["resource_id"] if override else None
    eligible = [
        s for s in public["services"] if any(r in resource_ids for r in s["resource_ids"])
    ]
    chosen = next((s for s in eligible if str(body.service_id) == s["id"]), None) or next(
        (s for s in eligible if preferred in s["resource_ids"]), None
    ) or (eligible[0] if eligible else None)
    if not chosen:
        return empty
    candidates = [r for r in chosen["resource_ids"] if r in resource_ids]
    resource_id = next(
        (r for r in candidates if r in {str(body.resource_id), preferred}), candidates[0]
    )
    resource = next(r for r in public["resources"] if r["id"] == resource_id)
    today = datetime.now(UTC).astimezone(ZoneInfo(resource["timezone"])).date()
    last = today + timedelta(days=page.horizon_days)
    draft_windows = override if override and override["resource_id"] == resource_id else None

    def offered(day):
        return slots(db, page, chosen["id"], resource_id, day, availability=draft_windows)

    if body.day and today <= body.day <= last:
        day, items = body.day, offered(body.day)
    else:
        day, items = today, []
        for offset in range(min(page.horizon_days, PREVIEW_SCAN_DAYS) + 1):
            candidate = today + timedelta(days=offset)
            items = offered(candidate)
            if items:
                day = candidate
                break
    return {
        "context": public,
        "selection": {"service_id": chosen["id"], "resource_id": resource_id, "day": day},
        "slots": items,
    }


def _identity(db, page, token):
    if not token:
        return None
    claims = _decode(token, "kova-booking-customer")
    if (
        claims["tenant"] != page.tenant_id
        or claims["branch"] != page.branch_id
        or claims["page"] != page.id
        or claims.get("version") != page.link_version
    ):
        raise not_found(UNAVAILABLE)
    try:
        customer_id = UUID(claims["customer"])
    except (ValueError, TypeError, KeyError):
        raise not_found(UNAVAILABLE) from None
    customer = agenda._customer(db, page.tenant_id, customer_id)
    if not customer.is_active or claims.get("revision") != _customer_revision(customer):
        raise not_found(UNAVAILABLE)
    return customer.id


def invite(db, tenant, customer_id):
    page = _page(db, tenant)
    if not page or not page.enabled or not _authorized(db, page):
        raise bad_request("Publica las reservas en línea antes de compartir un enlace personal.")
    customer = agenda._customer(db, tenant, customer_id)
    if not customer.is_active:
        raise not_found(UNAVAILABLE)
    token = _encode(
        "kova-booking-customer",
        page,
        version=page.link_version,
        customer=str(customer.id),
        revision=_customer_revision(customer),
        exp=datetime.now(UTC) + timedelta(days=30),
    )
    return {"share_path": f"/reservar/{page_token(page)}#identity={token}"}


def member_booking_path(db, catalog):
    page = _page(db, catalog.tenant_id)
    if not page or not page.enabled or not _authorized(db, page):
        return None
    from app.storefront.router import _settings

    path = _settings(db, catalog).share_path
    menu = path.rsplit("/", 1)[-1] if path and catalog.enabled else None
    return f"/reservar/{page_token(page)}?menu={menu}" if menu else None


def member_grant(db, request, body):
    from app.loyalty import enrollment

    page = resolve_page(db, body.page_token)
    catalog = enrollment.resolve_program(db, body.menu_token)
    if catalog.tenant_id != page.tenant_id or catalog.branch_id != page.branch_id:
        raise not_found(UNAVAILABLE)
    token, payload = enrollment._read_cookie(request, catalog)
    if not token or not payload or payload.get("stage") != "member":
        return {"identity_token": None}
    member = (
        enrollment._members(db, catalog)
        .filter_by(credential_hash=enrollment._cookie_hash(catalog, token))
        .first()
    )
    customer = enrollment._valid_member(db, catalog, member)
    return {
        "identity_token": _encode(
            "kova-booking-customer",
            page,
            version=page.link_version,
            customer=str(customer.id),
            revision=_customer_revision(customer),
            exp=datetime.now(UTC) + timedelta(minutes=15),
        )
    }


def _history(db, row, action, actor=None):
    db.add(
        BookingHistory(
            tenant_id=row.tenant_id,
            branch_id=row.branch_id,
            booking_id=row.id,
            version=row.version,
            action=action,
            actor_user_id=actor,
            starts_at=row.starts_at,
            ends_at=row.ends_at,
            status=row.status,
        )
    )
    audit.log(
        db,
        tenant_id=row.tenant_id,
        user_id=actor,
        action=f"booking.{action}",
        resource_type="public_bookings",
        resource_id=row.id,
        changes={"version": row.version, "status": row.status},
    )


def _manage_token(page, row):
    return _encode(
        "kova-booking-manage",
        page,
        booking=str(row.id),
        version=row.manage_version,
        exp=row.created_at + timedelta(days=400),
    )


def receipt(db, page, row, *, with_link=False):
    appointment = (
        _scope(db, row.tenant_id, Appointment).filter_by(id=row.appointment_id).first()
        if row.appointment_id
        else None
    )
    start, end = (
        (appointment.starts_at, appointment.ends_at)
        if appointment
        else (row.starts_at, row.ends_at)
    )
    status = appointment.status if appointment else row.status
    resource = agenda._resource(db, row.tenant_id, row.resource_id)
    result = {
        "title": row.title,
        "resource_name": resource.name,
        "starts_at": start.isoformat(),
        "ends_at": end.isoformat(),
        "timezone": row.timezone,
        "status": status,
        "version": row.version + (appointment.version if appointment else 0),
        "calendar_uid": hmac.new(
            settings.secret_key.encode(), f"booking-calendar:{row.id}".encode(), hashlib.sha256
        ).hexdigest()[:32]
        + "@kovasuite.com",
        "can_manage": status == "scheduled"
        and start > datetime.now(UTC) + timedelta(hours=page.manage_cutoff_hours),
    }
    if with_link:
        result["manage_path"] = f"/reservar/gestionar#{_manage_token(page, row)}"
    return result


def create(db, body, key):
    if not key:
        raise bad_request("Vuelve a intentar la reserva desde el formulario.")
    try:
        UUID(key)
    except ValueError:
        raise bad_request("La referencia de reserva no es válida.") from None
    page = resolve_page(db, body.page_token)
    _config_lock(db, page.tenant_id)
    page = resolve_page(db, body.page_token)
    db.refresh(page)
    if not page.enabled:
        raise not_found(UNAVAILABLE)
    # Configuration and every resource mutation use the same lock order.
    agenda._lock(db, page.tenant_id, body.resource_id)
    agenda._resource(db, page.tenant_id, body.resource_id, lock=True)
    op_hash = hmac.new(
        settings.secret_key.encode(), f"booking:{page.id}:{key}".encode(), hashlib.sha256
    ).hexdigest()
    request_hash = hashlib.sha256(body.model_dump_json().encode()).hexdigest()
    existing = _scope(db, page.tenant_id, PublicBooking).filter_by(operation_hash=op_hash).first()
    if existing:
        if not hmac.compare_digest(existing.request_hash, request_hash):
            raise conflict("Esta reserva ya se envió con otros datos.")
        return receipt(db, page, existing, with_link=True)
    if page.mode != "appointments":
        raise bad_request("Esta página recibe solicitudes de mesa, pendientes de confirmación.")
    customer_id = _identity(db, page, body.identity_token)
    selected_service, resource = _selection(db, page, body.service_id, body.resource_id)
    start = body.starts_at.astimezone(UTC)
    offered = slots(
        db,
        page,
        body.service_id,
        body.resource_id,
        start.astimezone(ZoneInfo(resource.timezone)).date(),
    )
    slot = next((s for s in offered if datetime.fromisoformat(s["starts_at"]) == start), None)
    if not slot:
        raise conflict("Ese horario ya no está disponible. Elige otro; tus datos se conservan.")
    row = PublicBooking(
        id=uuid4(),
        tenant_id=page.tenant_id,
        branch_id=page.branch_id,
        service_id=body.service_id,
        resource_id=body.resource_id,
        customer_id=customer_id,
        guest_name=body.name,
        phone=body.phone,
        title=selected_service.name,
        timezone=resource.timezone,
        starts_at=start,
        ends_at=datetime.fromisoformat(slot["ends_at"]),
        status="scheduled",
        version=1,
        manage_version=1,
        operation_hash=op_hash,
        request_hash=request_hash,
    )
    db.add(row)
    db.flush()
    _history(db, row, "created")
    result = receipt(db, page, row, with_link=True)
    db.commit()
    return result


def resolve_manage(db, token):
    claims = _decode(token, "kova-booking-manage")
    page = _resolve(db, claims)
    try:
        booking_id = UUID(claims["booking"])
    except (ValueError, KeyError, TypeError):
        raise not_found(UNAVAILABLE) from None
    row = _scope(db, page.tenant_id, PublicBooking).filter_by(id=booking_id).first()
    if not row or claims.get("version") != row.manage_version:
        raise not_found(UNAVAILABLE)
    return page, row


def manage(db, body, key):
    page, observed = resolve_manage(db, body.token)
    _config_lock(db, page.tenant_id)
    agenda._lock(db, page.tenant_id, observed.resource_id)
    row = (
        _scope(db, page.tenant_id, PublicBooking)
        .filter_by(id=observed.id)
        .populate_existing()
        .with_for_update()
        .one()
    )
    digest, replay = _claim(db, page.tenant_id, key, f"manage:{row.id}", body)
    if replay:
        return replay.response_body
    current = receipt(db, page, row)
    if not current["can_manage"]:
        raise conflict("Para cambiar esta cita, contacta al negocio.")
    if current["version"] != body.expected_version:
        raise conflict("La reserva cambió. Consulta su horario actual.")
    appointment = (
        _scope(db, page.tenant_id, Appointment)
        .filter_by(id=row.appointment_id)
        .populate_existing()
        .with_for_update()
        .first()
        if row.appointment_id
        else None
    )
    if body.action == "cancel":
        row.status = "cancelled"
        if appointment:
            appointment.status = "cancelled"
    else:
        if row.customer_id and not agenda._customer(db, page.tenant_id, row.customer_id).is_active:
            raise conflict("Contacta al negocio para revisar esta cita.")
        if not body.starts_at or not page.enabled:
            raise bad_request("Contacta al negocio para consultar un nuevo horario.")
        start = body.starts_at.astimezone(UTC)
        day = start.astimezone(ZoneInfo(row.timezone)).date()
        offered = slots(db, page, row.service_id, row.resource_id, day, excluding=row)
        # Reprogramming retains the booked duration, even if the service changed afterwards.
        duration = row.ends_at - row.starts_at
        candidate = next(
            (
                s
                for s in offered
                if datetime.fromisoformat(s["starts_at"]) == start
                and datetime.fromisoformat(s["ends_at"]) - start == duration
            ),
            None,
        )
        if not candidate:
            raise conflict("Ese horario ya no está disponible. Consulta otra opción.")
        row.starts_at, row.ends_at = start, datetime.fromisoformat(candidate["ends_at"])
        if appointment:
            appointment.starts_at, appointment.ends_at = row.starts_at, row.ends_at
    if appointment:
        appointment.version += 1
        appointment.updated_at = datetime.now(UTC)
        # Public actions have their own actor history. Do not impersonate a member.
        for reminder in (
            _scope(db, page.tenant_id, AppointmentReminder)
            .filter_by(appointment_id=appointment.id, status="pending")
            .all()
        ):
            reminder.status = "suppressed"
            reminder.version += 1
            reminder.resolved_at = datetime.now(UTC)
        if appointment.status == "scheduled":
            db.add(
                AppointmentReminder(
                    tenant_id=page.tenant_id,
                    branch_id=page.branch_id,
                    appointment_id=appointment.id,
                    appointment_version=appointment.version,
                    due_at=max(appointment.starts_at - timedelta(hours=24), datetime.now(UTC)),
                )
            )
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


def calendar(db, tenant, start, end, resource_id=None):
    agenda.list_appointments(db, tenant, starts_from=start, starts_until=end, limit=1)
    if resource_id:
        agenda._resource(db, tenant, resource_id)
    internal = (
        _scope(db, tenant, Appointment)
        .filter(
            Appointment.starts_at < end,
            Appointment.ends_at > start,
            *([Appointment.resource_id == resource_id] if resource_id else []),
        )
        .order_by(Appointment.starts_at, Appointment.id)
        .limit(1001)
        .all()
    )
    public = (
        _scope(db, tenant, PublicBooking)
        .filter(
            PublicBooking.appointment_id.is_(None),
            PublicBooking.starts_at < end,
            PublicBooking.ends_at > start,
            *([PublicBooking.resource_id == resource_id] if resource_id else []),
        )
        .order_by(PublicBooking.starts_at, PublicBooking.id)
        .limit(1001)
        .all()
    )
    table_rows = (
        _scope(db, tenant, TableReservation)
        .filter(
            TableReservation.starts_at >= start,
            TableReservation.starts_at < end,
            *([TableReservation.resource_id == resource_id] if resource_id else []),
        )
        .order_by(TableReservation.starts_at, TableReservation.id)
        .limit(1001)
        .all()
    )
    resources = {r.id: r for r in _scope(db, tenant, AppointmentResource).all()}
    from app.customers.models import Customer

    customers = {
        c.id: c.name
        for c in db.query(Customer)
        .filter(
            Customer.tenant_id == tenant,
            Customer.id.in_(
                {r.customer_id for r in [*internal, *public, *table_rows] if r.customer_id}
            ),
        )
        .all()
    }
    items = [
        {
            "id": str(r.id),
            "source": "appointment" if isinstance(r, Appointment) else "booking",
            "title": r.title,
            "resource_id": str(r.resource_id),
            "resource_name": resources[r.resource_id].name,
            "timezone": resources[r.resource_id].timezone,
            "starts_at": r.starts_at.isoformat(),
            "ends_at": r.ends_at.isoformat(),
            "status": r.status,
            "customer_id": str(r.customer_id) if r.customer_id else None,
            "customer_name": customers.get(
                r.customer_id, r.guest_name if isinstance(r, PublicBooking) else "Cliente"
            ),
            "version": r.version,
        }
        for r in [*internal, *public]
    ]
    items.extend(
        {
            "id": str(r.id),
            "source": "table",
            "title": "Reserva de mesa",
            "resource_id": str(r.resource_id) if r.resource_id else None,
            "resource_name": resources[r.resource_id].name if r.resource_id else "Mesa por asignar",
            "timezone": r.timezone,
            "starts_at": r.starts_at.isoformat(),
            "ends_at": None,
            "status": r.status,
            "customer_id": str(r.customer_id) if r.customer_id else None,
            "customer_name": customers.get(r.customer_id, r.guest_name),
            "version": r.version,
        }
        for r in table_rows
    )
    return {
        "items": sorted(items, key=lambda r: (r["starts_at"], r["id"])),
        "has_more": len(internal) > 1000 or len(public) > 1000 or len(table_rows) > 1000,
    }


def get_booking(db, tenant, booking_id):
    row = _scope(db, tenant, PublicBooking).filter_by(id=booking_id).first()
    if not row:
        raise not_found(UNAVAILABLE)
    appointment = (
        _scope(db, tenant, Appointment).filter_by(id=row.appointment_id).first()
        if row.appointment_id
        else None
    )
    return {
        "id": str(row.id),
        "customer_id": str(row.customer_id) if row.customer_id else None,
        "guest_name": row.guest_name,
        "phone": row.phone,
        "title": row.title,
        "version": row.version,
        "status": appointment.status if appointment else row.status,
        "starts_at": (appointment.starts_at if appointment else row.starts_at).isoformat(),
        "ends_at": (appointment.ends_at if appointment else row.ends_at).isoformat(),
        "timezone": row.timezone,
        "appointment_id": str(row.appointment_id) if row.appointment_id else None,
        "history": [
            {"action": h.action, "created_at": h.created_at.isoformat()}
            for h in _scope(db, tenant, BookingHistory)
            .filter_by(booking_id=row.id)
            .order_by(BookingHistory.version)
            .all()
        ],
    }


def materialize(db, tenant, actor, booking_id, body, key):
    row = _scope(db, tenant, PublicBooking).filter_by(id=booking_id).first()
    if not row:
        raise not_found(UNAVAILABLE)
    agenda._lock(db, tenant, row.resource_id)
    row = (
        _scope(db, tenant, PublicBooking)
        .filter_by(id=booking_id)
        .populate_existing()
        .with_for_update()
        .one()
    )
    digest, replay = _claim(db, tenant, key, f"link:{row.id}", body)
    if replay:
        return replay.response_body
    if row.version != body.expected_version or row.status != "scheduled":
        raise conflict("La reserva cambió. Consulta la información actual.")
    if row.customer_id and row.customer_id != body.customer_id:
        raise conflict("Esta reserva ya tiene un cliente identificado.")
    customer = agenda._customer(db, tenant, body.customer_id)
    if not customer.is_active:
        raise bad_request("Selecciona un cliente activo.")
    if row.appointment_id:
        return {"appointment_id": str(row.appointment_id)}
    resource = agenda._resource(db, tenant, row.resource_id, lock=True)
    if not resource.is_active:
        raise conflict("La persona o espacio está desactivado.")
    if busy_intervals(
        db, tenant, row.resource_id, row.starts_at, row.ends_at, excluding_booking=row.id
    ):
        raise conflict("Hay otra cita que se cruza con esta reserva.")
    appointment = Appointment(
        tenant_id=tenant,
        branch_id=row.branch_id,
        resource_id=row.resource_id,
        customer_id=customer.id,
        title=row.title,
        starts_at=row.starts_at,
        ends_at=row.ends_at,
        created_by_user_id=actor,
    )
    db.add(appointment)
    db.flush()
    agenda._record_change(db, appointment, actor, "created")
    row.customer_id, row.appointment_id = customer.id, appointment.id
    row.version += 1
    _history(db, row, "linked", actor)
    return _finish(
        db,
        tenant,
        actor,
        key,
        digest,
        {"appointment_id": str(appointment.id)},
        action="booking.linked",
        row=row,
    )


def staff_action(db, tenant, actor, booking_id, body, key, *, revoke=False):
    row = _scope(db, tenant, PublicBooking).filter_by(id=booking_id).first()
    if not row:
        raise not_found(UNAVAILABLE)
    agenda._lock(db, tenant, row.resource_id)
    row = (
        _scope(db, tenant, PublicBooking)
        .filter_by(id=booking_id)
        .populate_existing()
        .with_for_update()
        .one()
    )
    digest, replay = _claim(db, tenant, key, f"staff:{booking_id}:{revoke}", body)
    if replay:
        return replay.response_body
    if row.version != body.expected_version:
        raise conflict("La reserva cambió. Consulta su estado actual.")
    if revoke:
        row.manage_version += 1
    else:
        if row.appointment_id:
            raise conflict("Cancela esta cita desde su detalle de atención.")
        if row.status != "scheduled":
            raise conflict("Esta reserva ya fue cancelada.")
        row.status = "cancelled"
    row.version += 1
    _history(db, row, "revoked" if revoke else "cancel", actor)
    db.flush()
    return _finish(
        db,
        tenant,
        actor,
        key,
        digest,
        get_booking(db, tenant, booking_id),
        action="booking.updated",
        row=row,
    )


def staff_reschedule(db, tenant, actor, booking_id, body, key):
    row = _scope(db, tenant, PublicBooking).filter_by(id=booking_id).first()
    if not row:
        raise not_found(UNAVAILABLE)
    agenda._lock(db, tenant, row.resource_id)
    row = (
        _scope(db, tenant, PublicBooking)
        .filter_by(id=booking_id)
        .populate_existing()
        .with_for_update()
        .one()
    )
    digest, replay = _claim(db, tenant, key, f"staff-reschedule:{row.id}", body)
    if replay:
        return replay.response_body
    if row.version != body.expected_version or row.status != "scheduled" or row.appointment_id:
        raise conflict("Consulta el detalle actual de esta cita antes de reprogramarla.")
    resource = agenda._resource(db, tenant, row.resource_id, lock=True)
    if not resource.is_active:
        raise conflict("La persona o espacio está desactivado.")
    if row.customer_id and not agenda._customer(db, tenant, row.customer_id).is_active:
        raise conflict("El cliente de esta reserva está inactivo.")
    start = body.starts_at.astimezone(UTC)
    end = start + (row.ends_at - row.starts_at)
    agenda._validate_interval(start, end)
    if busy_intervals(db, tenant, row.resource_id, start, end, excluding_booking=row.id):
        raise conflict("Hay otra cita que se cruza con ese horario.")
    row.starts_at, row.ends_at = start, end
    row.version += 1
    _history(db, row, "reschedule", actor)
    db.flush()
    return _finish(
        db,
        tenant,
        actor,
        key,
        digest,
        get_booking(db, tenant, booking_id),
        action="booking.rescheduled",
        row=row,
    )
