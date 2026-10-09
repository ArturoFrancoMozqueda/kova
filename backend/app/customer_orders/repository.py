from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session

from app.customer_orders.models import (
    CustomerOrder,
    CustomerOrderItem,
    CustomerOrderItemModifier,
    InventoryReservation,
)
from app.orders.models import Order, Refund


def payment_status_expression():
    refund_totals = func.coalesce(func.sum(Refund.refunded_amount), 0)
    return case(
        (CustomerOrder.sale_order_id.is_(None), "unpaid"),
        (Order.status == "voided", "voided"),
        (refund_totals >= CustomerOrder.total_amount, "refunded"),
        (refund_totals > 0, "partially_refunded"),
        else_="paid",
    )


def _base_list_query(db: Session, *, tenant_id: UUID):
    payment_status = payment_status_expression().label("payment_status")
    return (
        db.query(CustomerOrder, payment_status)
        .outerjoin(Order, Order.id == CustomerOrder.sale_order_id)
        .outerjoin(Refund, Refund.order_id == CustomerOrder.sale_order_id)
        .filter(CustomerOrder.tenant_id == tenant_id)
        .group_by(CustomerOrder.id, Order.status)
    )


def _apply_filters(
    query,
    *,
    search: str | None,
    status: str | None,
    payment_status: str | None,
    fulfillment_type: str | None,
    promised_from: datetime | None,
    promised_to: datetime | None,
):
    if search:
        pattern = (
            "%" + search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        )
        query = query.filter(
            or_(
                CustomerOrder.folio.ilike(pattern, escape="\\"),
                CustomerOrder.customer_name.ilike(pattern, escape="\\"),
                CustomerOrder.customer_phone.ilike(pattern, escape="\\"),
            )
        )
    if status:
        query = query.filter(CustomerOrder.status == status)
    if payment_status:
        query = query.having(payment_status_expression() == payment_status)
    if fulfillment_type:
        query = query.filter(CustomerOrder.fulfillment_type == fulfillment_type)
    if promised_from:
        query = query.filter(CustomerOrder.promised_at >= promised_from)
    if promised_to:
        query = query.filter(CustomerOrder.promised_at <= promised_to)
    return query


def list_orders(
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
) -> list[tuple[CustomerOrder, str]]:
    query = _apply_filters(
        _base_list_query(db, tenant_id=tenant_id),
        search=search,
        status=status,
        payment_status=payment_status,
        fulfillment_type=fulfillment_type,
        promised_from=promised_from,
        promised_to=promised_to,
    )
    return query.order_by(CustomerOrder.created_at.desc()).limit(limit).offset(offset).all()


def count_orders(
    db: Session,
    *,
    tenant_id: UUID,
    search: str | None = None,
    status: str | None = None,
    payment_status: str | None = None,
    fulfillment_type: str | None = None,
    promised_from: datetime | None = None,
    promised_to: datetime | None = None,
) -> int:
    query = _apply_filters(
        _base_list_query(db, tenant_id=tenant_id),
        search=search,
        status=status,
        payment_status=payment_status,
        fulfillment_type=fulfillment_type,
        promised_from=promised_from,
        promised_to=promised_to,
    )
    return query.count()


def status_counts(db: Session, *, tenant_id: UUID) -> dict[str, int]:
    rows = (
        db.query(CustomerOrder.status, func.count(CustomerOrder.id))
        .filter(CustomerOrder.tenant_id == tenant_id)
        .group_by(CustomerOrder.status)
        .all()
    )
    return {status: int(count) for status, count in rows}


def get_order(db: Session, *, tenant_id: UUID, order_id: UUID) -> CustomerOrder | None:
    return (
        db.query(CustomerOrder)
        .filter(CustomerOrder.tenant_id == tenant_id, CustomerOrder.id == order_id)
        .first()
    )


def get_order_for_update(db: Session, *, tenant_id: UUID, order_id: UUID) -> CustomerOrder | None:
    return (
        db.query(CustomerOrder)
        .filter(CustomerOrder.tenant_id == tenant_id, CustomerOrder.id == order_id)
        .with_for_update()
        .first()
    )


def get_by_folio(db: Session, *, tenant_id: UUID, folio: str) -> CustomerOrder | None:
    return (
        db.query(CustomerOrder)
        .filter(CustomerOrder.tenant_id == tenant_id, CustomerOrder.folio == folio)
        .first()
    )


def list_items(db: Session, *, tenant_id: UUID, order_id: UUID) -> list[CustomerOrderItem]:
    return (
        db.query(CustomerOrderItem)
        .filter(
            CustomerOrderItem.tenant_id == tenant_id,
            CustomerOrderItem.customer_order_id == order_id,
        )
        .order_by(CustomerOrderItem.id)
        .all()
    )


def list_item_modifiers(
    db: Session, *, tenant_id: UUID, item_id: UUID
) -> list[CustomerOrderItemModifier]:
    return (
        db.query(CustomerOrderItemModifier)
        .filter(
            CustomerOrderItemModifier.tenant_id == tenant_id,
            CustomerOrderItemModifier.customer_order_item_id == item_id,
        )
        .order_by(CustomerOrderItemModifier.id)
        .all()
    )


