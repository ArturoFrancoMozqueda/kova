import hashlib
import json
import logging
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.catalog.models import Product
from app.customer_orders import repository as repo
from app.customer_orders.models import (
    CustomerOrder,
    CustomerOrderItem,
    CustomerOrderItemModifier,
    InventoryReservation,
)
from app.customer_orders.schemas import (
    CustomerOrderCancel,
    CustomerOrderCheckout,
    CustomerOrderCreate,
    CustomerOrderStatusChange,
    CustomerOrderUpdate,
    VersionedAction,
)
from app.idempotency import service as idempotency_service
from app.inventory import repository as inventory_repo
from app.modifiers import service as modifier_service
from app.orders import service as order_service
from app.pricing import calculator
from app.shared.exceptions import bad_request, forbidden, not_found

_ACTIVE_STATUSES = {"confirmed", "in_progress", "ready"}
_STATUS_SEQUENCE = ["confirmed", "in_progress", "ready", "fulfilled"]
logger = logging.getLogger(__name__)


def _observe(event: str, *, order: CustomerOrder, **dimensions: object) -> None:
    """Emit categorical customer-order operations only; never log customer PII."""
    suffix = " ".join(f"{key}={value}" for key, value in dimensions.items())
    logger.info(
        "customer_order event=%s tenant=%s order=%s%s",
        event,
        order.tenant_id,
        order.id,
        f" {suffix}" if suffix else "",
    )


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


def _error(status_code: int, code: str, message: str, **details: Any) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message, **details},
    )


def _check_version(order: CustomerOrder, expected: int) -> None:
    if order.version != expected:
        raise _error(
            409,
            "VERSION_CONFLICT",
            "El pedido cambió en otro dispositivo. Actualiza antes de continuar.",
            current_version=order.version,
        )


def _get_for_update(db: Session, *, tenant_id: UUID, order_id: UUID) -> CustomerOrder:
    order = repo.get_order_for_update(db, tenant_id=tenant_id, order_id=order_id)
    if not order:
        raise not_found("Pedido no encontrado")
    return order


def _item_modifier_body(modifier: CustomerOrderItemModifier) -> dict[str, Any]:
    return {
        "id": str(modifier.id),
        "modifier_group_id": str(modifier.modifier_group_id),
        "modifier_group_name": modifier.modifier_group_name,
        "modifier_option_id": str(modifier.modifier_option_id),
        "modifier_option_name": modifier.modifier_option_name,
        "price_delta_amount": str(modifier.price_delta_amount),
    }


def _stock_conflict(db: Session, *, order: CustomerOrder) -> bool:
    if order.status not in _ACTIVE_STATUSES or order.sale_order_id:
        return False
    reservations = [
        reservation
        for reservation in repo.list_reservations(db, tenant_id=order.tenant_id, order_id=order.id)
        if reservation.status == "active"
    ]
    for reservation in reservations:
        on_hand = inventory_repo.stock_on_hand(
            db, tenant_id=order.tenant_id, product_id=reservation.product_id
        )
        total_reserved = repo.active_reserved_quantity(
            db, tenant_id=order.tenant_id, product_id=reservation.product_id
        )
        if total_reserved > on_hand:
            return True
    return False


def serialize_customer_order(db: Session, *, order: CustomerOrder) -> dict[str, Any]:
    items = repo.list_items(db, tenant_id=order.tenant_id, order_id=order.id)
    item_bodies = []
    for item in items:
        modifiers = repo.list_item_modifiers(db, tenant_id=order.tenant_id, item_id=item.id)
        item_bodies.append(
            {
                "id": str(item.id),
                "product_id": str(item.product_id),
                "product_name": item.product_name,
                "quantity": item.quantity,
                "unit_price_amount": str(item.unit_price_amount),
                "line_total_amount": str(item.line_total_amount),
                "note": item.note,
                "modifier_option_ids": [str(mod.modifier_option_id) for mod in modifiers],
                "modifiers": [_item_modifier_body(mod) for mod in modifiers],
            }
        )
    return {
        "id": str(order.id),
        "tenant_id": str(order.tenant_id),
        "folio": order.folio,
        "status": order.status,
        "payment_status": repo.payment_status(db, order=order),
        "fulfillment_type": order.fulfillment_type,
        "source_channel": order.source_channel,
        "customer_name": order.customer_name,
        "customer_phone": order.customer_phone,
        "delivery_address": order.delivery_address,
        "delivery_reference": order.delivery_reference,
        "promised_at": order.promised_at.isoformat() if order.promised_at else None,
        "note": order.note,
        "subtotal_amount": str(order.subtotal_amount),
        "total_amount": str(order.total_amount),
        "sale_order_id": str(order.sale_order_id) if order.sale_order_id else None,
        "version": order.version,
        "stock_conflict": _stock_conflict(db, order=order),
        "items": item_bodies,
        "confirmed_at": order.confirmed_at.isoformat() if order.confirmed_at else None,
        "ready_at": order.ready_at.isoformat() if order.ready_at else None,
        "fulfilled_at": order.fulfilled_at.isoformat() if order.fulfilled_at else None,
        "cancelled_at": order.cancelled_at.isoformat() if order.cancelled_at else None,
        "cancellation_reason": order.cancellation_reason,
        "cancellation_note": order.cancellation_note,
        "created_at": order.created_at.isoformat(),
        "updated_at": order.updated_at.isoformat(),
    }


