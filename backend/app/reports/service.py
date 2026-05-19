from collections import defaultdict
from datetime import UTC, date, datetime, time
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import Integer, cast, func
from sqlalchemy.orm import Session

from app.auth.models import User
from app.business_settings.models import BusinessProfile
from app.orders.models import Order, OrderItem, Payment, Refund, Void
from app.pricing import calculator
from app.shared.exceptions import bad_request

DAYPARTS = (
    {"key": "madrugada", "label": "Madrugada", "start_hour": 0, "end_hour": 5},
    {"key": "manana", "label": "Mañana", "start_hour": 6, "end_hour": 11},
    {"key": "tarde", "label": "Tarde", "start_hour": 12, "end_hour": 17},
    {"key": "noche", "label": "Noche", "start_hour": 18, "end_hour": 23},
)


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


def _tenant_timezone(db: Session, *, tenant_id: UUID) -> ZoneInfo:
    profile = db.get(BusinessProfile, tenant_id)
    timezone_name = profile.timezone if profile else "America/Mexico_City"
    try:
        return ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        return ZoneInfo("America/Mexico_City")


def _timezone_name(tz: ZoneInfo) -> str:
    return str(tz)


def _local_bounds(start_date: date, end_date: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    local_start = datetime.combine(start_date, time.min, tzinfo=tz)
    local_end = datetime.combine(end_date, time.max, tzinfo=tz)
    return local_start.astimezone(UTC), local_end.astimezone(UTC)


def _completed_orders_between(
    db: Session, *, tenant_id: UUID, start: datetime, end: datetime
) -> list[Order]:
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


def _money(value: Decimal | int | float | str) -> Decimal:
    return calculator.money(Decimal(str(value)))


def _pct(value: Decimal, total: Decimal) -> int:
    if total <= Decimal("0.00"):
        return 0
    return int(((value / total) * Decimal("100")).quantize(Decimal("1")))


def _average_ticket(net_sales: Decimal, order_count: int) -> Decimal:
    if order_count <= 0:
        return Decimal("0.00")
    return calculator.money(net_sales / Decimal(order_count))


def _daypart_for_hour(hour: int) -> dict:
    for daypart in DAYPARTS:
        if daypart["start_hour"] <= hour <= daypart["end_hour"]:
            return daypart
    return DAYPARTS[0]


def _hour_label(hour: int) -> str:
    next_hour = (hour + 1) % 24
    return f"{hour:02d}:00-{next_hour:02d}:00"


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


def _refunds_by_order_subquery(db: Session, *, tenant_id: UUID):
    return (
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


def sales_by_hour(
    db: Session, *, tenant_id: UUID, start_date: date | None, end_date: date | None
) -> list[dict]:
    start_date, end_date = _normalize_range(start_date, end_date)
    start, end = _bounds(start_date, end_date)
    refunds_by_order = _refunds_by_order_subquery(db, tenant_id=tenant_id)
    hour_expr = cast(func.extract("hour", Order.created_at), Integer)

    rows = (
        db.query(
            hour_expr.label("hour"),
            func.coalesce(
                func.sum(
                    Order.total_amount
                    - func.coalesce(refunds_by_order.c.refund_total, Decimal("0.00"))
                ),
                Decimal("0.00"),
            ).label("net_sales"),
            func.count(Order.id).label("order_count"),
        )
        .outerjoin(refunds_by_order, refunds_by_order.c.order_id == Order.id)
        .filter(
            Order.tenant_id == tenant_id,
            Order.status == "completed",
            Order.created_at >= start,
            Order.created_at <= end,
        )
        .group_by(hour_expr)
        .all()
    )
    buckets = {
        int(row.hour): {
            "hour": int(row.hour),
            "net_sales": calculator.money(row.net_sales or Decimal("0.00")),
            "order_count": int(row.order_count or 0),
        }
        for row in rows
    }
    return [
        buckets.get(
            hour,
            {"hour": hour, "net_sales": Decimal("0.00"), "order_count": 0},
        )
        for hour in range(24)
    ]


def sales_by_employee(
    db: Session, *, tenant_id: UUID, start_date: date | None, end_date: date | None
) -> list[dict]:
    start_date, end_date = _normalize_range(start_date, end_date)
    start, end = _bounds(start_date, end_date)
    refunds_by_order = _refunds_by_order_subquery(db, tenant_id=tenant_id)

    rows = (
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
            Order.created_at >= start,
            Order.created_at <= end,
        )
        .group_by(Order.created_by_user_id, User.email)
        .order_by(func.sum(Order.total_amount).desc())
        .all()
    )
    return [
        {
            "user_id": row.user_id,
            "display_name": row.email or "Sin usuario",
            "order_count": int(row.order_count or 0),
            "net_sales": calculator.money(row.net_sales or Decimal("0.00")),
            "refund_count": int(row.refund_count or 0),
        }
        for row in rows
    ]


def refunds_by_reason(
    db: Session, *, tenant_id: UUID, start_date: date | None, end_date: date | None
) -> list[dict]:
    start_date, end_date = _normalize_range(start_date, end_date)
    start, end = _bounds(start_date, end_date)
    rows = (
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
    return [
        {
            "reason": row.reason,
            "refund_count": int(row.refund_count or 0),
            "refunded_amount": calculator.money(row.refunded_amount or Decimal("0.00")),
        }
        for row in rows
    ]


def business_story(
    db: Session, *, tenant_id: UUID, start_date: date | None, end_date: date | None
) -> dict:
    start_date, end_date = _normalize_range(start_date, end_date)
    tz = _tenant_timezone(db, tenant_id=tenant_id)
    start, end = _local_bounds(start_date, end_date, tz)
    orders = _completed_orders_between(db, tenant_id=tenant_id, start=start, end=end)
    order_ids = [order.id for order in orders]

    refunds: list[Refund] = []
    refunds_by_order: dict[UUID, Decimal] = defaultdict(lambda: Decimal("0.00"))
    if order_ids:
        refunds = (
            db.query(Refund)
            .filter(Refund.tenant_id == tenant_id, Refund.order_id.in_(order_ids))
            .all()
        )
        for refund in refunds:
            refunds_by_order[refund.order_id] = calculator.money(
                refunds_by_order[refund.order_id] + refund.refunded_amount
            )

    gross_sales = calculator.money(sum((order.total_amount for order in orders), Decimal("0.00")))
    refund_total = calculator.money(
        sum((refund.refunded_amount for refund in refunds), Decimal("0.00"))
    )
    net_sales = calculator.money(gross_sales - refund_total)
    completed_orders = len(orders)

    void_count = (
        db.query(Void)
        .filter(
            Void.tenant_id == tenant_id,
            Void.created_at >= start,
            Void.created_at <= end,
        )
        .count()
    )

    day_totals: dict[date, dict] = {}
    hour_totals: dict[int, dict] = {
        hour: {"hour": hour, "net_sales": Decimal("0.00"), "order_count": 0}
        for hour in range(24)
    }
    daypart_totals: dict[str, dict] = {
        daypart["key"]: {
            **daypart,
            "net_sales": Decimal("0.00"),
            "order_count": 0,
        }
        for daypart in DAYPARTS
    }

    for order in orders:
        local_created = order.created_at.astimezone(tz)
        order_net = calculator.money(
            order.total_amount - refunds_by_order.get(order.id, Decimal("0.00"))
        )
        day_row = day_totals.setdefault(
            local_created.date(),
            {"date": local_created.date(), "net_sales": Decimal("0.00"), "order_count": 0},
        )
        day_row["net_sales"] = calculator.money(day_row["net_sales"] + order_net)
        day_row["order_count"] += 1

        hour = local_created.hour
        hour_totals[hour]["net_sales"] = calculator.money(
            hour_totals[hour]["net_sales"] + order_net
        )
        hour_totals[hour]["order_count"] += 1

        daypart = _daypart_for_hour(hour)
        bucket = daypart_totals[daypart["key"]]
        bucket["net_sales"] = calculator.money(bucket["net_sales"] + order_net)
        bucket["order_count"] += 1

    sales_by_day = [
        {
            "date": row["date"],
            "net_sales": calculator.money(row["net_sales"]),
            "order_count": row["order_count"],
            "average_ticket": _average_ticket(row["net_sales"], row["order_count"]),
            "sales_share_pct": _pct(row["net_sales"], net_sales),
        }
        for row in sorted(day_totals.values(), key=lambda value: value["date"])
    ]

    sales_by_daypart = [
        {
            "key": row["key"],
            "label": row["label"],
            "start_hour": row["start_hour"],
            "end_hour": row["end_hour"],
            "net_sales": calculator.money(row["net_sales"]),
            "order_count": row["order_count"],
            "average_ticket": _average_ticket(row["net_sales"], row["order_count"]),
            "sales_share_pct": _pct(row["net_sales"], net_sales),
        }
        for row in daypart_totals.values()
    ]

    best_daypart = max(sales_by_daypart, key=lambda row: (row["net_sales"], row["order_count"]))
    peak_hour_row = max(
        hour_totals.values(), key=lambda row: (row["net_sales"], row["order_count"])
    )
    peak_hour = None
    if peak_hour_row["net_sales"] > Decimal("0.00"):
        peak_daypart = _daypart_for_hour(peak_hour_row["hour"])
        peak_hour = {
            "hour": peak_hour_row["hour"],
            "label": _hour_label(peak_hour_row["hour"]),
            "daypart_key": peak_daypart["key"],
            "net_sales": calculator.money(peak_hour_row["net_sales"]),
            "order_count": peak_hour_row["order_count"],
            "sales_share_pct": _pct(peak_hour_row["net_sales"], net_sales),
        }

    product_rows = _product_drivers(db, tenant_id=tenant_id, order_ids=order_ids)
    top_product_by_sales = product_rows[0] if product_rows else None
    top_product_by_units = None
    if product_rows:
        top_product_by_units = sorted(
            product_rows,
            key=lambda row: (row["quantity_sold"], row["gross_sales"]),
            reverse=True,
        )[0]
    payment_rows = _payment_drivers(db, tenant_id=tenant_id, order_ids=order_ids)
    dominant_payment = payment_rows[0] if payment_rows else None

    operational_signals = _operational_signals(
        refund_count=len(refunds),
        void_count=void_count,
        completed_orders=completed_orders,
    )
    recommended_actions = _recommended_actions(
        net_sales=net_sales,
        completed_orders=completed_orders,
        best_daypart=best_daypart,
        top_product=top_product_by_sales,
        dominant_payment=dominant_payment,
        refund_count=len(refunds),
        void_count=void_count,
    )

    executive_summary = _executive_summary(
        start_date=start_date,
        end_date=end_date,
        net_sales=net_sales,
        completed_orders=completed_orders,
        average_ticket=_average_ticket(net_sales, completed_orders),
        best_day=max(sales_by_day, key=lambda row: row["net_sales"]) if sales_by_day else None,
        best_daypart=best_daypart if best_daypart["net_sales"] > Decimal("0.00") else None,
        peak_hour=peak_hour,
        top_product=top_product_by_sales,
        dominant_payment=dominant_payment,
        refund_count=len(refunds),
        void_count=void_count,
    )

    return {
        "summary": {
            "start_date": start_date,
            "end_date": end_date,
            "timezone": _timezone_name(tz),
            "net_sales": net_sales,
            "gross_sales": gross_sales,
            "refund_total": refund_total,
            "completed_orders": completed_orders,
            "average_ticket": _average_ticket(net_sales, completed_orders),
            "refund_count": len(refunds),
            "cancellation_count": void_count,
        },
        "executive_summary": executive_summary,
        "sales_by_day": sales_by_day,
        "sales_by_daypart": sales_by_daypart,
        "peak_hour": peak_hour,
        "top_product_by_sales": top_product_by_sales,
        "top_product_by_units": top_product_by_units,
        "product_drivers": product_rows,
        "dominant_payment": dominant_payment,
        "payment_mix": payment_rows,
        "operational_signals": operational_signals,
        "recommended_actions": recommended_actions,
        "sales_by_employee": sales_by_employee(
            db, tenant_id=tenant_id, start_date=start_date, end_date=end_date
        ),
        "refunds_by_reason": refunds_by_reason(
            db, tenant_id=tenant_id, start_date=start_date, end_date=end_date
        ),
    }


def _product_drivers(db: Session, *, tenant_id: UUID, order_ids: list[UUID]) -> list[dict]:
    product_totals: dict[UUID, dict] = {}
    if not order_ids:
        return []
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
                "sales_share_pct": 0,
            },
        )
        row["quantity_sold"] += item.quantity
        row["gross_sales"] = calculator.money(row["gross_sales"] + item.line_total_amount)

    product_gross_total = calculator.money(
        sum((row["gross_sales"] for row in product_totals.values()), Decimal("0.00"))
    )
    rows = []
    for row in product_totals.values():
        row["sales_share_pct"] = _pct(row["gross_sales"], product_gross_total)
        rows.append(row)
    return sorted(rows, key=lambda row: (row["gross_sales"], row["quantity_sold"]), reverse=True)


