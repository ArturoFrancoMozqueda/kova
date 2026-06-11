import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.catalog.models import Product
from app.orders.models import InventoryMovement, Order, OrderItem, Payment, Refund, RefundItem, Void


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
    client_uuid: UUID | None = None,
    shift_id: UUID | None = None,
) -> Order:
    order = Order(
        tenant_id=tenant_id,
        client_uuid=client_uuid,
        shift_id=shift_id,
        created_by_user_id=user_id,
        status="completed",
        subtotal_amount=subtotal_amount,
        total_amount=total_amount,
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
) -> OrderItem:
    item = OrderItem(
        tenant_id=tenant_id,
        order_id=order_id,
        product_id=product.id,
        product_name=product.name,
        quantity=quantity,
        unit_price_amount=(
            unit_price_amount if unit_price_amount is not None else product.price_amount
        ),
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
) -> InventoryMovement:
    movement = InventoryMovement(
        tenant_id=tenant_id,
        product_id=product_id,
        order_id=order_id,
        movement_type=movement_type,
        quantity_delta=quantity_delta,
        reason=reason,
        created_by_user_id=user_id,
    )
    db.add(movement)
    db.flush()
    return movement


def _apply_order_filters(
    query,
    *,
    status: str | None = None,
    start_date: datetime.date | None = None,
    end_date: datetime.date | None = None,
):
    if status:
        query = query.filter(Order.status == status)
    if start_date:
        query = query.filter(
            Order.created_at >= datetime.datetime.combine(start_date, datetime.time.min)
        )
    if end_date:
        query = query.filter(
            Order.created_at < datetime.datetime.combine(
                end_date + datetime.timedelta(days=1), datetime.time.min
            )
        )
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
    query = db.query(Order).filter(Order.tenant_id == tenant_id)
    query = _apply_order_filters(query, status=status, start_date=start_date, end_date=end_date)
    return query.order_by(Order.created_at.desc()).limit(limit).offset(offset).all()


def count_orders_by_tenant(
    db: Session,
    *,
    tenant_id: UUID,
    status: str | None = None,
    start_date: datetime.date | None = None,
    end_date: datetime.date | None = None,
) -> int:
    query = db.query(Order).filter(Order.tenant_id == tenant_id)
    query = _apply_order_filters(query, status=status, start_date=start_date, end_date=end_date)
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


def create_refund(
    db: Session,
    *,
    tenant_id: UUID,
    order_id: UUID,
    user_id: UUID,
    reason: str,
    refunded_amount: Decimal,
) -> Refund:
    refund = Refund(
        order_id=order_id,
        tenant_id=tenant_id,
        created_by_user_id=user_id,
        reason=reason,
        refunded_amount=refunded_amount,
    )
    db.add(refund)
    db.flush()
    return refund


def create_refund_item(
    db: Session,
    *,
    refund_id: UUID,
    order_item_id: UUID,
    quantity: int,
    unit_price_amount: Decimal,
    line_total_amount: Decimal,
) -> RefundItem:
    item = RefundItem(
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