def _existing_snapshots(
    db: Session, *, tenant_id: UUID, order_id: UUID
) -> dict[UUID, tuple[CustomerOrderItem, list[CustomerOrderItemModifier]]]:
    return {
        item.id: (
            item,
            repo.list_item_modifiers(db, tenant_id=tenant_id, item_id=item.id),
        )
        for item in repo.list_items(db, tenant_id=tenant_id, order_id=order_id)
    }


def _replace_items(
    db: Session,
    *,
    tenant_id: UUID,
    order: CustomerOrder,
    requested_items: list[Any],
    preserve_existing: bool,
) -> None:
    existing = (
        _existing_snapshots(db, tenant_id=tenant_id, order_id=order.id) if preserve_existing else {}
    )
    seen_existing: set[UUID] = set()
    prepared: list[tuple[Product, str, int, Decimal, str | None, list[dict[str, Any]]]] = []

    for requested in requested_items:
        existing_id = getattr(requested, "id", None)
        existing_row = existing.get(existing_id) if existing_id else None
        if existing_id and not existing_row:
            raise bad_request("El artículo no pertenece a este pedido")
        if existing_id in seen_existing:
            raise bad_request("El mismo artículo no puede repetirse en la actualización")
        if existing_id:
            seen_existing.add(existing_id)

        product = (
            db.query(Product)
            .filter(Product.tenant_id == tenant_id, Product.id == requested.product_id)
            .with_for_update()
            .first()
        )
        if not product:
            raise not_found("Producto no encontrado")

        requested_options = set(requested.modifier_option_ids)
        can_preserve = False
        snapshots: list[dict[str, Any]] = []
        unit_price: Decimal
        product_name: str
        if existing_row and existing_row[0].product_id == product.id:
            existing_options = {modifier.modifier_option_id for modifier in existing_row[1]}
            can_preserve = existing_options == requested_options

        if can_preserve and existing_row:
            old_item, old_modifiers = existing_row
            unit_price = old_item.unit_price_amount
            product_name = old_item.product_name
            snapshots = [
                {
                    "modifier_group_id": modifier.modifier_group_id,
                    "modifier_group_name": modifier.modifier_group_name,
                    "modifier_option_id": modifier.modifier_option_id,
                    "modifier_option_name": modifier.modifier_option_name,
                    "price_delta_amount": modifier.price_delta_amount,
                }
                for modifier in old_modifiers
            ]
        else:
            if not product.is_active:
                raise bad_request("El producto ya no está activo")
            price_delta, snapshots = modifier_service.validate_and_price_modifiers(
                db,
                tenant_id=tenant_id,
                product_id=product.id,
                modifier_option_ids=requested.modifier_option_ids,
            )
            unit_price = calculator.money(product.price_amount + price_delta)
            product_name = product.name

        prepared.append(
            (
                product,
                product_name,
                requested.quantity,
                unit_price,
                requested.note,
                snapshots,
            )
        )

    repo.delete_items(db, tenant_id=tenant_id, order_id=order.id)
    totals: list[Decimal] = []
    for product, product_name, quantity, unit_price, note, snapshots in prepared:
        line_total = calculator.line_total(unit_price, quantity)
        totals.append(line_total)
        item = CustomerOrderItem(
            tenant_id=tenant_id,
            customer_order_id=order.id,
            product_id=product.id,
            product_name=product_name,
            quantity=quantity,
            unit_price_amount=unit_price,
            line_total_amount=line_total,
            note=note,
        )
        db.add(item)
        db.flush()
        for snapshot in snapshots:
            db.add(
                CustomerOrderItemModifier(
                    tenant_id=tenant_id,
                    customer_order_item_id=item.id,
                    **snapshot,
                )
            )
    total = calculator.order_total(totals)
    order.subtotal_amount = total
    order.total_amount = total
    db.flush()


