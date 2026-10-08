import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.catalog.models import Product
from app.modifiers.models import OrderItemModifier
from app.orders.models import (
    InventoryMovement,
    Order,
    OrderItem,
    Payment,
    Refund,
    RefundItem,
    Void,
)
from app.shared.timezone import tenant_timezone

# Sale time for filtering/sorting: the client ring-time when present, else the
# server INSERT time. Backfilled rows and online sales have occurred_at ==
# created_at, so this is a no-op for them and only re-buckets late-synced
# offline sales to the day they were actually rung.
_SALE_TIME = func.coalesce(Order.occurred_at, Order.created_at)


def get_active_product_for_update(
    db: Session, *, tenant_id: UUID, product_id: UUID
) -> Product | None:
    return (
        db.query(Product)
        .filter(
            Product.tenant_id == tenant_id,
            Product.id == product_id,
            Product.is_active.is_(True),
        )
        .with_for_update()
        .first()
    )


def create_order(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    subtotal_amount: Decimal,
    total_amount: Decimal,
    discount_amount: Decimal = Decimal("0.00"),
    tax_rate: Decimal = Decimal("0.00"),
    tax_amount: Decimal = Decimal("0.00"),
    customer_id: UUID | None = None,
    client_uuid: UUID | None = None,
    shift_id: UUID | None = None,
    occurred_at: datetime.datetime | None = None,
) -> Order:
    order = Order(
        tenant_id=tenant_id,
        client_uuid=client_uuid,
        shift_id=shift_id,
        created_by_user_id=user_id,
        status="completed",
        subtotal_amount=subtotal_amount,
        total_amount=total_amount,
        discount_amount=discount_amount,
        tax_rate=tax_rate,
        tax_amount=tax_amount,
        customer_id=customer_id,
        occurred_at=occurred_at,
    )
    db.add(order)
    db.flush()
    return order


def cash_sales_total_for_shift(
    db: Session, *, tenant_id: UUID, shift_id: UUID
) -> Decimal:
    """Sum of cash payments for completed orders rung in this shift.

    Voided orders drop out automatically (status != "completed"), so a void
    within the shift lowers expected cash without a separate reversal entry.
    Only the cash portion of split payments is counted.
    """
    value = (
        db.query(func.coalesce(func.sum(Payment.amount_amount), 0))
        .join(Order, Order.id == Payment.order_id)
        .filter(
            Order.tenant_id == tenant_id,
            Order.shift_id == shift_id,
            Order.status == "completed",
            Payment.method == "cash",
        )
        .scalar()
    )
    return Decimal(value or 0)


def create_order_item(
    db: Session,
    *,
    tenant_id: UUID,
    order_id: UUID,
    product: Product,
    quantity: int,
    line_total_amount: Decimal,
    unit_price_amount: Decimal | None = None,
    product_name: str | None = None,
    discount_amount: Decimal = Decimal("0.00"),
    tax_amount: Decimal = Decimal("0.00"),
) -> OrderItem:
    item = OrderItem(
        tenant_id=tenant_id,
        order_id=order_id,
        product_id=product.id,
        product_name=product_name if product_name is not None else product.name,
        quantity=quantity,
        unit_price_amount=(
            unit_price_amount if unit_price_amount is not None else product.price_amount
        ),
        unit_cost=product.cost_price,
        lot_tracked=product.track_lots,
        discount_amount=discount_amount,
        tax_amount=tax_amount,
        line_total_amount=line_total_amount,
    )
    db.add(item)
    db.flush()
    return item


def create_payment(
    db: Session,
    *,
    tenant_id: UUID,
    order_id: UUID,
    method: str,
    amount: Decimal,
    amount_tendered: Decimal | None,
    change_due: Decimal,
    reference: str | None,
) -> Payment:
    payment = Payment(
        tenant_id=tenant_id,
        order_id=order_id,
        method=method,
        amount_amount=amount,
        amount_tendered_amount=amount_tendered,
        change_due_amount=change_due,
        reference=reference,
    )
    db.add(payment)
    db.flush()
    return payment


def create_inventory_movement(
    db: Session,
    *,
    tenant_id: UUID,
    product_id: UUID,
    order_id: UUID,
    quantity_delta: int,
    movement_type: str = "sale",
    reason: str | None = None,
    user_id: UUID | None = None,
    lot_tracked: bool = False,
    order_item_id: UUID | None = None,
) -> InventoryMovement:
    movement = InventoryMovement(
        tenant_id=tenant_id,
        product_id=product_id,
        order_id=order_id,
        movement_type=movement_type,
        order_item_id=order_item_id,
        lot_tracked=lot_tracked,
        quantity_delta=quantity_delta,
        reason=reason,
        created_by_user_id=user_id,
    )
    db.add(movement)
    db.flush()
    return movement


