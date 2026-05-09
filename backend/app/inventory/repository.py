from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.catalog.models import Product
from app.orders.models import InventoryMovement


def list_active_products(db: Session, *, tenant_id: UUID) -> list[Product]:
    return (
        db.query(Product)
        .filter(Product.tenant_id == tenant_id, Product.is_active.is_(True))
        .order_by(Product.name)
        .all()
    )


def get_product_for_update(db: Session, *, tenant_id: UUID, product_id: UUID) -> Product | None:
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


def stock_on_hand(db: Session, *, tenant_id: UUID, product_id: UUID) -> int:
    value = (
        db.query(func.coalesce(func.sum(InventoryMovement.quantity_delta), 0))
        .filter(
            InventoryMovement.tenant_id == tenant_id,
            InventoryMovement.product_id == product_id,
        )
        .scalar()
    )
    return int(value or 0)


def create_movement(
    db: Session,
    *,
    tenant_id: UUID,
    product_id: UUID,
    user_id: UUID,
    movement_type: str,
    quantity_delta: int,
    reason: str,
) -> InventoryMovement:
    movement = InventoryMovement(
        tenant_id=tenant_id,
        product_id=product_id,
        order_id=None,
        movement_type=movement_type,
        quantity_delta=quantity_delta,
        reason=reason,
        created_by_user_id=user_id,
    )
    db.add(movement)
    db.flush()
    return movement