def _reserve_inventory(db: Session, *, order: CustomerOrder) -> None:
    items = repo.list_items(db, tenant_id=order.tenant_id, order_id=order.id)
    desired: dict[UUID, int] = {}
    for item in items:
        desired[item.product_id] = desired.get(item.product_id, 0) + item.quantity

    tracked: set[UUID] = set()
    for product_id in sorted(desired, key=str):
        product = (
            db.query(Product)
            .filter(Product.tenant_id == order.tenant_id, Product.id == product_id)
            .with_for_update()
            .first()
        )
        if not product:
            raise not_found("Producto no encontrado")
        if product.track_inventory:
            tracked.add(product.id)

    desired = {
        product_id: quantity
        for product_id, quantity in desired.items()
        if product_id in tracked
    }

    existing = {
        reservation.product_id: reservation
        for reservation in repo.list_reservations_for_update(
            db, tenant_id=order.tenant_id, order_id=order.id
        )
    }
    for product_id, quantity in desired.items():
        on_hand = inventory_repo.stock_on_hand(db, tenant_id=order.tenant_id, product_id=product_id)
        reserved_elsewhere = repo.active_reserved_quantity(
            db,
            tenant_id=order.tenant_id,
            product_id=product_id,
            excluding_order_id=order.id,
        )
        available = max(0, on_hand - reserved_elsewhere)
        if quantity > available:
            _observe(
                "stock_conflict",
                order=order,
                available=available,
                reserved=reserved_elsewhere,
                requested=quantity,
            )
            raise _error(
                422,
                "OUT_OF_STOCK",
                "No hay existencias suficientes para confirmar este pedido.",
                product_id=str(product_id),
                available=available,
                reserved=reserved_elsewhere,
                requested=quantity,
            )
        reservation = existing.get(product_id)
        if reservation:
            reservation.quantity = quantity
            reservation.status = "active"
        else:
            db.add(
                InventoryReservation(
                    tenant_id=order.tenant_id,
                    customer_order_id=order.id,
                    product_id=product_id,
                    quantity=quantity,
                    status="active",
                )
            )
    for product_id, reservation in existing.items():
        if product_id not in desired and reservation.status == "active":
            reservation.status = "released"
    db.flush()


def _release_reservations(db: Session, *, order: CustomerOrder) -> None:
    for reservation in repo.list_reservations_for_update(
        db, tenant_id=order.tenant_id, order_id=order.id
    ):
        if reservation.status == "active":
            reservation.status = "released"
    db.flush()


def _consume_reservations(db: Session, *, order: CustomerOrder) -> None:
    for reservation in repo.list_reservations_for_update(
        db, tenant_id=order.tenant_id, order_id=order.id
    ):
        if reservation.status == "active":
            reservation.status = "consumed"
    db.flush()


def list_customer_orders(
    db: Session,
    *,
    tenant_id: UUID,
    limit: int,
    offset: int,
    search: str | None = None,
    status: str | None = None,
    payment_status: str | None = None,
    fulfillment_type: str | None = None,
    promised_from: datetime | None = None,
    promised_to: datetime | None = None,
) -> dict[str, Any]:
    rows = repo.list_orders(
        db,
        tenant_id=tenant_id,
        limit=limit,
        offset=offset,
        search=search,
        status=status,
        payment_status=payment_status,
        fulfillment_type=fulfillment_type,
        promised_from=promised_from,
        promised_to=promised_to,
    )
    total = repo.count_orders(
        db,
        tenant_id=tenant_id,
        search=search,
        status=status,
        payment_status=payment_status,
        fulfillment_type=fulfillment_type,
        promised_from=promised_from,
        promised_to=promised_to,
    )
    items = [
        {
            "id": str(order.id),
            "folio": order.folio,
            "status": order.status,
            "payment_status": payment,
            "fulfillment_type": order.fulfillment_type,
            "customer_name": order.customer_name,
            "customer_phone": order.customer_phone,
            "promised_at": order.promised_at.isoformat() if order.promised_at else None,
            "total_amount": str(order.total_amount),
            "stock_conflict": _stock_conflict(db, order=order),
            "created_at": order.created_at.isoformat(),
            "updated_at": order.updated_at.isoformat(),
        }
        for order, payment in rows
    ]
    counts = {
        key: 0 for key in ["new", "confirmed", "in_progress", "ready", "fulfilled", "cancelled"]
    }
    counts.update(repo.status_counts(db, tenant_id=tenant_id))
    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
        "status_counts": counts,
    }