def _payment_drivers(db: Session, *, tenant_id: UUID, order_ids: list[UUID]) -> list[dict]:
    totals: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    counts: dict[str, int] = defaultdict(int)
    if not order_ids:
        return []
    payments = (
        db.query(Payment)
        .filter(Payment.tenant_id == tenant_id, Payment.order_id.in_(order_ids))
        .all()
    )
    for payment in payments:
        totals[payment.method] = calculator.money(totals[payment.method] + payment.amount_amount)
        counts[payment.method] += 1
    total_payments = calculator.money(sum(totals.values(), Decimal("0.00")))
    return sorted(
        [
            {
                "method": method,
                "amount": amount,
                "payment_count": counts[method],
                "sales_share_pct": _pct(amount, total_payments),
            }
            for method, amount in totals.items()
        ],
        key=lambda row: (row["amount"], row["payment_count"]),
        reverse=True,
    )


def _operational_signals(
    *, refund_count: int, void_count: int, completed_orders: int
) -> list[dict]:
    if completed_orders == 0 and refund_count == 0 and void_count == 0:
        return []
    if refund_count == 0 and void_count == 0:
        return [
            {
                "type": "good_signal",
                "title": "Sin devoluciones ni cancelaciones",
                "detail": "Buena señal operativa en este periodo.",
            }
        ]
    signals = []
    if refund_count > 0:
        detail = (
            f"{refund_count} devolución{'es' if refund_count != 1 else ''} "
            f"registrada{'s' if refund_count != 1 else ''} en este periodo."
        )
        signals.append(
            {
                "type": "operational_improvement",
                "title": "Revisa devoluciones",
                "detail": detail,
            }
        )
    if void_count > 0:
        pct = _pct(Decimal(void_count), Decimal(max(completed_orders + void_count, 1)))
        signals.append(
            {
                "type": "risk" if pct >= 10 else "operational_improvement",
                "title": "Revisa cancelaciones",
                "detail": f"Las cancelaciones representaron {pct}% de las órdenes registradas.",
            }
        )
    return signals


