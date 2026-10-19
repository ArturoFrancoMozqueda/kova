"""Human customer service: private workflow only, no outbound or financial effects."""

import hashlib
from datetime import UTC

from sqlalchemy import exists, or_

from app.audit import service as audit
from app.auth.models import Membership, User
from app.branches.scope import active_branch_id
from app.crm.service import _customer
from app.customer_orders.models import CustomerOrder
from app.customers.models import Customer
from app.idempotency import service as idempotency
from app.orders.models import Order
from app.quotes.models import CustomerQuote
from app.service_cases.models import ServiceCase, ServiceCaseEvent, now
from app.service_cases.schemas import ServiceCaseEventResponse, ServiceCaseResponse
from app.shared.exceptions import bad_request, conflict, not_found

ACTIVE = {"open", "in_progress", "reopened"}
TRANSITIONS = {
    "open": {"in_progress", "resolved", "cancelled"},
    "in_progress": {"resolved", "cancelled"},
    "reopened": {"in_progress", "resolved", "cancelled"},
    "resolved": {"reopened"},
    "cancelled": set(),
}


def _scope(db, tenant, model):
    return db.query(model).filter(
        model.tenant_id == tenant, model.branch_id == active_branch_id(db, tenant)
    )


def _get(db, tenant, case_id, *, lock=False):
    query = _scope(db, tenant, ServiceCase).filter_by(id=case_id)
    row = query.populate_existing().with_for_update().first() if lock else query.first()
    if row is None:
        raise not_found("Caso de atención no encontrado")
    return row


def _members(db, tenant):
    branch = active_branch_id(db, tenant)
    return (
        db.query(Membership, User)
        .join(User, User.id == Membership.user_id)
        .filter(
            Membership.tenant_id == tenant,
            Membership.is_active.is_(True),
            User.is_active.is_(True),
            or_(Membership.allowed_branch_id.is_(None), Membership.allowed_branch_id == branch),
        )
    )


def _assignee(db, tenant, user_id):
    if (
        user_id is not None
        and not _members(db, tenant).filter(Membership.user_id == user_id).first()
    ):
        raise not_found("Responsable activo no disponible en esta sucursal")


def assignees(db, tenant, *, limit=100, offset=0):
    rows = _members(db, tenant).order_by(User.email, User.id).offset(offset).limit(limit + 1).all()
    return {
        "items": [
            {"user_id": str(member.user_id), "email": user.email, "role": member.role}
            for member, user in rows[:limit]
        ],
        "has_more": len(rows) > limit,
    }


def _utc(value):
    return value.astimezone(UTC) if value is not None else None


def _response(db, row, customer=None, active_assignees=None):
    customer = customer or _customer(db, row.tenant_id, row.customer_id)
    fields = {
        name: getattr(row, name)
        for name in ServiceCaseResponse.model_fields
        if name not in {"customer_name", "overdue", "assignee_active"}
    }
    for name in ("due_at", "created_at", "updated_at", "resolved_at"):
        fields[name] = _utc(fields[name])
    return ServiceCaseResponse(
        **fields,
        customer_name=customer.name,
        overdue=bool(row.status in ACTIVE and row.due_at is not None and _utc(row.due_at) < now()),
        assignee_active=(row.assigned_user_id in active_assignees)
        if active_assignees is not None
        else bool(
            row.assigned_user_id is not None
            and _members(db, row.tenant_id)
            .filter(Membership.user_id == row.assigned_user_id)
            .first()
        ),
    ).model_dump(mode="json")


def _claim(db, tenant, key, scope, body):
    if not key or len(key) > 200 or not key.strip():
        raise bad_request("Idempotency-Key debe contener de 1 a 200 caracteres")
    digest = hashlib.sha256(f"service-cases:{scope}:{body.model_dump_json()}".encode()).hexdigest()
    return digest, idempotency.claim(db, tenant_id=tenant, key=key, request_hash=digest)


def _finish(db, tenant, actor, key, digest, row, action, changed, *, status=200):
    result = _response(db, row)
    audit.log(
        db,
        tenant_id=tenant,
        user_id=actor,
        action=action,
        resource_type="service_case",
        resource_id=row.id,
        changes={"version": row.version, "status": row.status, "fields": changed},
    )
    idempotency.store(
        db,
        tenant_id=tenant,
        key=key,
        request_hash=digest,
        response_status=status,
        response_body=result,
    )
    db.commit()
    return status, result