def item_modifiers_for_items(
    db: Session, *, tenant_id: UUID, item_ids: list[UUID]
) -> dict[UUID, list[CustomerOrderItemModifier]]:
    result: dict[UUID, list[CustomerOrderItemModifier]] = {
        item_id: [] for item_id in item_ids
    }
    if not item_ids:
        return result
    rows = (
        db.query(CustomerOrderItemModifier)
        .filter(
            CustomerOrderItemModifier.tenant_id == tenant_id,
            CustomerOrderItemModifier.customer_order_item_id.in_(item_ids),
        )
        .order_by(
            CustomerOrderItemModifier.customer_order_item_id,
            CustomerOrderItemModifier.id,
        )
        .all()
    )
    for row in rows:
        result[row.customer_order_item_id].append(row)
    return result


def delete_items(db: Session, *, tenant_id: UUID, order_id: UUID) -> None:
    item_ids = [item.id for item in list_items(db, tenant_id=tenant_id, order_id=order_id)]
    if item_ids:
        db.query(CustomerOrderItemModifier).filter(
            CustomerOrderItemModifier.tenant_id == tenant_id,
            CustomerOrderItemModifier.customer_order_item_id.in_(item_ids),
        ).delete(synchronize_session=False)
    db.query(CustomerOrderItem).filter(
        CustomerOrderItem.tenant_id == tenant_id,
        CustomerOrderItem.customer_order_id == order_id,
    ).delete(synchronize_session=False)


def active_reserved_quantity(
    db: Session, *, tenant_id: UUID, product_id: UUID, excluding_order_id: UUID | None = None
) -> int:
    query = db.query(func.coalesce(func.sum(InventoryReservation.quantity), 0)).filter(
        InventoryReservation.tenant_id == tenant_id,
        InventoryReservation.product_id == product_id,
        InventoryReservation.status == "active",
    )
    if excluding_order_id:
        query = query.filter(InventoryReservation.customer_order_id != excluding_order_id)
    return int(query.scalar() or 0)


def active_reserved_for_products(
    db: Session,
    *,
    tenant_id: UUID,
    product_ids: list[UUID],
    excluding_order_id: UUID | None = None,
) -> dict[UUID, int]:
    if not product_ids:
        return {}
    query = db.query(
        InventoryReservation.product_id, func.sum(InventoryReservation.quantity)
    ).filter(
        InventoryReservation.tenant_id == tenant_id,
        InventoryReservation.product_id.in_(product_ids),
        InventoryReservation.status == "active",
    )
    if excluding_order_id:
        query = query.filter(
            InventoryReservation.customer_order_id != excluding_order_id
        )
    rows = query.group_by(InventoryReservation.product_id).all()
    return {product_id: int(quantity or 0) for product_id, quantity in rows}


def list_reservations(
    db: Session, *, tenant_id: UUID, order_id: UUID
) -> list[InventoryReservation]:
    return (
        db.query(InventoryReservation)
        .filter(
            InventoryReservation.tenant_id == tenant_id,
            InventoryReservation.customer_order_id == order_id,
        )
        .order_by(InventoryReservation.product_id)
        .all()
    )


def active_reservations_for_orders(
    db: Session, *, tenant_id: UUID, order_ids: list[UUID]
) -> list[InventoryReservation]:
    if not order_ids:
        return []
    return (
        db.query(InventoryReservation)
        .filter(
            InventoryReservation.tenant_id == tenant_id,
            InventoryReservation.customer_order_id.in_(order_ids),
            InventoryReservation.status == "active",
        )
        .order_by(
            InventoryReservation.customer_order_id,
            InventoryReservation.product_id,
        )
        .all()
    )


def list_reservations_for_update(
    db: Session, *, tenant_id: UUID, order_id: UUID
) -> list[InventoryReservation]:
    return (
        db.query(InventoryReservation)
        .filter(
            InventoryReservation.tenant_id == tenant_id,
            InventoryReservation.customer_order_id == order_id,
        )
        .order_by(InventoryReservation.product_id)
        .with_for_update()
        .all()
    )


def payment_status(db: Session, *, order: CustomerOrder) -> str:
    if not order.sale_order_id:
        return "unpaid"
    sale = (
        db.query(Order)
        .filter(Order.tenant_id == order.tenant_id, Order.id == order.sale_order_id)
        .first()
    )
    if not sale:
        return "unpaid"
    if sale.status == "voided":
        return "voided"
    refunded = (
        db.query(func.coalesce(func.sum(Refund.refunded_amount), 0))
        .filter(
            Refund.tenant_id == order.tenant_id,
            Refund.order_id == sale.id,
        )
        .scalar()
    )
    amount = Decimal(refunded or 0)
    if amount >= order.total_amount:
        return "refunded"
    if amount > 0:
        return "partially_refunded"
    return "paid"
