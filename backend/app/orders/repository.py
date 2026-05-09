from decimal import Decimal
from uuid import UUID

from sqlalchemy.orm import Session

from app.catalog.models import Product
from app.orders.models import InventoryMovement, Order, OrderItem, Payment


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
) -> Order:
    order = Order(
        tenant_id=tenant_id,
        created_by_user_id=user_id,
        status="completed",
        subtotal_amount=subtotal_amount,
        total_amount=total_amount,
    )
    db.add(order)
    db.flush()
    return order


def create_order_item(
    db: Session,
    *,
    tenant_id: UUID,
    order_id: UUID,
    product: Product,
    quantity: int,
    line_total_amount: Decimal,
) -> OrderItem:
    item = OrderItem(
        tenant_id=tenant_id,
        order_id=order_id,
        product_id=product.id,
        product_name=product.name,
        quantity=quantity,
        unit_price_amount=product.price_amount,
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
) -> InventoryMovement:
    movement = InventoryMovement(
        tenant_id=tenant_id,
        product_id=product_id,
        order_id=order_id,
        movement_type="sale",
        quantity_delta=quantity_delta,
    )
    db.add(movement)
    db.flush()
    return movement


def get_order(db: Session, *, tenant_id: UUID, order_id: UUID) -> Order | None:
    return db.query(Order).filter(Order.tenant_id == tenant_id, Order.id == order_id).first()


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