def restorable_inventory_quantity(
    db: Session,
    *,
    tenant_id: UUID,
    order_id: UUID,
    product_id: UUID,
) -> int:
    """Return sale inventory still eligible to be restored for one product.

    Order-linked ``sale`` movements are the historical source of truth: a
    negative delta records inventory consumed at checkout and positive deltas
    record later refund/void reversals. This remains correct if the product's
    current ``track_inventory`` flag differs from its value at sale time.
    """
    net_sale_delta = (
        db.query(func.coalesce(func.sum(InventoryMovement.quantity_delta), 0))
        .filter(
            InventoryMovement.tenant_id == tenant_id,
            InventoryMovement.order_id == order_id,
            InventoryMovement.product_id == product_id,
            InventoryMovement.movement_type == "sale",
        )
        .scalar()
    )
    return max(0, -int(net_sale_delta or 0))


def _resolve_bounds(
    db: Session,
    *,
    tenant_id: UUID,
    start_date: datetime.date | None,
    end_date: datetime.date | None,
) -> tuple[datetime.datetime | None, datetime.datetime | None]:
    """Turn calendar dates into tz-aware UTC bounds in the tenant's timezone.

    The old code combined dates with time.min naively, so a filter for a local
    day silently used UTC midnight — off by the tenant's UTC offset (6h for
    America/Mexico_City). Bounding in the tenant tz matches the reports module.
    """
    if start_date is None and end_date is None:
        return None, None
    tz = tenant_timezone(db, tenant_id=tenant_id)
    start = end = None
    if start_date is not None:
        start = datetime.datetime.combine(
            start_date, datetime.time.min, tzinfo=tz
        ).astimezone(datetime.UTC)
    if end_date is not None:
        end = datetime.datetime.combine(
            end_date, datetime.time.max, tzinfo=tz
        ).astimezone(datetime.UTC)
    return start, end


def _apply_order_filters(
    query,
    *,
    status: str | None = None,
    start: datetime.datetime | None = None,
    end: datetime.datetime | None = None,
):
    if status:
        query = query.filter(Order.status == status)
    if start is not None:
        query = query.filter(_SALE_TIME >= start)
    if end is not None:
        query = query.filter(_SALE_TIME <= end)
    return query


def list_orders_by_tenant(
    db: Session,
    *,
    tenant_id: UUID,
    limit: int = 50,
    offset: int = 0,
    status: str | None = None,
    start_date: datetime.date | None = None,
    end_date: datetime.date | None = None,
) -> list[Order]:
    start, end = _resolve_bounds(
        db, tenant_id=tenant_id, start_date=start_date, end_date=end_date
    )
    query = db.query(Order).filter(Order.tenant_id == tenant_id)
    query = _apply_order_filters(query, status=status, start=start, end=end)
    return query.order_by(_SALE_TIME.desc()).limit(limit).offset(offset).all()


def count_orders_by_tenant(
    db: Session,
    *,
    tenant_id: UUID,
    status: str | None = None,
    start_date: datetime.date | None = None,
    end_date: datetime.date | None = None,
) -> int:
    start, end = _resolve_bounds(
        db, tenant_id=tenant_id, start_date=start_date, end_date=end_date
    )
    query = db.query(Order).filter(Order.tenant_id == tenant_id)
    query = _apply_order_filters(query, status=status, start=start, end=end)
    return query.count()


def get_order(db: Session, *, tenant_id: UUID, order_id: UUID) -> Order | None:
    return db.query(Order).filter(Order.tenant_id == tenant_id, Order.id == order_id).first()


def get_order_for_update(db: Session, *, tenant_id: UUID, order_id: UUID) -> Order | None:
    """Row-locked fetch so refund/void of the same order serialize.

    Without the lock, a concurrent refund and void can both pass their state
    checks and commit, leaving an order both refunded AND voided.
    """
    return (
        db.query(Order)
        .filter(Order.tenant_id == tenant_id, Order.id == order_id)
        .with_for_update()
        .first()
    )


def get_order_by_client_uuid(
    db: Session, *, tenant_id: UUID, client_uuid: UUID
) -> Order | None:
    return (
        db.query(Order)
        .filter(Order.tenant_id == tenant_id, Order.client_uuid == client_uuid)
        .first()
    )


def list_order_items(db: Session, *, tenant_id: UUID, order_id: UUID) -> list[OrderItem]:
    return (
        db.query(OrderItem)
        .filter(OrderItem.tenant_id == tenant_id, OrderItem.order_id == order_id)
        .order_by(OrderItem.id)
        .all()
    )


def get_payment(db: Session, *, tenant_id: UUID, order_id: UUID) -> Payment | None:
    return (
        db.query(Payment)
        .filter(Payment.tenant_id == tenant_id, Payment.order_id == order_id)
        .first()
    )


def list_payments(db: Session, *, tenant_id: UUID, order_id: UUID) -> list[Payment]:
    return (
        db.query(Payment)
        .filter(Payment.tenant_id == tenant_id, Payment.order_id == order_id)
        .order_by(Payment.id)
        .all()
    )


