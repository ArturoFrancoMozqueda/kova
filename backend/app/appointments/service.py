"""Internal resource scheduling. All timestamps are absolute; no provider or payment effects."""

import hashlib
from datetime import UTC, timedelta

from sqlalchemy import func, text

from app.appointments.models import (
    Appointment,
    AppointmentHistory,
    AppointmentReminder,
    AppointmentResource,
    AppointmentSale,
    now,
)
from app.appointments.schemas import (
    AppointmentHistoryResponse,
    AppointmentReminderResponse,
    AppointmentResourceResponse,
    AppointmentResponse,
    AppointmentSaleResponse,
)
from app.audit import service as audit
from app.branches.scope import active_branch_id
from app.crm.service import _customer
from app.customers.models import Customer
from app.idempotency import service as idempotency
from app.orders.models import Order, Refund
from app.shared.exceptions import bad_request, conflict, not_found


def _scope(db, tenant, model):
    return db.query(model).filter(
        model.tenant_id == tenant, model.branch_id == active_branch_id(db, tenant)
    )


def _lock(db, tenant, resource_id):
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:scope,0))"),
        {"scope": f"appointments:{tenant}:{active_branch_id(db, tenant)}:{resource_id}"},
    )


def _resource(db, tenant, resource_id, *, lock=False):
    query = _scope(db, tenant, AppointmentResource).filter_by(id=resource_id)
    row = query.populate_existing().with_for_update().first() if lock else query.first()
    if row is None:
        raise not_found("Recurso no encontrado")
    return row


def _appointment(db, tenant, appointment_id, *, lock=False):
    query = _scope(db, tenant, Appointment).filter_by(id=appointment_id)
    row = query.populate_existing().with_for_update().first() if lock else query.first()
    if row is None:
        raise not_found("Cita no encontrada")
    return row


def _utc(value):
    return value.astimezone(UTC)


def _resource_response(row):
    return AppointmentResourceResponse(
        **{name: getattr(row, name) for name in AppointmentResourceResponse.model_fields}
    ).model_dump(mode="json")


def _appointment_response(db, row, resource=None, customer=None, sales=None):
    resource = resource or _resource(db, row.tenant_id, row.resource_id)
    customer = customer or _customer(db, row.tenant_id, row.customer_id)
    fields = {
        name: getattr(row, name)
        for name in AppointmentResponse.model_fields
        if name not in {"resource_name", "timezone", "customer_name", "sale"}
    }
    for name in ("starts_at", "ends_at", "created_at", "updated_at"):
        fields[name] = _utc(fields[name])
    return AppointmentResponse(
        **fields,
        resource_name=resource.name,
        timezone=resource.timezone,
        customer_name=customer.name,
        sale=(sales if sales is not None else _linked_sales(db, row.tenant_id, [row.id])).get(
            row.id
        ),
    ).model_dump(mode="json")


def _reminder_response(db, row, appointment=None, resource=None):
    appointment = appointment or _appointment(db, row.tenant_id, row.appointment_id)
    resource = resource or _resource(db, row.tenant_id, appointment.resource_id)
    return AppointmentReminderResponse(
        id=row.id,
        appointment_id=row.appointment_id,
        appointment_version=row.appointment_version,
        title=appointment.title,
        starts_at=_utc(appointment.starts_at),
        timezone=resource.timezone,
        status=row.status,
        due_at=_utc(row.due_at),
        version=row.version,
    ).model_dump(mode="json")


def _claim(db, tenant, key, scope, body):
    if not key or not key.strip() or len(key) > 255:
        raise bad_request("Idempotency-Key debe contener entre 1 y 255 caracteres")
    fingerprint = hashlib.sha256(
        f"appointments:{scope}:{body.model_dump_json()}".encode()
    ).hexdigest()
    replay = idempotency.claim(db, tenant_id=tenant, key=key, request_hash=fingerprint)
    return fingerprint, replay


