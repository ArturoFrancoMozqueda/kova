from collections import defaultdict
from datetime import UTC, date, datetime, time
from decimal import Decimal
from uuid import UUID

from sqlalchemy.orm import Session

from app.orders.models import Order, OrderItem, Payment, Refund, Void
from app.pricing import calculator
from app.shared.exceptions import bad_request


def _default_range() -> tuple[date, date]:
    today = datetime.now(UTC).date()
    return today, today


def _normalize_range(start_date: date | None, end_date: date | None) -> tuple[date, date]:
    if start_date is None and end_date is None:
        start_date, end_date = _default_range()
    elif start_date is None:
        start_date = end_date
    elif end_date is None:
        end_date = start_date

    assert start_date is not None
    assert end_date is not None
    if end_date < start_date:
        raise bad_request("End date must be on or after start date")
    return start_date, end_date


def _bounds(start_date: date, end_date: date) -> tuple[datetime, datetime]:
    start = datetime.combine(start_date, time.min, tzinfo=UTC)
    end = datetime.combine(end_date, time.max, tzinfo=UTC)
    return start, end


def _completed_orders(
    db: Session, *, tenant_id: UUID, start_date: date, end_date: date
) -> list[Order]:
    start, end = _bounds(start_date, end_date)
    return (
        db.query(Order)
        .filter(
            Order.tenant_id == tenant_id,
            Order.status == "completed",
            Order.created_at >= start,
            Order.created_at <= end,
        )
        .all()
    )


def _void_count(db: Session, *, tenant_id: UUID, start_date: date, end_date: date) -> int:
    start, end = _bounds(start_date, end_date)
    return (
        db.query(Void)
        .filter(
            Void.tenant_id == tenant_id,
            Void.created_at >= start,
            Void.created_at <= end,
        )
        .count()
    )


def sales_summary(
    db: Session, *, tenant_id: UUID, start_date: date | None, end_date: date | None
) -> dict:
    start_date, end_date = _normalize_range(start_date, end_date)
    orders = _completed_orders(db, tenant_id=tenant_id, start_date=start_date, end_date=end_date)
    order_ids = [order.id for order in orders]
    gross_sales = calculator.money(sum((order.total_amount for order in orders), Decimal("0.00")))

    refunds = []
    if order_ids:
        refunds = (
            db.query(Refund)
            .filter(Refund.tenant_id == tenant_id, Refund.order_id.in_(order_ids))
            .all()
        )
    refund_total = calculator.money(
        sum((refund.refunded_amount for refund in refunds), Decimal("0.00"))
    )
    return {
        "start_date": start_date,
        "end_date": end_date,
        "gross_sales": gross_sales,
        "refund_total": refund_total,
        "net_sales": calculator.money(gross_sales - refund_total),
        "order_count": len(orders),
        "refund_count": len(refunds),
        "void_count": _void_count(
            db, tenant_id=tenant_id, start_date=start_date, end_date=end_date
        ),
    }


def payment_breakdown(
    db: Session, *, tenant_id: UUID, start_date: date | None, end_date: date | None
) -> dict:
    start_date, end_date = _normalize_range(start_date, end_date)
    orders = _completed_orders(db, tenant_id=tenant_id, start_date=start_date, end_date=end_date)
    order_ids = [order.id for order in orders]
    totals: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    counts: dict[str, int] = defaultdict(int)

    if order_ids:
        payments = (
            db.query(Payment)
            .filter(Payment.tenant_id == tenant_id, Payment.order_id.in_(order_ids))
            .all()
        )
        for payment in payments:
            totals[payment.method] = calculator.money(
                totals[payment.method] + payment.amount_amount
            )
            counts[payment.method] += 1

    return {
        "start_date": start_date,
        "end_date": end_date,
        "payments": [
            {
                "method": method,
                "amount": totals[method],
                "payment_count": counts[method],
            }
            for method in sorted(totals)
        ],
    }


def top_products(
    db: Session,
    *,
    tenant_id: UUID,
    start_date: date | None,
    end_date: date | None,
    limit: int,
) -> dict:
    start_date, end_date = _normalize_range(start_date, end_date)
    if limit < 1 or limit > 50:
        raise bad_request("Limit must be between 1 and 50")
    orders = _completed_orders(db, tenant_id=tenant_id, start_date=start_date, end_date=end_date)
    order_ids = [order.id for order in orders]
    product_totals: dict[UUID, dict] = {}

    if order_ids:
        items = (
            db.query(OrderItem)
            .filter(OrderItem.tenant_id == tenant_id, OrderItem.order_id.in_(order_ids))
            .all()
        )
        for item in items:
            row = product_totals.setdefault(
                item.product_id,
                {
                    "product_id": item.product_id,
                    "product_name": item.product_name,
                    "quantity_sold": 0,
                    "gross_sales": Decimal("0.00"),
                },
            )
            row["quantity_sold"] += item.quantity
            row["gross_sales"] = calculator.money(row["gross_sales"] + item.line_total_amount)

    products = sorted(
        product_totals.values(),
        key=lambda row: (row["quantity_sold"], row["gross_sales"]),
        reverse=True,
    )[:limit]
    return {"start_date": start_date, "end_date": end_date, "products": products}
