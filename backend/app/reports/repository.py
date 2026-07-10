"""Pure read queries that power reports/service.py.

The service layer is responsible for timezone normalization, aggregation,
and storytelling. This module only knows how to fetch rows.
"""
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.models import User
from app.business_settings.models import BusinessProfile
from app.catalog.models import Product
from app.orders.models import InventoryMovement, Order, OrderItem, Payment, Refund, RefundItem, Void

# Sale time = client ring-time when present, else server INSERT time. Reports
# bucket by when a sale actually happened, so a sale rung at 23:50 and synced
# after midnight reports on the ring-time day. Backfilled/online rows have
# occurred_at == created_at, so historical report totals are unchanged.
_SALE_TIME = func.coalesce(Order.occurred_at, Order.created_at)


def get_business_profile(db: Session, *, tenant_id: UUID) -> BusinessProfile | None:
    return db.get(BusinessProfile, tenant_id)


def completed_orders_between(
    db: Session, *, tenant_id: UUID, start: datetime, end: datetime
) -> list[Order]:
    return (
        db.query(Order)
        .filter(
            Order.tenant_id == tenant_id,
            Order.status == "completed",
            _SALE_TIME >= start,
            _SALE_TIME <= end,
        )
        .all()
    )


def void_count_between(
    db: Session, *, tenant_id: UUID, start: datetime, end: datetime
) -> int:
    return (
        db.query(Void)
        .filter(
            Void.tenant_id == tenant_id,
            Void.created_at >= start,
            Void.created_at <= end,
        )
        .count()
    )


def refunds_for_orders(
    db: Session, *, tenant_id: UUID, order_ids: list[UUID]
) -> list[Refund]:
    if not order_ids:
        return []
    return (
        db.query(Refund)
        .filter(Refund.tenant_id == tenant_id, Refund.order_id.in_(order_ids))
        .all()
    )


def payments_for_orders(
    db: Session, *, tenant_id: UUID, order_ids: list[UUID]
) -> list[Payment]:
    if not order_ids:
        return []
    return (
        db.query(Payment)
        .filter(Payment.tenant_id == tenant_id, Payment.order_id.in_(order_ids))
        .all()
    )


def refunds_by_method_for_orders(
    db: Session, *, tenant_id: UUID, order_ids: list[UUID]
) -> dict[str, Decimal]:
    """Total refunded per payment method across a set of orders.

    Only refunds that recorded a refund_payment_method are attributed to a
    method; legacy refunds (method NULL) are excluded here and instead surface
    in the overall refund total so the top-level net still reconciles.
    """
    if not order_ids:
        return {}
    rows = (
        db.query(
            Refund.refund_payment_method,
            func.coalesce(func.sum(Refund.refunded_amount), 0).label("total"),
        )
        .filter(
            Refund.tenant_id == tenant_id,
            Refund.order_id.in_(order_ids),
            Refund.refund_payment_method.isnot(None),
        )
        .group_by(Refund.refund_payment_method)
        .all()
    )
    return {row.refund_payment_method: Decimal(row.total or 0) for row in rows}


def order_items_for_orders(
    db: Session, *, tenant_id: UUID, order_ids: list[UUID]
) -> list[OrderItem]:
    if not order_ids:
        return []
    return (
        db.query(OrderItem)
        .filter(OrderItem.tenant_id == tenant_id, OrderItem.order_id.in_(order_ids))
        .all()
    )


def refund_items_for_orders(
    db: Session, *, tenant_id: UUID, order_ids: list[UUID]
) -> list:
    if not order_ids:
        return []
    return (
        db.query(
            RefundItem.order_item_id.label("order_item_id"),
            func.coalesce(func.sum(RefundItem.quantity), 0).label("quantity"),
            func.coalesce(func.sum(RefundItem.line_total_amount), Decimal("0.00")).label(
                "line_total_amount"
            ),
        )
        .join(Refund, Refund.id == RefundItem.refund_id)
        .filter(
            Refund.tenant_id == tenant_id,
            Refund.order_id.in_(order_ids),
        )
        .group_by(RefundItem.order_item_id)
        .all()
    )