def _record(db, row, actor, kind, note=None):
    db.add(
        ServiceCaseEvent(
            tenant_id=row.tenant_id,
            branch_id=row.branch_id,
            case_id=row.id,
            case_version=row.version,
            kind=kind,
            actor_user_id=actor,
            status=row.status,
            assigned_user_id=row.assigned_user_id,
            due_at=row.due_at,
            note=note,
        )
    )
    db.flush()


def _validate_sources(db, tenant, customer_id, sale_id, order_id):
    if sale_id is not None:
        sale = _scope(db, tenant, Order).filter_by(id=sale_id, customer_id=customer_id).first()
        if sale is None:
            raise not_found("Venta de este cliente no encontrada en la sucursal")
    if order_id is not None:
        order = _scope(db, tenant, CustomerOrder).filter_by(id=order_id).with_for_update().first()
        if order is None:
            raise not_found("Pedido no encontrado en la sucursal")
        identities = {
            quote.customer_id
            for quote in _scope(db, tenant, CustomerQuote)
            .filter_by(customer_order_id=order.id, status="accepted")
            .all()
        }
        if order.sale_order_id is not None:
            linked_sale = _scope(db, tenant, Order).filter_by(id=order.sale_order_id).first()
            if linked_sale and linked_sale.customer_id is not None:
                identities.add(linked_sale.customer_id)
        if identities != {customer_id}:
            raise conflict("El pedido no identifica a este cliente; continúa sin vincularlo")
        if sale_id is not None and order.sale_order_id != sale_id:
            raise conflict("El pedido y la venta seleccionados no corresponden entre sí")


