import hashlib
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.idempotency import service as idempotency_service
from app.inventory import repository as inventory_repo
from app.modifiers import service as modifier_service
from app.modifiers.models import OrderItemModifier
from app.orders import repository as repo
from app.orders.models import Order, Payment
from app.orders.schemas import OrderCreate, PaymentCreate, RefundCreate
from app.pricing import calculator
from app.shared.exceptions import bad_request, not_found
from app.shifts import repository as shifts_repo
from app.tenants import repository as tenant_repo

# Bound the client-supplied ring-time so a skewed or malicious clock cannot
# rewrite history: a value more than a day in the future or a month in the past
# is treated as untrustworthy and falls back to server-now.
_MAX_FUTURE_SKEW = timedelta(hours=24)
_MAX_PAST_SKEW = timedelta(days=30)


def _clamp_occurred_at(occurred_at: datetime | None) -> datetime:
    """Resolve the sale's ring-time to a trusted, tz-aware UTC datetime.

    None (online sales / legacy queue items) → server now. A client value is
    normalized to UTC and accepted only within the skew window; anything
    outside it degrades to server now rather than corrupting reports.
    """
    now = datetime.now(UTC)
    if occurred_at is None:
        return now
    ts = occurred_at
    ts = ts.replace(tzinfo=UTC) if ts.tzinfo is None else ts.astimezone(UTC)
    if ts > now + _MAX_FUTURE_SKEW or ts < now - _MAX_PAST_SKEW:
        return now
    return ts


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


def _item_modifiers(db: Session, *, tenant_id: UUID, order_item_id: UUID) -> list[dict]:
    from app.modifiers.models import OrderItemModifier
    mods = (
        db.query(OrderItemModifier)
        .filter(
            OrderItemModifier.tenant_id == tenant_id,
            OrderItemModifier.order_item_id == order_item_id,
        )
        .all()
    )
    return [
        {
            "modifier_group_name": m.modifier_group_name,
            "modifier_option_name": m.modifier_option_name,
            "price_delta_amount": str(m.price_delta_amount),
        }
        for m in mods
    ]


def _order_body(db: Session, *, tenant_id: UUID, order: Order) -> dict[str, Any]:
    items = repo.list_order_items(db, tenant_id=tenant_id, order_id=order.id)
    payments = repo.list_payments(db, tenant_id=tenant_id, order_id=order.id)
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
                "modifiers": _item_modifiers(db, tenant_id=tenant_id, order_item_id=item.id),
            }
            for item in items
        ],
        "payments": [_payment_body(p) for p in payments],
    }


def _validate_payments(
    payments: list[PaymentCreate], total: Decimal
) -> list[tuple[Decimal, Decimal | None, Decimal]]:
    """Validate split payment entries and return (amount, tendered, change_due) per entry."""
    payment_sum = calculator.money(sum(p.amount for p in payments))
    if payment_sum != total:
        raise bad_request(f"Payment total {payment_sum} does not equal order total {total}")

    result = []
    for p in payments:
        amount = calculator.money(p.amount)
        if p.method == "cash":
            if p.amount_tendered is None:
                raise bad_request("Cash payment requires amount_tendered")
            tendered = calculator.money(p.amount_tendered)
            if tendered < amount:
                raise bad_request("Cash tendered must be >= cash payment amount")
            result.append((amount, tendered, calculator.money(tendered - amount)))
        else:
            result.append((amount, None, Decimal("0.00")))
    return result


