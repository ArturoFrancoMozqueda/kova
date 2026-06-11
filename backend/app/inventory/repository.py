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


def stock_on_hand_for_products(
    db: Session, *, tenant_id: UUID, product_ids: list[UUID]
) -> dict[UUID, int]:
    """Batch stock-on-hand for many products in a single grouped query.

    Avoids the N+1 of calling stock_on_hand per product when listing stock or
    computing velocity. Products with no movements default to 0.
    """
    result: dict[UUID, int] = {pid: 0 for pid in product_ids}
    if not product_ids:
        return result
    rows = (
        db.query(
            InventoryMovement.product_id,
            func.coalesce(func.sum(InventoryMovement.quantity_delta), 0).label("qty"),
        )
        .filter(
            InventoryMovement.tenant_id == tenant_id,
            InventoryMovement.product_id.in_(product_ids),
        )
        .group_by(InventoryMovement.product_id)
        .all()
    )
    for row in rows:
        result[row.product_id] = int(row.qty or 0)
    return result


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
    # Compute and store stock_on_hand_after so movement history is accurate
    movement.stock_on_hand_after = stock_on_hand(
        db, tenant_id=tenant_id, product_id=product_id
    )
    db.flush()
    return movement


def list_movements(
    db: Session,
    *,
    tenant_id: UUID,
    product_id: UUID,
    limit: int = 20,
    offset: int = 0,
) -> list[InventoryMovement]:
    return (
        db.query(InventoryMovement)
        .filter(
            InventoryMovement.tenant_id == tenant_id,
            InventoryMovement.product_id == product_id,
        )
        .order_by(InventoryMovement.created_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )


def count_movements(
    db: Session,
    *,
    tenant_id: UUID,
    product_id: UUID,
) -> int:
    return (
        db.query(InventoryMovement)
        .filter(
            InventoryMovement.tenant_id == tenant_id,
            InventoryMovement.product_id == product_id,
        )
        .count()
    )