def get_customer_order(db: Session, *, tenant_id: UUID, order_id: UUID) -> dict[str, Any]:
    order = repo.get_order(db, tenant_id=tenant_id, order_id=order_id)
    if not order:
        raise not_found("Pedido no encontrado")
    return serialize_customer_order(db, order=order)


def create_customer_order(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    body: CustomerOrderCreate,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = body.model_dump(mode="json")
    stored = _stored_response(
        db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload
    )
    if stored:
        return stored

    order_id = uuid4()
    order = CustomerOrder(
        id=order_id,
        tenant_id=tenant_id,
        folio=f"PED-{order_id.hex[-8:].upper()}",
        status="new",
        fulfillment_type=body.fulfillment_type,
        source_channel=body.source_channel,
        customer_name=body.customer_name,
        customer_phone=body.customer_phone,
        delivery_address=body.delivery_address,
        delivery_reference=body.delivery_reference,
        promised_at=body.promised_at,
        note=body.note,
        subtotal_amount=Decimal("0.00"),
        total_amount=Decimal("0.00"),
        created_by_user_id=user_id,
        updated_by_user_id=user_id,
    )
    db.add(order)
    db.flush()
    _replace_items(
        db,
        tenant_id=tenant_id,
        order=order,
        requested_items=body.items,
        preserve_existing=False,
    )
    response_body = serialize_customer_order(db, order=order)
    audit_service.log(
        db,
        action="customer_orders.create",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="customer_order",
        resource_id=order.id,
        changes={"status": "new", "item_count": len(body.items)},
    )
    _observe("created", order=order, fulfillment=order.fulfillment_type)
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


def update_customer_order(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    order_id: UUID,
    body: CustomerOrderUpdate,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = {**body.model_dump(mode="json"), "order_id": str(order_id)}
    stored = _stored_response(
        db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload
    )
    if stored:
        return stored
    order = _get_for_update(db, tenant_id=tenant_id, order_id=order_id)
    _check_version(order, body.version)
    if repo.payment_status(db, order=order) != "unpaid":
        raise _error(
            409, "ALREADY_PAID", "Los artículos de un pedido cobrado ya no se pueden editar."
        )
    if order.status in {"fulfilled", "cancelled"}:
        raise _error(409, "INVALID_TRANSITION", "Este pedido ya terminó y no se puede editar.")

    order.fulfillment_type = body.fulfillment_type
    order.source_channel = body.source_channel
    order.customer_name = body.customer_name
    order.customer_phone = body.customer_phone
    order.delivery_address = body.delivery_address
    order.delivery_reference = body.delivery_reference
    order.promised_at = body.promised_at
    order.note = body.note
    order.updated_by_user_id = user_id
    _replace_items(
        db,
        tenant_id=tenant_id,
        order=order,
        requested_items=body.items,
        preserve_existing=True,
    )
    if order.status in _ACTIVE_STATUSES:
        _reserve_inventory(db, order=order)
    order.version += 1
    db.flush()
    response_body = serialize_customer_order(db, order=order)
    audit_service.log(
        db,
        action="customer_orders.update",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="customer_order",
        resource_id=order.id,
        changes={"version": order.version, "item_count": len(body.items)},
    )
    _store_response(
        db,
        tenant_id=tenant_id,
        idempotency_key=idempotency_key,
        payload=payload,
        status_code=200,
        response_body=response_body,
    )
    db.commit()
    return 200, response_body


def confirm_customer_order(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    order_id: UUID,
    body: VersionedAction,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = {"order_id": str(order_id), **body.model_dump(mode="json")}
    stored = _stored_response(
        db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload
    )
    if stored:
        return stored
    order = _get_for_update(db, tenant_id=tenant_id, order_id=order_id)
    _check_version(order, body.version)
    if order.status != "new":
        raise _error(409, "INVALID_TRANSITION", "Solo un pedido nuevo se puede confirmar.")
    _reserve_inventory(db, order=order)
    order.status = "confirmed"
    order.confirmed_at = datetime.now(UTC)
    order.updated_by_user_id = user_id
    order.version += 1
    db.flush()
    response_body = serialize_customer_order(db, order=order)
    audit_service.log(
        db,
        action="customer_orders.confirm",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="customer_order",
        resource_id=order.id,
        changes={"status": "confirmed"},
    )
    _observe("confirmed", order=order)
    _store_response(
        db,
        tenant_id=tenant_id,
        idempotency_key=idempotency_key,
        payload=payload,
        status_code=200,
        response_body=response_body,
    )
    db.commit()
    return 200, response_body


def change_customer_order_status(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    role: str,
    order_id: UUID,
    body: CustomerOrderStatusChange,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = {"order_id": str(order_id), **body.model_dump(mode="json")}
    stored = _stored_response(
        db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload
    )
    if stored:
        return stored
    order = _get_for_update(db, tenant_id=tenant_id, order_id=order_id)
    _check_version(order, body.version)
    if order.status in {"new", "fulfilled", "cancelled"} or body.status in {"new", "cancelled"}:
        raise _error(409, "INVALID_TRANSITION", "El cambio de estado solicitado no está permitido.")
    current_index = _STATUS_SEQUENCE.index(order.status)
    target_index = _STATUS_SEQUENCE.index(body.status)
    delta = target_index - current_index
    if delta not in {-1, 0, 1}:
        raise _error(409, "INVALID_TRANSITION", "Los estados deben avanzar de uno en uno.")
    if delta < 0 and role not in {"owner", "manager"}:
        raise forbidden("Solo gerencia puede corregir un estado anterior")
    if body.status == "fulfilled" and repo.payment_status(db, order=order) != "paid":
        raise _error(
            409, "INVALID_TRANSITION", "Cobra el pedido completo antes de marcarlo entregado."
        )
    order.status = body.status
    order.updated_by_user_id = user_id
    order.version += 1
    if body.status == "ready":
        order.ready_at = datetime.now(UTC)
    elif target_index < _STATUS_SEQUENCE.index("ready"):
        order.ready_at = None
    if body.status == "fulfilled":
        order.fulfilled_at = datetime.now(UTC)
    db.flush()
    response_body = serialize_customer_order(db, order=order)
    audit_service.log(
        db,
        action="customer_orders.status_change",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="customer_order",
        resource_id=order.id,
        changes={"status": body.status},
    )
    dimensions: dict[str, object] = {"status": body.status}
    if body.status == "fulfilled":
        dimensions["seconds_to_fulfillment"] = max(
            0, int((order.fulfilled_at - order.created_at).total_seconds())
        )
    _observe("status_changed", order=order, **dimensions)
    _store_response(
        db,
        tenant_id=tenant_id,
        idempotency_key=idempotency_key,
        payload=payload,
        status_code=200,
        response_body=response_body,
    )
    db.commit()
    return 200, response_body


def cancel_customer_order(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    role: str,
    order_id: UUID,
    body: CustomerOrderCancel,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = {"order_id": str(order_id), **body.model_dump(mode="json")}
    stored = _stored_response(
        db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload
    )
    if stored:
        return stored
    order = _get_for_update(db, tenant_id=tenant_id, order_id=order_id)
    _check_version(order, body.version)
    if order.status in {"fulfilled", "cancelled"}:
        raise _error(409, "INVALID_TRANSITION", "Este pedido ya terminó.")
    payment = repo.payment_status(db, order=order)
    if payment in {"paid", "partially_refunded"}:
        raise _error(
            409,
            "PAID_ORDER_REQUIRES_REVERSAL",
            "Gerencia debe anular o devolver totalmente la venta antes de cancelar el pedido.",
            sale_order_id=str(order.sale_order_id),
        )
    if payment in {"refunded", "voided"} and role not in {"owner", "manager"}:
        raise forbidden("Solo gerencia puede cerrar un pedido con una venta revertida")
    _release_reservations(db, order=order)
    order.status = "cancelled"
    order.cancelled_by_user_id = user_id
    order.cancellation_reason = body.reason
    order.cancellation_note = body.note
    order.cancelled_at = datetime.now(UTC)
    order.updated_by_user_id = user_id
    order.version += 1
    db.flush()
    response_body = serialize_customer_order(db, order=order)
    audit_service.log(
        db,
        action="customer_orders.cancel",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="customer_order",
        resource_id=order.id,
        changes={"status": "cancelled", "reason": body.reason},
    )
    _observe("cancelled", order=order, reason=body.reason)
    _store_response(
        db,
        tenant_id=tenant_id,
        idempotency_key=idempotency_key,
        payload=payload,
        status_code=200,
        response_body=response_body,
    )
    db.commit()
    return 200, response_body


def checkout_customer_order(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    order_id: UUID,
    body: CustomerOrderCheckout,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = {"order_id": str(order_id), **body.model_dump(mode="json")}
    stored = _stored_response(
        db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload
    )
    if stored:
        return stored
    order = _get_for_update(db, tenant_id=tenant_id, order_id=order_id)
    _check_version(order, body.version)
    if order.sale_order_id:
        raise _error(409, "ALREADY_PAID", "Este pedido ya tiene una venta vinculada.")
    if order.status not in _ACTIVE_STATUSES:
        raise _error(409, "INVALID_TRANSITION", "Confirma el pedido antes de cobrarlo.")
    if _stock_conflict(db, order=order):
        _observe("checkout_stock_conflict", order=order)
        raise _error(
            422, "OUT_OF_STOCK", "El inventario reservado ya no alcanza para cobrar este pedido."
        )

    reservations = {
        reservation.product_id: reservation
        for reservation in repo.list_reservations_for_update(
            db, tenant_id=tenant_id, order_id=order.id
        )
        if reservation.status == "active"
    }
    priced_lines: list[order_service.PricedOrderLine] = []
    quantity_by_product: dict[UUID, int] = {}
    items = repo.list_items(db, tenant_id=tenant_id, order_id=order.id)
    products: dict[UUID, Product] = {}
    for product_id in sorted({item.product_id for item in items}, key=str):
        product = (
            db.query(Product)
            .filter(Product.tenant_id == tenant_id, Product.id == product_id)
            .with_for_update()
            .first()
        )
        if not product:
            raise not_found("Producto no encontrado")
        products[product.id] = product

    for item in items:
        product = products[item.product_id]
        modifiers = repo.list_item_modifiers(db, tenant_id=tenant_id, item_id=item.id)
        snapshots = [
            {
                "modifier_group_id": modifier.modifier_group_id,
                "modifier_group_name": modifier.modifier_group_name,
                "modifier_option_id": modifier.modifier_option_id,
                "modifier_option_name": modifier.modifier_option_name,
                "price_delta_amount": modifier.price_delta_amount,
            }
            for modifier in modifiers
        ]
        priced_lines.append(
            order_service.PricedOrderLine(
                product=product,
                product_name=item.product_name,
                quantity=item.quantity,
                unit_price=item.unit_price_amount,
                line_total=item.line_total_amount,
                modifier_snapshots=snapshots,
            )
        )
        if product.track_inventory:
            quantity_by_product[product.id] = quantity_by_product.get(product.id, 0) + item.quantity
    for product_id, quantity in quantity_by_product.items():
        reservation = reservations.get(product_id)
        if not reservation or reservation.quantity != quantity:
            raise _error(
                422,
                "OUT_OF_STOCK",
                "La reserva del pedido ya no es válida.",
                product_id=str(product_id),
            )

    sale = order_service.persist_completed_order(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        priced_items=priced_lines,
        payments=body.payments,
    )
    order.sale_order_id = sale.id
    order.updated_by_user_id = user_id
    order.version += 1
    _consume_reservations(db, order=order)
    db.flush()
    sale_body = order_service.serialize_order(db, tenant_id=tenant_id, order=sale)
    response_body = {
        "customer_order": serialize_customer_order(db, order=order),
        "sale_order": sale_body,
    }
    audit_service.log(
        db,
        action="orders.create",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="order",
        resource_id=sale.id,
        changes={"source": "customer_order", "customer_order_id": str(order.id)},
    )
    audit_service.log(
        db,
        action="customer_orders.checkout",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="customer_order",
        resource_id=order.id,
        changes={"sale_order_id": str(sale.id)},
    )
    _observe("checked_out", order=order)
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