def order_item_modifiers_for_items(
    db: Session, *, tenant_id: UUID, item_ids: list[UUID]
) -> dict[UUID, list[OrderItemModifier]]:
    result: dict[UUID, list[OrderItemModifier]] = {item_id: [] for item_id in item_ids}
    if not item_ids:
        return result
    rows = (
        db.query(OrderItemModifier)
        .filter(
            OrderItemModifier.tenant_id == tenant_id,
            OrderItemModifier.order_item_id.in_(item_ids),
        )
        .order_by(OrderItemModifier.order_item_id, OrderItemModifier.id)
        .all()
    )
    for row in rows:
        result[row.order_item_id].append(row)
    return result


def create_refund(
    db: Session,
    *,
    tenant_id: UUID,
    order_id: UUID,
    user_id: UUID,
    reason: str,
    refunded_amount: Decimal,
    refund_payment_method: str | None = None,
) -> Refund:
    refund = Refund(
        order_id=order_id,
        tenant_id=tenant_id,
        created_by_user_id=user_id,
        reason=reason,
        refunded_amount=refunded_amount,
        refund_payment_method=refund_payment_method,
    )
    db.add(refund)
    db.flush()
    return refund


def collected_by_method(
    db: Session, *, tenant_id: UUID, order_id: UUID
) -> dict[str, Decimal]:
    """Total collected per payment method for an order (tenant-scoped)."""
    rows = (
        db.query(
            Payment.method,
            func.coalesce(func.sum(Payment.amount_amount), 0).label("total"),
        )
        .filter(Payment.tenant_id == tenant_id, Payment.order_id == order_id)
        .group_by(Payment.method)
        .all()
    )
    return {row.method: Decimal(row.total or 0) for row in rows}


def refunded_by_method(
    db: Session, *, tenant_id: UUID, order_id: UUID
) -> dict[str, Decimal]:
    """Total already refunded per method for an order (tenant-scoped).

    Only rows that recorded a refund_payment_method count toward a method's
    running total; legacy rows (method NULL) are excluded from the per-method
    ceiling check because their tender is unknown.
    """
    rows = (
        db.query(
            Refund.refund_payment_method,
            func.coalesce(func.sum(Refund.refunded_amount), 0).label("total"),
        )
        .filter(
            Refund.tenant_id == tenant_id,
            Refund.order_id == order_id,
            Refund.refund_payment_method.isnot(None),
        )
        .group_by(Refund.refund_payment_method)
        .all()
    )
    return {row.refund_payment_method: Decimal(row.total or 0) for row in rows}


def create_refund_item(
    db: Session,
    *,
    tenant_id: UUID,
    refund_id: UUID,
    order_item_id: UUID,
    quantity: int,
    unit_price_amount: Decimal,
    line_total_amount: Decimal,
) -> RefundItem:
    item = RefundItem(
        tenant_id=tenant_id,
        refund_id=refund_id,
        order_item_id=order_item_id,
        quantity=quantity,
        unit_price_amount=unit_price_amount,
        line_total_amount=line_total_amount,
    )
    db.add(item)
    db.flush()
    return item


def list_refunds(db: Session, *, tenant_id: UUID, order_id: UUID) -> list[Refund]:
    return (
        db.query(Refund)
        .filter(Refund.tenant_id == tenant_id, Refund.order_id == order_id)
        .order_by(Refund.created_at)
        .all()
    )


def get_refund(db: Session, *, tenant_id: UUID, refund_id: UUID) -> Refund | None:
    return db.query(Refund).filter(Refund.tenant_id == tenant_id, Refund.id == refund_id).first()


def list_refund_items(db: Session, *, refund_id: UUID) -> list[RefundItem]:
    return (
        db.query(RefundItem)
        .filter(RefundItem.refund_id == refund_id)
        .order_by(RefundItem.id)
        .all()
    )


def refund_items_for_refunds(
    db: Session, *, tenant_id: UUID, refund_ids: list[UUID]
) -> dict[UUID, list[RefundItem]]:
    result: dict[UUID, list[RefundItem]] = {
        refund_id: [] for refund_id in refund_ids
    }
    if not refund_ids:
        return result
    rows = (
        db.query(RefundItem)
        .join(
            Refund,
            (Refund.tenant_id == tenant_id) & (Refund.id == RefundItem.refund_id),
        )
        .filter(RefundItem.refund_id.in_(refund_ids))
        .order_by(RefundItem.refund_id, RefundItem.id)
        .all()
    )
    for row in rows:
        result[row.refund_id].append(row)
    return result


def get_void(db: Session, *, tenant_id: UUID, order_id: UUID) -> Void | None:
    return db.query(Void).filter(Void.tenant_id == tenant_id, Void.order_id == order_id).first()


def create_void(
    db: Session,
    *,
    tenant_id: UUID,
    order_id: UUID,
    user_id: UUID,
    reason: str,
) -> Void:
    void = Void(
        order_id=order_id,
        tenant_id=tenant_id,
        created_by_user_id=user_id,
        reason=reason,
    )
    db.add(void)
    db.flush()
    return void