def references(db, tenant, customer_id, *, limit=50, offset=0):
    _customer(db, tenant, customer_id)
    branch = active_branch_id(db, tenant)
    sales = (
        _scope(db, tenant, Order)
        .filter_by(customer_id=customer_id)
        .order_by(Order.created_at.desc(), Order.id)
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    quote_matches = exists().where(
        CustomerQuote.tenant_id == tenant,
        CustomerQuote.branch_id == branch,
        CustomerQuote.customer_order_id == CustomerOrder.id,
        CustomerQuote.status == "accepted",
        CustomerQuote.customer_id == customer_id,
    )
    sale_matches = exists().where(
        Order.tenant_id == tenant,
        Order.branch_id == branch,
        Order.id == CustomerOrder.sale_order_id,
        Order.customer_id == customer_id,
    )
    foreign_quote = exists().where(
        CustomerQuote.tenant_id == tenant,
        CustomerQuote.branch_id == branch,
        CustomerQuote.customer_order_id == CustomerOrder.id,
        CustomerQuote.status == "accepted",
        CustomerQuote.customer_id != customer_id,
    )
    foreign_sale = exists().where(
        Order.tenant_id == tenant,
        Order.branch_id == branch,
        Order.id == CustomerOrder.sale_order_id,
        Order.customer_id.is_not(None),
        Order.customer_id != customer_id,
    )
    orders = (
        _scope(db, tenant, CustomerOrder)
        .filter(or_(quote_matches, sale_matches), ~foreign_quote, ~foreign_sale)
        .order_by(CustomerOrder.created_at.desc(), CustomerOrder.id)
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    return {
        "sales": [
            {
                "id": str(s.id),
                "total_amount": str(s.total_amount),
                "occurred_at": _utc(s.occurred_at or s.created_at),
                "status": s.status,
            }
            for s in sales[:limit]
        ],
        "customer_orders": [
            {"id": str(o.id), "folio": o.folio, "status": o.status} for o in orders[:limit]
        ],
        "sales_has_more": len(sales) > limit,
        "customer_orders_has_more": len(orders) > limit,
    }


def create(db, tenant, actor, body, key):
    digest, replay = _claim(db, tenant, key, "create", body)
    if replay:
        return replay.response_status, replay.response_body
    customer = _customer(db, tenant, body.customer_id, lock=True)
    if not customer.is_active:
        raise bad_request("Reactiva al cliente antes de registrar un caso")
    _assignee(db, tenant, body.assigned_user_id)
    _validate_sources(db, tenant, body.customer_id, body.sale_order_id, body.customer_order_id)
    values = body.model_dump(exclude={"note"})
    row = ServiceCase(
        tenant_id=tenant, branch_id=active_branch_id(db, tenant), created_by_user_id=actor, **values
    )
    db.add(row)
    db.flush()
    _record(db, row, actor, "created", body.note)
    return _finish(
        db, tenant, actor, key, digest, row, "service_case.created", ["created"], status=201
    )


def listing(
    db,
    tenant,
    *,
    status=None,
    customer_id=None,
    assigned_user_id=None,
    overdue_only=False,
    limit=100,
    offset=0,
):
    query = _scope(db, tenant, ServiceCase)
    if status is not None:
        query = query.filter(ServiceCase.status == status)
    if customer_id is not None:
        _customer(db, tenant, customer_id)
        query = query.filter(ServiceCase.customer_id == customer_id)
    if assigned_user_id is not None:
        # History may legitimately refer to a deactivated member; filter, don't infer access.
        query = query.filter(ServiceCase.assigned_user_id == assigned_user_id)
    if overdue_only:
        query = query.filter(ServiceCase.status.in_(ACTIVE), ServiceCase.due_at < now())
    rows = (
        query.join(
            Customer,
            (Customer.id == ServiceCase.customer_id)
            & (Customer.tenant_id == ServiceCase.tenant_id),
        )
        .add_entity(Customer)
        .order_by(ServiceCase.updated_at.desc(), ServiceCase.id)
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    assigned = {row.assigned_user_id for row, _ in rows[:limit] if row.assigned_user_id is not None}
    active_assignees = (
        {
            member.user_id
            for member, _ in _members(db, tenant).filter(Membership.user_id.in_(assigned)).all()
        }
        if assigned
        else set()
    )
    return {
        "items": [_response(db, row, customer, active_assignees) for row, customer in rows[:limit]],
        "has_more": len(rows) > limit,
    }


def get(db, tenant, case_id):
    return _response(db, _get(db, tenant, case_id))


def update(db, tenant, actor, case_id, body, key):
    digest, replay = _claim(db, tenant, key, f"update:{case_id}", body)
    if replay:
        return replay.response_status, replay.response_body
    row = _get(db, tenant, case_id, lock=True)
    if row.version != body.expected_version:
        raise conflict("El caso cambió. Actualiza antes de guardar")
    fields = body.model_dump(exclude_unset=True, exclude={"expected_version"})
    fields = {k: value for k, value in fields.items() if getattr(row, k) != value}
    if not fields:
        raise bad_request("Elige un cambio distinto del estado actual")
    if "status" in fields:
        if fields["status"] not in TRANSITIONS[row.status]:
            raise conflict("Esa transición no está disponible para el estado actual")
        if fields["status"] == "reopened" and not _customer(db, tenant, row.customer_id).is_active:
            raise conflict("Reactiva al cliente antes de reabrir el caso")
    if "assigned_user_id" in fields:
        _assignee(db, tenant, fields["assigned_user_id"])
    for name, value in fields.items():
        setattr(row, name, value)
    if "status" in fields:
        row.resolved_at = now() if row.status in {"resolved", "cancelled"} else None
    row.version += 1
    row.updated_at = now()
    db.flush()
    _record(db, row, actor, "updated")
    return _finish(db, tenant, actor, key, digest, row, "service_case.updated", sorted(fields))


def add_note(db, tenant, actor, case_id, body, key):
    digest, replay = _claim(db, tenant, key, f"note:{case_id}", body)
    if replay:
        return replay.response_status, replay.response_body
    row = _get(db, tenant, case_id, lock=True)
    if row.version != body.expected_version:
        raise conflict("El caso cambió. Actualiza antes de agregar la nota")
    row.version += 1
    row.updated_at = now()
    db.flush()
    _record(db, row, actor, "note_added", body.note)
    return _finish(db, tenant, actor, key, digest, row, "service_case.note_added", ["note"])


def events(db, tenant, case_id, *, limit=100, offset=0):
    _get(db, tenant, case_id)
    rows = (
        _scope(db, tenant, ServiceCaseEvent)
        .filter_by(case_id=case_id)
        .order_by(ServiceCaseEvent.case_version.desc())
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    result = []
    for row in rows[:limit]:
        fields = {name: getattr(row, name) for name in ServiceCaseEventResponse.model_fields}
        for name in ("due_at", "created_at"):
            fields[name] = _utc(fields[name])
        result.append(ServiceCaseEventResponse(**fields).model_dump(mode="json"))
    return {"items": result, "has_more": len(rows) > limit}