def create_order(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    body: OrderCreate,
    idempotency_key: str,
    client_uuid: UUID | None = None,
    link_to_open_shift: bool = True,
    shift_id: UUID | None = None,
    occurred_at: datetime | None = None,
) -> tuple[int, dict[str, Any]]:
    payload = body.model_dump(mode="json")
    if client_uuid:
        payload["client_uuid"] = str(client_uuid)
    stored = _stored_response(
        db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload
    )
    if stored:
        return stored

    if client_uuid:
        existing = repo.get_order_by_client_uuid(db, tenant_id=tenant_id, client_uuid=client_uuid)
        if existing:
            return 200, _order_body(db, tenant_id=tenant_id, order=existing)

    priced_items = []
    # Aggregate requested quantities per product so multiple cart lines
    # for the same product (e.g. with different modifiers) collectively
    # validate against current on-hand.
    quantity_by_product: dict[UUID, int] = {}
    for item in body.items:
        product = repo.get_active_product_for_update(
            db, tenant_id=tenant_id, product_id=item.product_id
        )
        if not product:
            raise not_found("Product not found")
        price_delta, modifier_snapshots = modifier_service.validate_and_price_modifiers(
            db, tenant_id=tenant_id, product_id=product.id,
            modifier_option_ids=item.modifier_option_ids,
        )
        effective_price = calculator.money(product.price_amount + price_delta)
        line_total = calculator.line_total(effective_price, item.quantity)
        priced_items.append(
            (product, item.quantity, effective_price, line_total, modifier_snapshots)
        )
        if product.track_inventory:
            quantity_by_product[product.id] = (
                quantity_by_product.get(product.id, 0) + item.quantity
            )

    # Out-of-stock guard: prevent selling tracked products below zero.
    for product_id, requested_qty in quantity_by_product.items():
        on_hand = inventory_repo.stock_on_hand(
            db, tenant_id=tenant_id, product_id=product_id
        )
        if requested_qty > on_hand:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "OUT_OF_STOCK",
                    "product_id": str(product_id),
                    "available": on_hand,
                    "requested": requested_qty,
                    "message": (
                        "No hay stock suficiente para vender este producto. "
                        "Actualiza inventario antes de cobrar."
                    ),
                },
            )

    subtotal = calculator.order_total([lt for _, _, _, lt, _ in priced_items])
    total = subtotal
    validated_payments = _validate_payments(body.payments, total)

    # Attribute real-time sales to the open shift so their cash counts toward
    # the drawer's expected cash. Offline syncs pass link_to_open_shift=False
    # plus a tenant-verified shift_id captured at ring time (or None): they
    # were rung in a past (possibly closed) shift and must not inflate the
    # current drawer.
    # NOTE: shift_id and occurred_at must never enter the idempotency payload
    # hash above — replays of pre-deploy queue items (which lacked these
    # fields) would otherwise be rejected as "Idempotency key reused with
    # different request body".
    if link_to_open_shift:
        open_shift = shifts_repo.get_open_shift(db, tenant_id=tenant_id)
        if any(p.method == "cash" for p in body.payments) and not open_shift:
            # Product decision: cash must land in an open drawer so the
            # shift's expected cash always reconciles. Mirrors the cash
            # refund rule below.
            raise bad_request("Open a shift before accepting cash payments")
        shift_id = open_shift.id if open_shift else None

    order = repo.create_order(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        subtotal_amount=subtotal,
        total_amount=total,
        client_uuid=client_uuid,
        shift_id=shift_id,
        occurred_at=_clamp_occurred_at(occurred_at),
    )
    for product, quantity, effective_price, line_total, modifier_snapshots in priced_items:
        order_item = repo.create_order_item(
            db,
            tenant_id=tenant_id,
            order_id=order.id,
            product=product,
            quantity=quantity,
            unit_price_amount=effective_price,
            line_total_amount=line_total,
        )
        for snap in modifier_snapshots:
            db.add(OrderItemModifier(
                tenant_id=tenant_id,
                order_item_id=order_item.id,
                **snap,
            ))
        if product.track_inventory:
            repo.create_inventory_movement(
                db,
                tenant_id=tenant_id,
                product_id=product.id,
                order_id=order.id,
                quantity_delta=-quantity,
            )

    for payment_entry, (amount, tendered, change_due) in zip(
        body.payments, validated_payments, strict=True
    ):
        repo.create_payment(
            db,
            tenant_id=tenant_id,
            order_id=order.id,
            method=payment_entry.method,
            amount=amount,
            amount_tendered=tendered,
            change_due=change_due,
            reference=payment_entry.reference,
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


def get_receipt(db: Session, *, tenant_id: UUID, order_id: UUID) -> dict[str, Any]:
    order = repo.get_order(db, tenant_id=tenant_id, order_id=order_id)
    if not order:
        raise not_found("Order not found")

    items = repo.list_order_items(db, tenant_id=tenant_id, order_id=order_id)
    payments = repo.list_payments(db, tenant_id=tenant_id, order_id=order_id)
    refunds = repo.list_refunds(db, tenant_id=tenant_id, order_id=order_id)
    void = repo.get_void(db, tenant_id=tenant_id, order_id=order_id)
    tenant = tenant_repo.get_by_id(db, tenant_id)

    total_tendered = calculator.money(
        sum(p.amount_tendered_amount for p in payments if p.amount_tendered_amount is not None)
    )
    total_change = calculator.money(sum(p.change_due_amount for p in payments))

    refund_items = []
    for refund in refunds:
        refund_items.extend(repo.list_refund_items(db, refund_id=refund.id))

    return {
        "order_id": str(order.id),
        "receipt_number": str(order.id).replace("-", "")[-8:].upper(),
        "tenant_name": tenant.name if tenant else "",
        # Ring-time so the receipt shows when the sale happened, not when an
        # offline sale later synced.
        "created_at": (order.occurred_at or order.created_at).isoformat(),
        "status": order.status,
        "items": [
            {
                "product_name": item.product_name,
                "quantity": item.quantity,
                "unit_price_amount": str(item.unit_price_amount),
                "line_total_amount": str(item.line_total_amount),
                "modifiers": _item_modifiers(
                    db,
                    tenant_id=tenant_id,
                    order_item_id=item.id,
                ),
            }
            for item in items
        ],
        "subtotal_amount": str(order.subtotal_amount),
        "total_amount": str(order.total_amount),
        "payments": [_payment_body(p) for p in payments],
        "total_tendered": str(total_tendered),
        "total_change": str(total_change),
        "refunds": [
            {
                "id": str(r.id),
                "reason": r.reason,
                "refunded_amount": str(r.refunded_amount),
                "created_at": r.created_at.isoformat(),
                "items": [
                    {
                        "order_item_id": str(ri.order_item_id),
                        "quantity": ri.quantity,
                        "unit_price_amount": str(ri.unit_price_amount),
                        "line_total_amount": str(ri.line_total_amount),
                    }
                    for ri in repo.list_refund_items(db, refund_id=r.id)
                ],
            }
            for r in refunds
        ],
        "void": {
            "id": str(void.id),
            "reason": void.reason,
            "created_at": void.created_at.isoformat(),
        }
        if void
        else None,
    }


def create_refund(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    order_id: UUID,
    body: RefundCreate,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = body.model_dump(mode="json")
    payload["order_id"] = str(order_id)
    stored = _stored_response(
        db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload
    )
    if stored:
        return stored

    order = repo.get_order_for_update(db, tenant_id=tenant_id, order_id=order_id)
    if not order:
        raise not_found("Order not found")

    if order.status == "voided":
        raise bad_request("Cannot refund a voided order")

    existing_void = repo.get_void(db, tenant_id=tenant_id, order_id=order_id)
    if existing_void:
        raise bad_request("Cannot refund a voided order")

    all_items = repo.list_order_items(db, tenant_id=tenant_id, order_id=order_id)
    items_by_id = {item.id: item for item in all_items}

    refund_lines = []
    total_refunded = Decimal("0.00")

    for refund_item in body.items:
        order_item = items_by_id.get(refund_item.order_item_id)
        if not order_item:
            raise bad_request(f"Order item {refund_item.order_item_id} not found")

        existing_refunds = repo.list_refunds(db, tenant_id=tenant_id, order_id=order_id)
        refunded_qty = sum(
            ri.quantity
            for r in existing_refunds
            for ri in repo.list_refund_items(db, refund_id=r.id)
            if ri.order_item_id == refund_item.order_item_id
        )

        if refunded_qty + refund_item.quantity > order_item.quantity:
            available = order_item.quantity - refunded_qty
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "REFUND_QTY_EXCEEDS_AVAILABLE",
                    "available": available,
                    "requested": refund_item.quantity,
                    "message": (
                        f"La cantidad excede lo disponible para devolución "
                        f"(máx. {available})."
                    ),
                },
            )

        line_total = calculator.line_total(order_item.unit_price_amount, refund_item.quantity)
        refund_lines.append((order_item, refund_item.quantity, line_total))
        total_refunded = calculator.money(total_refunded + line_total)

    cash_refund_shift = None
    if body.refund_payment_method == "cash":
        cash_refund_shift = shifts_repo.get_open_shift(db, tenant_id=tenant_id)
        if not cash_refund_shift:
            raise bad_request("Open a shift before refunding cash from the drawer")

    refund = repo.create_refund(
        db,
        tenant_id=tenant_id,
        order_id=order_id,
        user_id=user_id,
        reason=body.reason,
        refunded_amount=total_refunded,
    )

    for order_item, quantity, line_total in refund_lines:
        repo.create_refund_item(
            db,
            refund_id=refund.id,
            order_item_id=order_item.id,
            quantity=quantity,
            unit_price_amount=order_item.unit_price_amount,
            line_total_amount=line_total,
        )

        if order_item.product_id:
            repo.create_inventory_movement(
                db,
                tenant_id=tenant_id,
                product_id=order_item.product_id,
                order_id=order_id,
                quantity_delta=quantity,
            )

    refund_items = repo.list_refund_items(db, refund_id=refund.id)
    response_body = {
        "id": str(refund.id),
        "order_id": str(refund.order_id),
        "reason": refund.reason,
        "refunded_amount": str(refund.refunded_amount),
        "items": [
            {
                "id": str(ri.id),
                "order_item_id": str(ri.order_item_id),
                "quantity": ri.quantity,
                "unit_price_amount": str(ri.unit_price_amount),
                "line_total_amount": str(ri.line_total_amount),
            }
            for ri in refund_items
        ],
        "created_at": refund.created_at.isoformat(),
    }

    if cash_refund_shift:
        movement = shifts_repo.create_cash_movement(
            db,
            tenant_id=tenant_id,
            shift_id=cash_refund_shift.id,
            type="refund_payout",
            amount=total_refunded,
            reason="refund_payout",
            user_id=user_id,
        )
        audit_service.log(
            db,
            action="shifts.cash_movement",
            tenant_id=tenant_id,
            user_id=user_id,
            resource_type="cash_movement",
            resource_id=movement.id,
            changes={
                "id": str(movement.id),
                "shift_id": str(movement.shift_id),
                "type": movement.type,
                "amount": str(movement.amount),
                "reason": movement.reason,
                "refund_id": str(refund.id),
                "order_id": str(order_id),
                "created_at": movement.created_at.isoformat(),
            },
        )

    audit_service.log(
        db,
        action="orders.refund",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="refund",
        resource_id=refund.id,
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


def list_refunds(db: Session, *, tenant_id: UUID, order_id: UUID) -> list[dict[str, Any]]:
    refunds = repo.list_refunds(db, tenant_id=tenant_id, order_id=order_id)
    return [
        {
            "id": str(r.id),
            "order_id": str(r.order_id),
            "reason": r.reason,
            "refunded_amount": str(r.refunded_amount),
            "items": [
                {
                    "id": str(ri.id),
                    "order_item_id": str(ri.order_item_id),
                    "quantity": ri.quantity,
                    "unit_price_amount": str(ri.unit_price_amount),
                    "line_total_amount": str(ri.line_total_amount),
                }
                for ri in repo.list_refund_items(db, refund_id=r.id)
            ],
            "created_at": r.created_at.isoformat(),
        }
        for r in refunds
    ]


def get_refund(db: Session, *, tenant_id: UUID, refund_id: UUID) -> dict[str, Any]:
    refund = repo.get_refund(db, tenant_id=tenant_id, refund_id=refund_id)
    if not refund:
        raise not_found("Refund not found")

    items = repo.list_refund_items(db, refund_id=refund.id)
    return {
        "id": str(refund.id),
        "order_id": str(refund.order_id),
        "reason": refund.reason,
        "refunded_amount": str(refund.refunded_amount),
        "items": [
            {
                "id": str(ri.id),
                "order_item_id": str(ri.order_item_id),
                "quantity": ri.quantity,
                "unit_price_amount": str(ri.unit_price_amount),
                "line_total_amount": str(ri.line_total_amount),
            }
            for ri in items
        ],
        "created_at": refund.created_at.isoformat(),
    }


def create_void(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    order_id: UUID,
    reason: str,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = {"order_id": str(order_id), "reason": reason}
    stored = _stored_response(
        db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload
    )
    if stored:
        return stored

    order = repo.get_order_for_update(db, tenant_id=tenant_id, order_id=order_id)
    if not order:
        raise not_found("Order not found")

    if order.status == "voided":
        raise bad_request("Order is already voided")

    existing_refunds = repo.list_refunds(db, tenant_id=tenant_id, order_id=order_id)
    if existing_refunds:
        raise bad_request("Cannot void an order with existing refunds")

    existing_void = repo.get_void(db, tenant_id=tenant_id, order_id=order_id)
    if existing_void:
        raise bad_request("Order is already voided")

    void = repo.create_void(
        db,
        tenant_id=tenant_id,
        order_id=order_id,
        user_id=user_id,
        reason=reason,
    )

    order.status = "voided"
    db.add(order)

    items = repo.list_order_items(db, tenant_id=tenant_id, order_id=order_id)
    for item in items:
        if item.product_id:
            repo.create_inventory_movement(
                db,
                tenant_id=tenant_id,
                product_id=item.product_id,
                order_id=order_id,
                quantity_delta=item.quantity,
            )

    response_body = {
        "id": str(void.id),
        "order_id": str(void.order_id),
        "reason": void.reason,
        "created_at": void.created_at.isoformat(),
    }

    audit_service.log(
        db,
        action="orders.void",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="void",
        resource_id=void.id,
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