def _finish(db, tenant, actor, key, fingerprint, row, result, status, action):
    audit.log(
        db,
        tenant_id=tenant,
        user_id=actor,
        action=action,
        resource_type="appointment" if isinstance(row, Appointment) else row.__tablename__,
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


def resources(db, tenant):
    return {
        "items": [
            _resource_response(row)
            for row in _scope(db, tenant, AppointmentResource)
            .order_by(AppointmentResource.name, AppointmentResource.id)
            .limit(200)
            .all()
        ]
    }


def create_resource(db, tenant, actor, body, key):
    from app.branches.models import Branch

    fingerprint, replay = _claim(db, tenant, key, "resource.create", body)
    if replay:
        return replay.response_status, replay.response_body
    branch = active_branch_id(db, tenant)
    db.query(Branch).filter_by(tenant_id=tenant, id=branch).with_for_update().one()
    if _scope(db, tenant, AppointmentResource).count() >= 200:
        raise conflict("Esta sucursal alcanzó el límite de 200 recursos")
    if _scope(db, tenant, AppointmentResource).filter_by(name=body.name).first():
        raise conflict("Ya existe un recurso con ese nombre")
    row = AppointmentResource(tenant_id=tenant, name=body.name, timezone=body.timezone)
    db.add(row)
    db.flush()
    return _finish(
        db,
        tenant,
        actor,
        key,
        fingerprint,
        row,
        _resource_response(row),
        201,
        "appointment.resource.created",
    )


def update_resource(db, tenant, actor, resource_id, body, key):
    from app.branches.models import Branch

    fingerprint, replay = _claim(db, tenant, key, f"resource.{resource_id}", body)
    if replay:
        return replay.response_status, replay.response_body
    # The branch serializes names with creation; resource lock serializes reservations.
    db.query(Branch).filter_by(
        tenant_id=tenant, id=active_branch_id(db, tenant)
    ).with_for_update().one()
    _lock(db, tenant, resource_id)
    row = _resource(db, tenant, resource_id, lock=True)
    if row.version != body.expected_version:
        raise conflict("El recurso cambió; actualiza antes de continuar")
    if (
        body.name
        and _scope(db, tenant, AppointmentResource)
        .filter(AppointmentResource.name == body.name, AppointmentResource.id != resource_id)
        .first()
    ):
        raise conflict("Ya existe un recurso con ese nombre")
    for field, value in body.model_dump(exclude_unset=True, exclude={"expected_version"}).items():
        setattr(row, field, value)
    row.version += 1
    row.updated_at = now()
    db.flush()
    return _finish(
        db,
        tenant,
        actor,
        key,
        fingerprint,
        row,
        _resource_response(row),
        200,
        "appointment.resource.updated",
    )


def _validate_interval(starts_at, ends_at):
    stamp = now()
    if starts_at <= stamp or starts_at > stamp + timedelta(days=366):
        raise bad_request("Elige un inicio futuro dentro de los próximos 366 días")
    if not starts_at < ends_at <= starts_at + timedelta(hours=24):
        raise bad_request("La cita debe durar más de cero y hasta 24 horas")


def _ensure_free(db, tenant, resource_id, starts_at, ends_at, excluding=None):
    query = _scope(db, tenant, Appointment).filter(
        Appointment.resource_id == resource_id,
        Appointment.status == "scheduled",
        Appointment.starts_at < ends_at,
        Appointment.ends_at > starts_at,
    )
    if excluding is not None:
        query = query.filter(Appointment.id != excluding)
    if query.first():
        raise conflict("El recurso ya tiene una cita que se cruza con ese horario")


def _record_change(db, row, actor, action):
    db.add(
        AppointmentHistory(
            tenant_id=row.tenant_id,
            branch_id=row.branch_id,
            appointment_id=row.id,
            appointment_version=row.version,
            action=action,
            status=row.status,
            starts_at=row.starts_at,
            ends_at=row.ends_at,
            note=row.note,
            actor_user_id=actor,
        )
    )
    for reminder in (
        _scope(db, row.tenant_id, AppointmentReminder)
        .filter_by(appointment_id=row.id, status="pending")
        .all()
    ):
        reminder.status = "suppressed"
        reminder.version += 1
        reminder.resolved_at = now()
    if row.status == "scheduled":
        db.add(
            AppointmentReminder(
                tenant_id=row.tenant_id,
                branch_id=row.branch_id,
                appointment_id=row.id,
                appointment_version=row.version,
                due_at=max(row.starts_at - timedelta(hours=24), now()),
            )
        )
    db.flush()


def create_appointment(db, tenant, actor, body, key):
    fingerprint, replay = _claim(db, tenant, key, "appointment.create", body)
    if replay:
        return replay.response_status, replay.response_body
    _lock(db, tenant, body.resource_id)
    resource = _resource(db, tenant, body.resource_id, lock=True)
    if not resource.is_active:
        raise conflict("El recurso está desactivado")
    customer = _customer(db, tenant, body.customer_id, lock=True)
    if not customer.is_active:
        raise conflict("El cliente está desactivado")
    _validate_interval(body.starts_at, body.ends_at)
    _ensure_free(db, tenant, resource.id, body.starts_at, body.ends_at)
    row = Appointment(tenant_id=tenant, created_by_user_id=actor, **body.model_dump())
    db.add(row)
    db.flush()
    _record_change(db, row, actor, "created")
    return _finish(
        db,
        tenant,
        actor,
        key,
        fingerprint,
        row,
        _appointment_response(db, row),
        201,
        "appointment.created",
    )


def list_appointments(db, tenant, *, starts_from=None, starts_until=None, limit=100, offset=0):
    stamp = now()
    starts_from = starts_from or stamp - timedelta(days=7)
    starts_until = starts_until or stamp + timedelta(days=90)
    for value in (starts_from, starts_until):
        if value.tzinfo is None or value.utcoffset() is None:
            raise bad_request("Incluye el offset del rango de consulta")
    if not starts_from < starts_until <= starts_from + timedelta(days=366):
        raise bad_request("Consulta un rango positivo de hasta 366 días")
    rows = (
        _scope(db, tenant, Appointment)
        .add_entity(AppointmentResource)
        .join(
            AppointmentResource,
            (AppointmentResource.id == Appointment.resource_id)
            & (AppointmentResource.tenant_id == Appointment.tenant_id)
            & (AppointmentResource.branch_id == Appointment.branch_id),
        )
        .add_entity(Customer)
        .join(
            Customer,
            (Customer.id == Appointment.customer_id)
            & (Customer.tenant_id == Appointment.tenant_id),
        )
        .filter(Appointment.starts_at < starts_until, Appointment.ends_at > starts_from)
        .order_by(Appointment.starts_at, Appointment.id)
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    sales = _linked_sales(db, tenant, [row.id for row, _, _ in rows[:limit]])
    return {
        "items": [
            _appointment_response(db, row, resource, customer, sales)
            for row, resource, customer in rows[:limit]
        ],
        "has_more": len(rows) > limit,
    }


def reschedule(db, tenant, actor, appointment_id, body, key):
    fingerprint, replay = _claim(db, tenant, key, f"appointment.reschedule.{appointment_id}", body)
    if replay:
        return replay.response_status, replay.response_body
    observed = _appointment(db, tenant, appointment_id)
    _lock(db, tenant, observed.resource_id)
    resource = _resource(db, tenant, observed.resource_id, lock=True)
    row = _appointment(db, tenant, appointment_id, lock=True)
    if row.version != body.expected_version or row.status != "scheduled":
        raise conflict("La cita cambió o ya terminó; actualiza antes de continuar")
    if not resource.is_active or not _customer(db, tenant, row.customer_id).is_active:
        raise conflict("Reactiva el recurso y el cliente antes de reprogramar")
    _validate_interval(body.starts_at, body.ends_at)
    _ensure_free(db, tenant, resource.id, body.starts_at, body.ends_at, excluding=row.id)
    row.starts_at = body.starts_at
    row.ends_at = body.ends_at
    if "note" in body.model_fields_set:
        row.note = body.note
    row.version += 1
    row.updated_at = now()
    db.flush()
    _record_change(db, row, actor, "rescheduled")
    return _finish(
        db,
        tenant,
        actor,
        key,
        fingerprint,
        row,
        _appointment_response(db, row),
        200,
        "appointment.rescheduled",
    )


def transition(db, tenant, actor, appointment_id, body, key):
    fingerprint, replay = _claim(db, tenant, key, f"appointment.transition.{appointment_id}", body)
    if replay:
        return replay.response_status, replay.response_body
    observed = _appointment(db, tenant, appointment_id)
    _lock(db, tenant, observed.resource_id)
    row = _appointment(db, tenant, appointment_id, lock=True)
    if row.version != body.expected_version or row.status != "scheduled":
        raise conflict("La cita cambió o ya terminó; actualiza antes de continuar")
    if body.status in {"completed", "no_show"} and row.starts_at > now():
        raise conflict("La cita todavía no comienza; no se puede finalizar")
    row.status = body.status
    row.version += 1
    row.updated_at = now()
    db.flush()
    _record_change(db, row, actor, body.status)
    return _finish(
        db,
        tenant,
        actor,
        key,
        fingerprint,
        row,
        _appointment_response(db, row),
        200,
        "appointment.resolved",
    )


def history(db, tenant, appointment_id):
    _appointment(db, tenant, appointment_id)
    rows = (
        _scope(db, tenant, AppointmentHistory)
        .filter_by(appointment_id=appointment_id)
        .order_by(AppointmentHistory.appointment_version)
        .all()
    )
    result = []
    for row in rows:
        fields = {name: getattr(row, name) for name in AppointmentHistoryResponse.model_fields}
        for name in ("starts_at", "ends_at", "created_at"):
            fields[name] = _utc(fields[name])
        result.append(AppointmentHistoryResponse(**fields).model_dump(mode="json"))
    return {"items": result}


def get_reminder(db, tenant, reminder_id):
    row = _scope(db, tenant, AppointmentReminder).filter_by(id=reminder_id).first()
    if row is None or row.status != "pending" or _utc(row.due_at) > now():
        raise not_found("Recordatorio no disponible")
    appointment = _appointment(db, tenant, row.appointment_id)
    if appointment.status != "scheduled" or appointment.version != row.appointment_version:
        raise not_found("Recordatorio no disponible")
    return _reminder_response(db, row, appointment)


def reminders(db, tenant, *, limit=100, offset=0):
    rows = (
        _scope(db, tenant, AppointmentReminder)
        .add_entity(Appointment)
        .add_entity(AppointmentResource)
        .join(
            Appointment,
            (Appointment.id == AppointmentReminder.appointment_id)
            & (Appointment.tenant_id == AppointmentReminder.tenant_id)
            & (Appointment.branch_id == AppointmentReminder.branch_id),
        )
        .join(
            AppointmentResource,
            (AppointmentResource.id == Appointment.resource_id)
            & (AppointmentResource.tenant_id == Appointment.tenant_id)
            & (AppointmentResource.branch_id == Appointment.branch_id),
        )
        .filter(
            AppointmentReminder.status == "pending",
            AppointmentReminder.due_at <= now(),
            Appointment.status == "scheduled",
            Appointment.version == AppointmentReminder.appointment_version,
        )
        .order_by(AppointmentReminder.due_at, AppointmentReminder.id)
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    return {
        "items": [
            _reminder_response(db, row, appointment, resource)
            for row, appointment, resource in rows[:limit]
        ],
        "has_more": len(rows) > limit,
    }


def resolve_reminder(db, tenant, actor, reminder_id, body, key):
    fingerprint, replay = _claim(db, tenant, key, f"reminder.resolve.{reminder_id}", body)
    if replay:
        return replay.response_status, replay.response_body
    observed = _scope(db, tenant, AppointmentReminder).filter_by(id=reminder_id).first()
    if observed is None:
        raise not_found("Recordatorio no encontrado")
    observed_appointment = _appointment(db, tenant, observed.appointment_id)
    _lock(db, tenant, observed_appointment.resource_id)
    row = (
        _scope(db, tenant, AppointmentReminder)
        .filter_by(id=reminder_id)
        .populate_existing()
        .with_for_update()
        .first()
    )
    appointment = _appointment(db, tenant, row.appointment_id)
    if row.version != body.expected_version or row.status != "pending":
        raise conflict("El recordatorio cambió; actualiza antes de continuar")
    if (
        appointment.status != "scheduled"
        or appointment.version != row.appointment_version
        or row.due_at > now()
        or not _customer(db, tenant, appointment.customer_id).is_active
    ):
        raise conflict("La cita o el cliente cambiaron, o el recordatorio todavía no vence")
    row.status = body.status
    row.version += 1
    row.resolved_at = now()
    db.flush()
    return _finish(
        db,
        tenant,
        actor,
        key,
        fingerprint,
        row,
        _reminder_response(db, row, appointment),
        200,
        "appointment.reminder.resolved",
    )


def _sale_response(sale, refunded=0):
    return AppointmentSaleResponse(
        id=sale.id,
        status=sale.status,
        total_amount=sale.total_amount,
        refunded_amount=refunded,
        created_at=_utc(sale.created_at),
    ).model_dump(mode="json")


def _refund_totals(db, tenant, sale_ids):
    if not sale_ids:
        return {}
    return dict(
        _scope(db, tenant, Refund)
        .filter(Refund.order_id.in_(sale_ids))
        .with_entities(Refund.order_id, func.sum(Refund.refunded_amount))
        .group_by(Refund.order_id)
        .all()
    )


def _linked_sales(db, tenant, appointment_ids):
    if not appointment_ids:
        return {}
    rows = (
        _scope(db, tenant, AppointmentSale)
        .join(
            Order,
            (Order.id == AppointmentSale.sale_order_id)
            & (Order.tenant_id == AppointmentSale.tenant_id)
            & (Order.branch_id == AppointmentSale.branch_id),
        )
        .add_entity(Order)
        .filter(AppointmentSale.appointment_id.in_(appointment_ids))
        .all()
    )
    # One aggregate for this page; never infer payment from attendance.
    sale_ids = [sale.id for _, sale in rows]
    refunds = _refund_totals(db, tenant, sale_ids)
    return {
        link.appointment_id: _sale_response(sale, refunds.get(sale.id, 0)) for link, sale in rows
    }


def get_appointment(db, tenant, appointment_id):
    return _appointment_response(db, _appointment(db, tenant, appointment_id))


def available_sales(db, tenant, appointment_id, *, limit=50, offset=0):
    row = _appointment(db, tenant, appointment_id)
    linked = _scope(db, tenant, AppointmentSale).with_entities(AppointmentSale.sale_order_id)
    sales = (
        _scope(db, tenant, Order)
        .filter(
            Order.customer_id == row.customer_id,
            Order.status == "completed",
            Order.id.not_in(linked),
        )
        .order_by(Order.created_at.desc(), Order.id)
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    refunds = _refund_totals(db, tenant, [sale.id for sale in sales[:limit]])
    return {
        "items": [_sale_response(sale, refunds.get(sale.id, 0)) for sale in sales[:limit]],
        "has_more": len(sales) > limit,
    }


def link_sale(db, tenant, actor, appointment_id, body, key):
    fingerprint, replay = _claim(db, tenant, key, f"appointment.sale.{appointment_id}", body)
    if replay:
        return replay.response_status, replay.response_body
    # Lock the sale before the appointment: refunds/voids serialize on the same sale.
    sale = _scope(db, tenant, Order).filter_by(id=body.sale_order_id).with_for_update().first()
    if sale is None:
        raise not_found("Venta no encontrada en esta sucursal")
    row = _appointment(db, tenant, appointment_id, lock=True)
    if row.version != body.expected_version:
        raise conflict("La cita cambió; actualiza antes de vincular la venta")
    if row.status not in {"scheduled", "completed"}:
        raise conflict("Sólo puedes vincular ventas a citas programadas o atendidas")
    if sale.customer_id != row.customer_id or sale.status != "completed":
        raise conflict("Elige una venta vigente del mismo cliente")
    if not _customer(db, tenant, row.customer_id).is_active:
        raise conflict("El cliente está desactivado")
    if _scope(db, tenant, AppointmentSale).filter_by(appointment_id=row.id).first():
        raise conflict("La cita ya tiene una venta vinculada")
    if _scope(db, tenant, AppointmentSale).filter_by(sale_order_id=sale.id).first():
        raise conflict("La venta ya está vinculada a otra cita")
    db.add(
        AppointmentSale(
            tenant_id=tenant,
            branch_id=row.branch_id,
            appointment_id=row.id,
            sale_order_id=sale.id,
            actor_user_id=actor,
        )
    )
    row.version += 1
    row.updated_at = now()
    db.flush()
    _record_change(db, row, actor, "sale_linked")
    return _finish(
        db,
        tenant,
        actor,
        key,
        fingerprint,
        row,
        _appointment_response(db, row),
        200,
        "appointment.sale_linked",
    )