def _recommended_actions(
    *,
    net_sales: Decimal,
    completed_orders: int,
    best_daypart: dict,
    top_product: dict | None,
    dominant_payment: dict | None,
    refund_count: int,
    void_count: int,
) -> list[dict]:
    if completed_orders == 0:
        return [
            {
                "type": "opportunity",
                "title": "Genera la primera venta del periodo",
                "detail": (
                    "Abre caja y registra ventas reales para activar los "
                    "insights del reporte."
                ),
            }
        ]
    actions = []
    if best_daypart["net_sales"] > Decimal("0.00"):
        actions.append(
            {
                "type": "opportunity",
                "title": f"Refuerza operación en {best_daypart['label'].lower()}",
                "detail": (
                    f"Este bloque concentra {best_daypart['sales_share_pct']}% "
                    "de tus ventas del periodo."
                ),
            }
        )
    if top_product:
        actions.append(
            {
                "type": "opportunity",
                "title": f"Prepara más stock de {top_product['product_name']}",
                "detail": (
                    "Fue el producto principal del periodo con "
                    f"{top_product['sales_share_pct']}% de las ventas."
                ),
            }
        )
    if completed_orders > 0:
        actions.append(
            {
                "type": "opportunity",
                "title": "Aumenta el ticket promedio",
                "detail": (
                    "Tu ticket promedio fue "
                    f"{_format_money(_average_ticket(net_sales, completed_orders))}. "
                    "Considera combos o complementos."
                ),
            }
        )
    if (
        dominant_payment
        and dominant_payment["method"] == "cash"
        and dominant_payment["sales_share_pct"] >= 70
    ):
        actions.append(
            {
                "type": "operational_improvement",
                "title": "Reduce dependencia de efectivo",
                "detail": (
                    f"Cash representa {dominant_payment['sales_share_pct']}% "
                    "de los cobros. Incentiva tarjeta o transferencia para "
                    "facilitar conciliación."
                ),
            }
        )
    if refund_count == 0 and void_count == 0:
        actions.append(
            {
                "type": "good_signal",
                "title": "Mantén el control operativo",
                "detail": "Sin devoluciones ni cancelaciones en este periodo.",
            }
        )
    elif refund_count > 0 or void_count > 0:
        actions.append(
            {
                "type": "risk",
                "title": "Audita correcciones operativas",
                "detail": "Revisa motivos de devolución o cancelación antes de cerrar el periodo.",
            }
        )
    return actions[:5]


