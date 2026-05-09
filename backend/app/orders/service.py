import hashlib
import json
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.idempotency import service as idempotency_service
from app.orders import repository as repo
from app.orders.models import Order, Payment
from app.orders.schemas import OrderCreate
from app.pricing import calculator
from app.shared.exceptions import bad_request, not_found


def _hash_payload(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def _stored_response(
    db: Session, *, tenant_id: UUID, idempotency_key: str, payload: dict[str, Any]
) -> tuple[int, dict[str, Any]] | None:
    existing = idempotency_service.get(db, tenant_id=tenant_id, key=idempotency_key)
    if not existing:
        return None
    if existing.request_hash != _hash_payload(payload):
        raise bad_request("Idempotency key reused with different request body")
    return existing.response_status or 200, existing.response_body or {}


def _store_response(
    db: Session,
    *,
    tenant_id: UUID,
    idempotency_key: str,
    payload: dict[str, Any],
    status_code: int,
    response_body: dict[str, Any],
) -> None:
    idempotency_service.store(
        db,
        tenant_id=tenant_id,
        key=idempotency_key,
        request_hash=_hash_payload(payload),
        response_status=status_code,
        response_body=response_body,
    )


def _payment_body(payment: Payment) -> dict[str, Any]:
    return {
        "id": str(payment.id),
        "method": payment.method,
        "amount_amount": str(payment.amount_amount),
        "amount_tendered_amount": (
            str(payment.amount_tendered_amount)
            if payment.amount_tendered_amount is not None
            else None
        ),
        "change_due_amount": str(payment.change_due_amount),
        "reference": payment.reference,
    }


def _order_body(db: Session, *, tenant_id: UUID, order: Order) -> dict[str, Any]:
    items = repo.list_order_items(db, tenant_id=tenant_id, order_id=order.id)
    payment = repo.get_payment(db, tenant_id=tenant_id, order_id=order.id)
    if not payment:
        raise not_found("Payment not found")
    return {
        "id": str(order.id),
        "tenant_id": str(order.tenant_id),
        "status": order.status,
        "subtotal_amount": str(order.subtotal_amount),
        "total_amount": str(order.total_amount),
        "items": [
            {
                "id": str(item.id),
                "product_id": str(item.product_id),
                "product_name": item.product_name,
                "quantity": item.quantity,
                "unit_price_amount": str(item.unit_price_amount),
                "line_total_amount": str(item.line_total_amount),
            }
            for item in items
        ],
        "payment": _payment_body(payment),
    }


def _validate_payment(body: OrderCreate, total: Decimal) -> tuple[Decimal, Decimal | None, Decimal]:
    payment_amount = calculator.money(body.payment.amount)
    if body.payment.method == "cash":
        tendered = calculator.money(body.payment.amount_tendered or Decimal("0.00"))
        if tendered < total:
            raise bad_request("Cash tendered must be greater than or equal to order total")
        if payment_amount != total:
            raise bad_request("Cash payment amount must equal order total")
        return payment_amount, tendered, calculator.money(tendered - total)

    if payment_amount != total:
        raise bad_request("Manual payment amount must equal order total")
    return payment_amount, None, Decimal("0.00")


def create_order(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    body: OrderCreate,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = body.model_dump(mode="json")
    stored = _stored_response(
        db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload
    )
    if stored:
        return stored

    priced_items = []
    for item in body.items:
        product = repo.get_active_product_for_update(
            db, tenant_id=tenant_id, product_id=item.product_id
        )
        if not product:
            raise not_found("Product not found")
        line_total = calculator.line_total(product.price_amount, item.quantity)
        priced_items.append((product, item.quantity, line_total))

    subtotal = calculator.order_total([line_total for _, _, line_total in priced_items])
    total = subtotal
    payment_amount, amount_tendered, change_due = _validate_payment(body, total)

    order = repo.create_order(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        subtotal_amount=subtotal,
        total_amount=total,
    )
    for product, quantity, line_total in priced_items:
        repo.create_order_item(
            db,
            tenant_id=tenant_id,
            order_id=order.id,
            product=product,
            quantity=quantity,
            line_total_amount=line_total,
        )
        if product.track_inventory:
            repo.create_inventory_movement(
                db,
                tenant_id=tenant_id,
                product_id=product.id,
                order_id=order.id,
                quantity_delta=-quantity,
            )

    repo.create_payment(
        db,
        tenant_id=tenant_id,
        order_id=order.id,
        method=body.payment.method,
        amount=payment_amount,
        amount_tendered=amount_tendered,
        change_due=change_due,
        reference=body.payment.reference,
    )

    response_body = _order_body(db, tenant_id=tenant_id, order=order)
    audit_service.log(
        db,
        action="orders.create",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="order",
        resource_id=order.id,
        changes=response_body,
    )
    _store_response(
        db,
        tenant_id=tenant_id,
        idempotency_key=idempotency_key,
        payload=payload,
        status_code=201,
        response_body=response_body,
    )
    db.commit()
    return 201, response_body


def get_order(db: Session, *, tenant_id: UUID, order_id: UUID) -> dict[str, Any]:
    order = repo.get_order(db, tenant_id=tenant_id, order_id=order_id)
    if not order:
        raise not_found("Order not found")
    return _order_body(db, tenant_id=tenant_id, order=order)