def refunds_in_window(
    db: Session, *, tenant_id: UUID, start: datetime, end: datetime
) -> list:
    """Aggregated refund rows grouped by reason."""
    return (
        db.query(
            Refund.reason.label("reason"),
            func.count(Refund.id).label("refund_count"),
            func.coalesce(func.sum(Refund.refunded_amount), Decimal("0.00")).label(
                "refunded_amount"
            ),
        )
        .filter(
            Refund.tenant_id == tenant_id,
            Refund.created_at >= start,
            Refund.created_at <= end,
        )
        .group_by(Refund.reason)
        .order_by(func.sum(Refund.refunded_amount).desc())
        .all()
    )


def sales_by_employee_rows(
    db: Session, *, tenant_id: UUID, start: datetime, end: datetime
) -> list:
    """Per-user net sales rollup. Uses a subquery to fold refunds into Order rows."""
    refunds_by_order = (
        db.query(
            Refund.order_id.label("order_id"),
            func.coalesce(func.sum(Refund.refunded_amount), Decimal("0.00")).label(
                "refund_total"
            ),
            func.count(Refund.id).label("refund_count"),
        )
        .filter(Refund.tenant_id == tenant_id)
        .group_by(Refund.order_id)
        .subquery()
    )
    return (
        db.query(
            Order.created_by_user_id.label("user_id"),
            User.email.label("email"),
            func.count(Order.id).label("order_count"),
            func.coalesce(
                func.sum(
                    Order.total_amount
                    - func.coalesce(refunds_by_order.c.refund_total, Decimal("0.00"))
                ),
                Decimal("0.00"),
            ).label("net_sales"),
            func.coalesce(func.sum(refunds_by_order.c.refund_count), 0).label("refund_count"),
        )
        .outerjoin(User, User.id == Order.created_by_user_id)
        .outerjoin(refunds_by_order, refunds_by_order.c.order_id == Order.id)
        .filter(
            Order.tenant_id == tenant_id,
            Order.status == "completed",
            _SALE_TIME >= start,
            _SALE_TIME <= end,
        )
        .group_by(Order.created_by_user_id, User.email)
        .order_by(func.sum(Order.total_amount).desc())
        .all()
    )


def product_units_in_window(
    db: Session, *, tenant_id: UUID, start: datetime, end: datetime
) -> list:
    return (
        db.query(
            OrderItem.product_id.label("product_id"),
            OrderItem.product_name.label("product_name"),
            func.coalesce(func.sum(OrderItem.quantity), 0).label("units"),
            func.coalesce(func.sum(OrderItem.line_total_amount), Decimal("0.00")).label("gross"),
        )
        .join(Order, Order.id == OrderItem.order_id)
        .filter(
            Order.tenant_id == tenant_id,
            Order.status == "completed",
            _SALE_TIME >= start,
            _SALE_TIME <= end,
        )
        .group_by(OrderItem.product_id, OrderItem.product_name)
        .all()
    )


def inventory_sales_since(
    db: Session, *, tenant_id: UUID, since: datetime
) -> list:
    return (
        db.query(
            InventoryMovement.product_id,
            func.coalesce(func.sum(InventoryMovement.quantity_delta), 0).label("units"),
        )
        .filter(
            InventoryMovement.tenant_id == tenant_id,
            InventoryMovement.movement_type == "sale",
            InventoryMovement.created_at >= since,
        )
        .group_by(InventoryMovement.product_id)
        .all()
    )


def tracked_products(db: Session, *, tenant_id: UUID) -> list[Product]:
    return (
        db.query(Product)
        .filter(
            Product.tenant_id == tenant_id,
            Product.is_active.is_(True),
            Product.track_inventory.is_(True),
        )
        .all()
    )