def _executive_summary(
    *,
    start_date: date,
    end_date: date,
    net_sales: Decimal,
    completed_orders: int,
    average_ticket: Decimal,
    best_day: dict | None,
    best_daypart: dict | None,
    peak_hour: dict | None,
    top_product: dict | None,
    dominant_payment: dict | None,
    refund_count: int,
    void_count: int,
) -> str:
    if completed_orders == 0:
        return (
            f"Del {start_date.isoformat()} al {end_date.isoformat()}, no hay ventas "
            "completadas en el periodo. El reporte se actualizará cuando existan "
            "transacciones reales."
        )
    parts = [
        (
            f"Del {start_date.isoformat()} al {end_date.isoformat()}, "
            f"Kovar generó {_format_money(net_sales)} en ventas netas a partir de "
            f"{completed_orders} orden{'es' if completed_orders != 1 else ''}."
        ),
        f"El ticket promedio fue {_format_money(average_ticket)}.",
    ]
    if best_day:
        parts.append(f"El mejor día fue {best_day['date'].isoformat()}.")
    if best_daypart:
        sentence = f"El mejor momento fue {best_daypart['label'].lower()}"
        if peak_hour and peak_hour["daypart_key"] == best_daypart["key"]:
            sentence += f", especialmente entre {peak_hour['label']}"
        sentence += "."
        parts.append(sentence)
    if top_product:
        parts.append(f"{top_product['product_name']} fue el producto principal del periodo.")
    if dominant_payment:
        parts.append(
            f"{dominant_payment['method']} concentró "
            f"{dominant_payment['sales_share_pct']}% de los cobros."
        )
    if refund_count == 0 and void_count == 0:
        parts.append("No hubo devoluciones ni cancelaciones.")
    elif refund_count > 0 or void_count > 0:
        parts.append("Hay correcciones operativas que conviene revisar.")
    return " ".join(parts)


def _format_money(amount: Decimal) -> str:
    return f"MX${calculator.money(amount):,.2f}"
