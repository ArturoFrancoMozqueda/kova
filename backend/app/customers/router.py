import hashlib
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.audit import service as audit
from app.billing.access import require_commercial_access
from app.customers.models import Customer
from app.customers.schemas import CustomerHistory, CustomerResponse, CustomerWrite
from app.db import get_db
from app.idempotency import service as idempotency
from app.orders.models import Order, Refund
from app.rbac.permissions import Permission
from app.shared.exceptions import bad_request, not_found

router = APIRouter(prefix="/api/v1/customers", tags=["customers"])


def _get(db, tenant_id, customer_id):
    customer = (
        db.query(Customer)
        .filter(Customer.tenant_id == tenant_id, Customer.id == customer_id)
        .first()
    )
    if customer is None:
        raise not_found("Cliente no encontrado")
    return customer


@router.get("", response_model=list[CustomerResponse])
def list_customers(
    q: str = Query(default="", max_length=160),
    include_inactive: bool = False,
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    ctx=Depends(require_commercial_access(Permission.CUSTOMERS_VIEW)),
):
    _, membership, _ = ctx
    query = db.query(Customer).filter(Customer.tenant_id == membership.tenant_id)
    if not include_inactive:
        query = query.filter(Customer.is_active.is_(True))
    if q.strip():
        pattern = (
            "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        )
        query = query.filter(
            or_(
                Customer.name.ilike(pattern, escape="\\"),
                Customer.email.ilike(pattern, escape="\\"),
                Customer.phone.ilike(pattern, escape="\\"),
            )
        )
    return query.order_by(Customer.name, Customer.id).offset(offset).limit(limit).all()


def _save(db, membership, body, key, user_id, customer_id=None):
    if not key:
        raise bad_request("Idempotency-Key header is required")
    fingerprint = hashlib.sha256(
        f"customer:{customer_id}:{body.model_dump_json()}".encode()
    ).hexdigest()
    replay = idempotency.claim(
        db, tenant_id=membership.tenant_id, key=key, request_hash=fingerprint
    )
    if replay:
        return replay.response_status, replay.response_body
    customer = (
        _get(db, membership.tenant_id, customer_id)
        if customer_id
        else Customer(tenant_id=membership.tenant_id)
    )
    for field, value in body.model_dump().items():
        setattr(customer, field, value)
    db.add(customer)
    db.flush()
    result = CustomerResponse.model_validate(customer).model_dump(mode="json")
    status = 200 if customer_id else 201
    audit.log(
        db,
        tenant_id=membership.tenant_id,
        user_id=user_id,
        action="customers.update" if customer_id else "customers.create",
        resource_type="customer",
        resource_id=customer.id,
        changes={"fields": list(body.model_fields_set)},
    )
    idempotency.store(
        db,
        tenant_id=membership.tenant_id,
        key=key,
        request_hash=fingerprint,
        response_status=status,
        response_body=result,
    )
    db.commit()
    return status, result


@router.post("", response_model=CustomerResponse, status_code=201)
def create_customer(
    body: CustomerWrite,
    response: Response,
    key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_commercial_access(Permission.CUSTOMERS_MANAGE)),
):
    user, membership, _ = ctx
    status, result = _save(db, membership, body, key, user.id)
    response.status_code = status
    return result


@router.put("/{customer_id}", response_model=CustomerResponse)
def update_customer(
    customer_id: UUID,
    body: CustomerWrite,
    response: Response,
    key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_commercial_access(Permission.CUSTOMERS_MANAGE)),
):
    user, membership, _ = ctx
    status, result = _save(db, membership, body, key, user.id, customer_id)
    response.status_code = status
    return result


@router.get("/{customer_id}/history", response_model=CustomerHistory)
def customer_history(
    customer_id: UUID,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    ctx=Depends(require_commercial_access(Permission.CUSTOMERS_HISTORY)),
):
    _, membership, _ = ctx
    customer = _get(db, membership.tenant_id, customer_id)
    sale_time = func.coalesce(Order.occurred_at, Order.created_at)
    orders = (
        db.query(Order)
        .filter(Order.tenant_id == membership.tenant_id, Order.customer_id == customer_id)
        .order_by(sale_time.desc(), Order.id)
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    purchases = []
    for order in orders[:limit]:
        refunded = (
            db.query(func.coalesce(func.sum(Refund.refunded_amount), 0))
            .filter(Refund.tenant_id == membership.tenant_id, Refund.order_id == order.id)
            .scalar()
        )
        purchases.append(
            dict(
                id=order.id,
                branch_id=order.branch_id,
                occurred_at=order.occurred_at or order.created_at,
                status=order.status,
                total_amount=order.total_amount,
                refunded_amount=refunded,
            )
        )
    return dict(
        customer=customer,
        purchases=purchases,
        limit=limit,
        offset=offset,
        has_more=len(orders) > limit,
    )
