from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.inventory.repository import stock_on_hand_for_products
from app.orders.models import Order, Refund
from app.pricing import calculator
from app.reports import repository
from app.shared.exceptions import bad_request
from app.shared.timezone import local_day_bounds
from app.shared.timezone import tenant_timezone as _shared_tenant_timezone


def _sale_time(order: Order) -> datetime:
    """Ring-time when present, else server INSERT time (see repository._SALE_TIME)."""
    return order.occurred_at or order.created_at

# Cap report ranges so a huge custom range can't load a year of orders into
# memory. 92 days covers a full quarter, the largest sensible SMB window.
MAX_REPORT_RANGE_DAYS = 92

DAYPARTS = (
    {"key": "madrugada", "label": "Madrugada", "start_hour": 0, "end_hour": 5},
    {"key": "manana", "label": "Mañana", "start_hour": 6, "end_hour": 11},
    {"key": "tarde", "label": "Tarde", "start_hour": 12, "end_hour": 17},
    {"key": "noche", "label": "Noche", "start_hour": 18, "end_hour": 23},
)


def _default_range(tz: ZoneInfo | None = None) -> tuple[date, date]:
    today = datetime.now(tz or UTC).date()
    return today, today


def _normalize_range(
    start_date: date | None,
    end_date: date | None,
    tz: ZoneInfo | None = None,
) -> tuple[date, date]:
    if start_date is None and end_date is None:
        start_date, end_date = _default_range(tz)
    elif start_date is None:
        start_date = end_date
    elif end_date is None:
        end_date = start_date

    assert start_date is not None
    assert end_date is not None
    if end_date < start_date:
        raise bad_request("End date must be on or after start date")
    if (end_date - start_date).days + 1 > MAX_REPORT_RANGE_DAYS:
        raise bad_request(
            f"El rango máximo de análisis es {MAX_REPORT_RANGE_DAYS} días. "
            "Acota las fechas e inténtalo de nuevo."
        )
    return start_date, end_date


def _bounds(start_date: date, end_date: date) -> tuple[datetime, datetime]:
    start = datetime.combine(start_date, time.min, tzinfo=UTC)
    end = datetime.combine(end_date, time.max, tzinfo=UTC)
    return start, end


def _tenant_timezone(db: Session, *, tenant_id: UUID) -> ZoneInfo:
    # Delegate to the shared helper so reports and order-list resolve the
    # tenant timezone identically.
    return _shared_tenant_timezone(db, tenant_id=tenant_id)


def _timezone_name(tz: ZoneInfo) -> str:
    return str(tz)


def _local_bounds(start_date: date, end_date: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    return local_day_bounds(start_date, end_date, tz)


def _completed_orders_between(
    db: Session, *, tenant_id: UUID, start: datetime, end: datetime
) -> list[Order]:
    return repository.completed_orders_between(
        db, tenant_id=tenant_id, start=start, end=end
    )


def _money(value: Decimal | int | float | str) -> Decimal:
    return calculator.money(Decimal(str(value)))


def _pct(value: Decimal, total: Decimal) -> int:
    if total <= Decimal("0.00"):
        return 0
    return int(((value / total) * Decimal("100")).quantize(Decimal("1")))


def _margin_pct(profit: Decimal, net_sales: Decimal) -> Decimal | None:
    if net_sales <= Decimal("0.00"):
        return None
    return ((profit / net_sales) * Decimal("100")).quantize(Decimal("0.01"))


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
    db: Session,
    *,
    tenant_id: UUID,
    start_date: date,
    end_date: date,
    tz: ZoneInfo | None = None,
) -> list[Order]:
    if tz is None:
        tz = _tenant_timezone(db, tenant_id=tenant_id)
    start, end = _local_bounds(start_date, end_date, tz)
    return repository.completed_orders_between(
        db, tenant_id=tenant_id, start=start, end=end
    )


def _void_count(
    db: Session,
    *,
    tenant_id: UUID,
    start_date: date,
    end_date: date,
    tz: ZoneInfo | None = None,
) -> int:
    if tz is None:
        tz = _tenant_timezone(db, tenant_id=tenant_id)
    start, end = _local_bounds(start_date, end_date, tz)
    return repository.void_count_between(
        db, tenant_id=tenant_id, start=start, end=end
    )


def sales_summary(
    db: Session, *, tenant_id: UUID, start_date: date | None, end_date: date | None
) -> dict:
    tz = _tenant_timezone(db, tenant_id=tenant_id)
    start_date, end_date = _normalize_range(start_date, end_date, tz)
    orders = _completed_orders(
        db, tenant_id=tenant_id, start_date=start_date, end_date=end_date, tz=tz
    )
    order_ids = [order.id for order in orders]
    gross_sales = calculator.money(sum((order.total_amount for order in orders), Decimal("0.00")))

    refunds = repository.refunds_for_orders(db, tenant_id=tenant_id, order_ids=order_ids)
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
            db, tenant_id=tenant_id, start_date=start_date, end_date=end_date, tz=tz
        ),
    }


def payment_breakdown(
    db: Session, *, tenant_id: UUID, start_date: date | None, end_date: date | None
) -> dict:
    tz = _tenant_timezone(db, tenant_id=tenant_id)
    start_date, end_date = _normalize_range(start_date, end_date, tz)
    orders = _completed_orders(
        db, tenant_id=tenant_id, start_date=start_date, end_date=end_date, tz=tz
    )
    order_ids = [order.id for order in orders]
    totals: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    counts: dict[str, int] = defaultdict(int)

    for payment in repository.payments_for_orders(
        db, tenant_id=tenant_id, order_ids=order_ids
    ):
        totals[payment.method] = calculator.money(
            totals[payment.method] + payment.amount_amount
        )
        counts[payment.method] += 1

    # Refund-adjust the mix so it ties to net sales. `amount` stays the gross
    # collected (unchanged definition); `net_amount` = collected − refunds
    # attributed to that method. Refunds with a recorded method net out per
    # method; legacy refunds (method NULL) only reduce the overall net_total so
    # the top line still reconciles to net_sales (= gross_sales − refunds).
    refunds_by_method = repository.refunds_by_method_for_orders(
        db, tenant_id=tenant_id, order_ids=order_ids
    )
    all_refunds = repository.refunds_for_orders(
        db, tenant_id=tenant_id, order_ids=order_ids
    )
    refund_total = calculator.money(
        sum((r.refunded_amount for r in all_refunds), Decimal("0.00"))
    )
    gross_total = calculator.money(sum(totals.values(), Decimal("0.00")))
    net_total = calculator.money(gross_total - refund_total)

    return {
        "start_date": start_date,
        "end_date": end_date,
        "payments": [
            {
                "method": method,
                "amount": totals[method],
                "refunded_amount": refunds_by_method.get(method, Decimal("0.00")),
                "net_amount": calculator.money(
                    totals[method] - refunds_by_method.get(method, Decimal("0.00"))
                ),
                "payment_count": counts[method],
            }
            for method in sorted(totals)
        ],
        "gross_total": gross_total,
        "refund_total": refund_total,
        "net_total": net_total,
    }


def top_products(
    db: Session,
    *,
    tenant_id: UUID,
    start_date: date | None,
    end_date: date | None,
    limit: int,
) -> dict:
    tz = _tenant_timezone(db, tenant_id=tenant_id)
    start_date, end_date = _normalize_range(start_date, end_date, tz)
    if limit < 1 or limit > 50:
        raise bad_request("Limit must be between 1 and 50")
    orders = _completed_orders(
        db, tenant_id=tenant_id, start_date=start_date, end_date=end_date, tz=tz
    )
    order_ids = [order.id for order in orders]
    products = sorted(
        _net_product_totals(db, tenant_id=tenant_id, order_ids=order_ids).values(),
        key=lambda row: (row["quantity_sold"], row["gross_sales"]),
        reverse=True,
    )[:limit]
    return {"start_date": start_date, "end_date": end_date, "products": products}


def sales_by_hour(
    db: Session, *, tenant_id: UUID, start_date: date | None, end_date: date | None
) -> list[dict]:
    tz = _tenant_timezone(db, tenant_id=tenant_id)
    start_date, end_date = _normalize_range(start_date, end_date, tz)
    orders = _completed_orders(
        db, tenant_id=tenant_id, start_date=start_date, end_date=end_date, tz=tz
    )
    order_ids = [order.id for order in orders]
    refunds_by_order: dict[UUID, Decimal] = defaultdict(lambda: Decimal("0.00"))
    for refund in repository.refunds_for_orders(
        db, tenant_id=tenant_id, order_ids=order_ids
    ):
        refunds_by_order[refund.order_id] = calculator.money(
            refunds_by_order[refund.order_id] + refund.refunded_amount
        )

    buckets: dict[int, dict] = {
        hour: {"hour": hour, "net_sales": Decimal("0.00"), "order_count": 0}
        for hour in range(24)
    }
    for order in orders:
        hour = _sale_time(order).astimezone(tz).hour
        net = calculator.money(
            order.total_amount - refunds_by_order.get(order.id, Decimal("0.00"))
        )
        buckets[hour]["net_sales"] = calculator.money(buckets[hour]["net_sales"] + net)
        buckets[hour]["order_count"] += 1
    return [buckets[hour] for hour in range(24)]


def sales_by_employee(
    db: Session, *, tenant_id: UUID, start_date: date | None, end_date: date | None
) -> list[dict]:
    tz = _tenant_timezone(db, tenant_id=tenant_id)
    start_date, end_date = _normalize_range(start_date, end_date, tz)
    start, end = _local_bounds(start_date, end_date, tz)
    rows = repository.sales_by_employee_rows(
        db, tenant_id=tenant_id, start=start, end=end
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
    tz = _tenant_timezone(db, tenant_id=tenant_id)
    start_date, end_date = _normalize_range(start_date, end_date, tz)
    start, end = _local_bounds(start_date, end_date, tz)
    rows = repository.refunds_in_window(
        db, tenant_id=tenant_id, start=start, end=end
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
    tz = _tenant_timezone(db, tenant_id=tenant_id)
    start_date, end_date = _normalize_range(start_date, end_date, tz)
    start, end = _local_bounds(start_date, end_date, tz)
    orders = _completed_orders_between(db, tenant_id=tenant_id, start=start, end=end)
    order_ids = [order.id for order in orders]

    refunds: list[Refund] = repository.refunds_for_orders(
        db, tenant_id=tenant_id, order_ids=order_ids
    )
    refunds_by_order: dict[UUID, Decimal] = defaultdict(lambda: Decimal("0.00"))
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

    void_count = repository.void_count_between(
        db, tenant_id=tenant_id, start=start, end=end
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
        local_created = _sale_time(order).astimezone(tz)
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

    # One pass over the window's order/refund items feeds product drivers,
    # margin and the current side of product trends — previously each of them
    # re-queried and re-aggregated the same rows.
    item_rows = _net_item_rows(db, tenant_id=tenant_id, order_ids=order_ids)
    product_rows = _product_drivers(item_rows)
    margin = _margin_report(orders=orders, item_rows=item_rows, tz=tz)
    inventory_valuation = _inventory_valuation(db, tenant_id=tenant_id)
    waste = _waste_report(db, tenant_id=tenant_id, start=start, end=end)
    operating_expenses = _operating_expense_report(
        db,
        tenant_id=tenant_id,
        start_date=start_date,
        end_date=end_date,
        gross_profit=margin["summary"]["gross_profit"],
    )
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
    restock_for_actions = _restock_alerts(db, tenant_id=tenant_id)
    recommended_actions = _recommended_actions(
        net_sales=net_sales,
        completed_orders=completed_orders,
        best_daypart=best_daypart,
        top_product=top_product_by_sales,
        dominant_payment=dominant_payment,
        refund_count=len(refunds),
        void_count=void_count,
        restock_alerts=restock_for_actions,
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

    product_trends = _product_trends(
        db,
        tenant_id=tenant_id,
        tz=tz,
        start_date=start_date,
        end_date=end_date,
        current_item_rows=item_rows,
    )
    restock_alerts = restock_for_actions

    employees = sales_by_employee(
        db, tenant_id=tenant_id, start_date=start_date, end_date=end_date
    )
    employee_contribution = _employee_contribution(employees, net_sales=net_sales)

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
        "margin": margin,
        "inventory_valuation": inventory_valuation,
        "waste": waste,
        "operating_expenses": operating_expenses,
        "product_trends": product_trends,
        "restock_alerts": restock_alerts,
        "dominant_payment": dominant_payment,
        "payment_mix": payment_rows,
        "operational_signals": operational_signals,
        "recommended_actions": recommended_actions,
        "sales_by_employee": employees,
        "employee_contribution": employee_contribution,
        "refunds_by_reason": refunds_by_reason(
            db, tenant_id=tenant_id, start_date=start_date, end_date=end_date
        ),
    }


def _employee_contribution(
    employees: list[dict], *, net_sales: Decimal
) -> dict:
    if not employees:
        return {"top": None, "rows": [], "even_distribution": True}
    rows: list[dict] = []
    for emp in employees:
        share = _pct(emp["net_sales"], net_sales) if net_sales > Decimal("0.00") else 0
        rows.append(
            {
                "user_id": emp["user_id"],
                "display_name": emp["display_name"],
                "order_count": emp["order_count"],
                "net_sales": emp["net_sales"],
                "refund_count": emp["refund_count"],
                "sales_share_pct": share,
            }
        )
    rows.sort(key=lambda row: (row["net_sales"], row["order_count"]), reverse=True)
    top = rows[0]
    even_distribution = len(rows) <= 1 or top["sales_share_pct"] < 70
    return {"top": top, "rows": rows, "even_distribution": even_distribution}


def _previous_period(start_date: date, end_date: date) -> tuple[date, date]:
    days = (end_date - start_date).days + 1
    prev_end = start_date - timedelta(days=1)
    prev_start = prev_end - timedelta(days=days - 1)
    return prev_start, prev_end


def _units_by_product(item_rows: list[dict]) -> dict[UUID, dict]:
    return {
        row["product_id"]: {
            "product_id": row["product_id"],
            "product_name": row["product_name"],
            "units": int(row["quantity_sold"] or 0),
            "gross": calculator.money(row["gross_sales"] or Decimal("0.00")),
        }
        for row in _net_product_totals_from_rows(item_rows).values()
    }


def _product_units_in_window(
    db: Session,
    *,
    tenant_id: UUID,
    start: datetime,
    end: datetime,
) -> dict[UUID, dict]:
    orders = _completed_orders_between(db, tenant_id=tenant_id, start=start, end=end)
    return _units_by_product(
        _net_item_rows(
            db, tenant_id=tenant_id, order_ids=[order.id for order in orders]
        )
    )


def _product_trends(
    db: Session,
    *,
    tenant_id: UUID,
    tz: ZoneInfo,
    start_date: date,
    end_date: date,
    current_item_rows: list[dict],
) -> dict:
    # The current window's orders/items were already fetched by business_story;
    # reuse them instead of re-querying. Only the previous window hits the db.
    current = _units_by_product(current_item_rows)

    prev_start_date, prev_end_date = _previous_period(start_date, end_date)
    prev_start, prev_end = _local_bounds(prev_start_date, prev_end_date, tz)
    previous = _product_units_in_window(
        db, tenant_id=tenant_id, start=prev_start, end=prev_end
    )

    product_ids = set(current.keys()) | set(previous.keys())
    rows: list[dict] = []
    for product_id in product_ids:
        cur = current.get(product_id)
        prev = previous.get(product_id)
        product_name = (cur or prev or {}).get("product_name", "Producto")
        cur_units = cur["units"] if cur else 0
        prev_units = prev["units"] if prev else 0
        cur_gross = cur["gross"] if cur else Decimal("0.00")
        prev_gross = prev["gross"] if prev else Decimal("0.00")
        delta_units = cur_units - prev_units
        if prev_units > 0:
            pct = int(round(((cur_units - prev_units) / prev_units) * 100))
        elif cur_units > 0:
            pct = 100
        else:
            pct = 0
        if prev_units == 0 and cur_units > 0:
            trend = "new"
        elif cur_units == 0 and prev_units > 0:
            trend = "lost"
        elif pct >= 15:
            trend = "growing"
        elif pct <= -15:
            trend = "declining"
        else:
            trend = "stable"
        rows.append(
            {
                "product_id": product_id,
                "product_name": product_name,
                "current_units": cur_units,
                "previous_units": prev_units,
                "delta_units": delta_units,
                "delta_pct": pct,
                "current_gross": cur_gross,
                "previous_gross": prev_gross,
                "trend": trend,
            }
        )

    growing = sorted(
        [r for r in rows if r["trend"] in ("growing", "new") and r["current_units"] > 0],
        key=lambda r: (r["delta_pct"], r["current_units"]),
        reverse=True,
    )[:5]
    declining = sorted(
        [r for r in rows if r["trend"] in ("declining", "lost") and r["previous_units"] > 0],
        key=lambda r: (r["delta_pct"], -r["previous_units"]),
    )[:5]
    slow_movers = sorted(
        [r for r in rows if r["current_units"] > 0 and r["current_units"] <= 2],
        key=lambda r: (r["current_units"], r["current_gross"]),
    )[:5]
    return {
        "growing": growing,
        "declining": declining,
        "slow_movers": slow_movers,
    }


def _restock_alerts(
    db: Session,
    *,
    tenant_id: UUID,
) -> list[dict]:
    since = datetime.now(UTC) - timedelta(days=7)
    sales_rows = repository.inventory_sales_since(
        db, tenant_id=tenant_id, since=since
    )
    sold_by_product = {row.product_id: abs(int(row.units or 0)) for row in sales_rows}

    alerts: list[dict] = []
    products = repository.tracked_products(db, tenant_id=tenant_id)
    stock_by_product = stock_on_hand_for_products(
        db, tenant_id=tenant_id, product_ids=[product.id for product in products]
    )
    for product in products:
        stock = stock_by_product.get(product.id, 0)
        sold = sold_by_product.get(product.id, 0)
        units_per_day = (Decimal(sold) / Decimal("7")).quantize(Decimal("0.01"))
        days_until_out: Decimal | None = None
        if units_per_day > 0:
            days_until_out = (Decimal(stock) / units_per_day).quantize(Decimal("0.1"))

        threshold = product.low_stock_threshold or 0
        is_low = stock <= threshold and threshold > 0
        is_running_out = days_until_out is not None and days_until_out <= Decimal("3.0")
        if not (is_low or is_running_out):
            continue
        if is_low and is_running_out:
            severity = "critical"
            detail = (
                f"Stock {stock} bajo el umbral {threshold} y se agota en "
                f"{days_until_out} día(s) al ritmo actual."
            )
        elif is_low:
            severity = "warning"
            detail = f"Stock {stock} por debajo del umbral {threshold}."
        else:
            severity = "warning"
            detail = (
                f"Al ritmo actual ({units_per_day}/día), el stock alcanza "
                f"para {days_until_out} día(s)."
            )
        alerts.append(
            {
                "product_id": product.id,
                "product_name": product.name,
                "stock_on_hand": stock,
                "low_stock_threshold": threshold,
                "units_per_day_7d": units_per_day,
                "days_until_out": days_until_out,
                "severity": severity,
                "detail": detail,
            }
        )
    alerts.sort(
        key=lambda row: (
            row["severity"] != "critical",
            row["days_until_out"] is None,
            row["days_until_out"] if row["days_until_out"] is not None else Decimal("999"),
        )
    )
    return alerts[:10]


def _product_drivers(item_rows: list[dict]) -> list[dict]:
    product_totals = _net_product_totals_from_rows(item_rows)
    product_gross_total = calculator.money(
        sum((row["gross_sales"] for row in product_totals.values()), Decimal("0.00"))
    )
    rows = []
    for row in product_totals.values():
        row["sales_share_pct"] = _pct(row["gross_sales"], product_gross_total)
        rows.append(row)
    return sorted(rows, key=lambda row: (row["gross_sales"], row["quantity_sold"]), reverse=True)


def _net_item_rows(db: Session, *, tenant_id: UUID, order_ids: list[UUID]) -> list[dict]:
    refunded_by_item = {
        row.order_item_id: {
            "quantity": int(row.quantity or 0),
            "line_total_amount": calculator.money(row.line_total_amount or Decimal("0.00")),
        }
        for row in repository.refund_items_for_orders(
            db, tenant_id=tenant_id, order_ids=order_ids
        )
    }
    rows: list[dict] = []
    for item in repository.order_items_for_orders(
        db, tenant_id=tenant_id, order_ids=order_ids
    ):
        refunded = refunded_by_item.get(
            item.id, {"quantity": 0, "line_total_amount": Decimal("0.00")}
        )
        net_quantity = max(item.quantity - refunded["quantity"], 0)
        net_sales = calculator.money(
            max(item.line_total_amount - refunded["line_total_amount"], Decimal("0.00"))
        )
        if net_quantity <= 0 and net_sales <= Decimal("0.00"):
            continue
        rows.append(
            {
                "item": item,
                "net_quantity": net_quantity,
                "net_sales": net_sales,
                "net_sales_before_tax": calculator.money(
                    item.line_total_amount - item.tax_amount
                    - calculator.refund_line_total(
                        item.line_total_amount - item.tax_amount,
                        item.quantity, 0, refunded["quantity"],
                    )
                ),
            }
        )
    return rows


def _margin_report(
    *,
    orders: list[Order],
    item_rows: list[dict],
    tz: ZoneInfo,
) -> dict:
    order_dates = {order.id: _sale_time(order).astimezone(tz).date() for order in orders}
    products: dict[UUID, dict] = {}
    days: dict[date, dict] = {}

    for row in item_rows:
        item = row["item"]
        net_quantity = row["net_quantity"]
        net_sales = row.get("net_sales_before_tax", row["net_sales"])
        missing_cost = item.unit_cost is None and net_quantity > 0
        cogs = (
            None
            if missing_cost
            else calculator.money((item.unit_cost or Decimal("0.00")) * net_quantity)
        )

        product = products.setdefault(
            item.product_id,
            {
                "product_id": item.product_id,
                "product_name": item.product_name,
                "quantity_sold": 0,
                "net_sales": Decimal("0.00"),
                "known_cogs": Decimal("0.00"),
                "missing_cost": False,
            },
        )
        product["quantity_sold"] += net_quantity
        product["net_sales"] = calculator.money(product["net_sales"] + net_sales)
        product["missing_cost"] = product["missing_cost"] or missing_cost
        if cogs is not None:
            product["known_cogs"] = calculator.money(product["known_cogs"] + cogs)

        sale_date = order_dates[item.order_id]
        day = days.setdefault(
            sale_date,
            {
                "date": sale_date,
                "net_sales": Decimal("0.00"),
                "known_cogs": Decimal("0.00"),
                "missing_product_ids": set(),
            },
        )
        day["net_sales"] = calculator.money(day["net_sales"] + net_sales)
        if missing_cost:
            day["missing_product_ids"].add(item.product_id)
        elif cogs is not None:
            day["known_cogs"] = calculator.money(day["known_cogs"] + cogs)

    product_rows = []
    for product in products.values():
        complete = not product["missing_cost"]
        cogs = product["known_cogs"] if complete else None
        profit = calculator.money(product["net_sales"] - cogs) if cogs is not None else None
        product_rows.append(
            {
                "product_id": product["product_id"],
                "product_name": product["product_name"],
                "quantity_sold": product["quantity_sold"],
                "net_sales": product["net_sales"],
                "cogs": cogs,
                "gross_profit": profit,
                "gross_margin_pct": (
                    _margin_pct(profit, product["net_sales"]) if profit is not None else None
                ),
                "missing_cost": not complete,
            }
        )
    product_rows.sort(
        key=lambda row: (
            row["gross_profit"] is not None,
            row["gross_profit"] or Decimal("0.00"),
            row["net_sales"],
        ),
        reverse=True,
    )

    day_rows = []
    for day in sorted(days.values(), key=lambda value: value["date"]):
        complete = not day["missing_product_ids"]
        cogs = day["known_cogs"] if complete else None
        profit = calculator.money(day["net_sales"] - cogs) if cogs is not None else None
        day_rows.append(
            {
                "date": day["date"],
                "net_sales": day["net_sales"],
                "cogs": cogs,
                "gross_profit": profit,
                "gross_margin_pct": (
                    _margin_pct(profit, day["net_sales"]) if profit is not None else None
                ),
                "products_without_cost": len(day["missing_product_ids"]),
                "complete": complete,
            }
        )

    sold_without_cost = sum(1 for product in products.values() if product["missing_cost"])
    complete = sold_without_cost == 0
    total_net_sales = calculator.money(
        sum((product["net_sales"] for product in products.values()), Decimal("0.00"))
    )
    total_cogs = (
        calculator.money(
            sum((product["known_cogs"] for product in products.values()), Decimal("0.00"))
        )
        if complete
        else None
    )
    total_profit = (
        calculator.money(total_net_sales - total_cogs) if total_cogs is not None else None
    )
    return {
        "summary": {
            "net_sales": total_net_sales,
            "cogs": total_cogs,
            "gross_profit": total_profit,
            "gross_margin_pct": (
                _margin_pct(total_profit, total_net_sales) if total_profit is not None else None
            ),
            "sold_products": len(products),
            "sold_products_without_cost": sold_without_cost,
            "complete": complete,
        },
        "by_day": day_rows,
        "by_product": product_rows,
    }


def _inventory_valuation(db: Session, *, tenant_id: UUID) -> dict:
    products = repository.tracked_products(db, tenant_id=tenant_id)
    stock = stock_on_hand_for_products(
        db, tenant_id=tenant_id, product_ids=[product.id for product in products]
    )
    known_value = Decimal("0.00")
    products_without_cost = 0
    units_without_cost = 0
    for product in products:
        units = max(stock.get(product.id, 0), 0)
        if units <= 0:
            continue
        if product.cost_price is None:
            products_without_cost += 1
            units_without_cost += units
            continue
        known_value = calculator.money(known_value + product.cost_price * units)
    complete = products_without_cost == 0
    return {
        "value": known_value if complete else None,
        "known_value": known_value,
        "tracked_products": len(products),
        "products_without_cost": products_without_cost,
        "units_without_cost": units_without_cost,
        "complete": complete,
    }


def _waste_report(
    db: Session, *, tenant_id: UUID, start: datetime, end: datetime
) -> dict:
    totals: dict[str, dict] = {}
    missing_product_ids: set[UUID] = set()
    known_value = Decimal("0.00")
    units = 0
    rows = repository.waste_movements_between(
        db, tenant_id=tenant_id, start=start, end=end
    )
    for movement, product in rows:
        movement_units = abs(movement.quantity_delta)
        units += movement_units
        reason = totals.setdefault(
            movement.reason_code,
            {
                "reason_code": movement.reason_code,
                "units": 0,
                "known_value": Decimal("0.00"),
                "missing_product_ids": set(),
            },
        )
        reason["units"] += movement_units
        if product.cost_price is None:
            missing_product_ids.add(product.id)
            reason["missing_product_ids"].add(product.id)
            continue
        movement_value = calculator.money(product.cost_price * movement_units)
        known_value = calculator.money(known_value + movement_value)
        reason["known_value"] = calculator.money(reason["known_value"] + movement_value)

    by_reason = []
    for reason in totals.values():
        complete = not reason["missing_product_ids"]
        by_reason.append(
            {
                "reason_code": reason["reason_code"],
                "units": reason["units"],
                "value": reason["known_value"] if complete else None,
                "products_without_cost": len(reason["missing_product_ids"]),
            }
        )
    by_reason.sort(key=lambda row: row["units"], reverse=True)
    complete = not missing_product_ids
    return {
        "units": units,
        "movement_count": len(rows),
        "value": known_value if complete else None,
        "known_value": known_value,
        "products_without_cost": len(missing_product_ids),
        "complete": complete,
        "by_reason": by_reason,
    }


def _operating_expense_report(
    db: Session,
    *,
    tenant_id: UUID,
    start_date: date,
    end_date: date,
    gross_profit: Decimal | None,
) -> dict:
    rows = repository.operating_expenses_between(
        db, tenant_id=tenant_id, start_date=start_date, end_date=end_date
    )
    totals: dict[str, dict] = {}
    total = Decimal("0.00")
    for expense in rows:
        total = calculator.money(total + expense.amount)
        category = totals.setdefault(
            expense.category,
            {"category": expense.category, "amount": Decimal("0.00"), "expense_count": 0},
        )
        category["amount"] = calculator.money(category["amount"] + expense.amount)
        category["expense_count"] += 1
    by_category = sorted(totals.values(), key=lambda row: row["amount"], reverse=True)
    return {
        "total": total,
        "expense_count": len(rows),
        "approximate_operating_profit": (
            calculator.money(gross_profit - total) if gross_profit is not None else None
        ),
        "margin_complete": gross_profit is not None,
        "by_category": by_category,
    }


def _net_product_totals(db: Session, *, tenant_id: UUID, order_ids: list[UUID]) -> dict[UUID, dict]:
    return _net_product_totals_from_rows(
        _net_item_rows(db, tenant_id=tenant_id, order_ids=order_ids)
    )


def _net_product_totals_from_rows(item_rows: list[dict]) -> dict[UUID, dict]:
    product_totals: dict[UUID, dict] = {}
    for item_row in item_rows:
        item = item_row["item"]
        net_quantity = item_row["net_quantity"]
        net_gross = item_row["net_sales"]
        if net_quantity <= 0 and net_gross <= Decimal("0.00"):
            continue
        row = product_totals.setdefault(
            item.product_id,
            {
                "product_id": item.product_id,
                "product_name": item.product_name,
                "quantity_sold": 0,
                "gross_sales": Decimal("0.00"),
            },
        )
        row["quantity_sold"] += net_quantity
        row["gross_sales"] = calculator.money(row["gross_sales"] + max(net_gross, Decimal("0.00")))
    return product_totals


def _payment_drivers(db: Session, *, tenant_id: UUID, order_ids: list[UUID]) -> list[dict]:
    totals: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    counts: dict[str, int] = defaultdict(int)
    payments = repository.payments_for_orders(
        db, tenant_id=tenant_id, order_ids=order_ids
    )
    if not payments:
        return []
    for payment in payments:
        totals[payment.method] = calculator.money(totals[payment.method] + payment.amount_amount)
        counts[payment.method] += 1
    total_payments = calculator.money(sum(totals.values(), Decimal("0.00")))
    # `amount` and `sales_share_pct` stay the gross-collection view (unchanged
    # definition). `net_amount` nets out refunds recorded against each method so
    # the mix reconciles with net sales; legacy method-less refunds are excluded.
    refunds_by_method = repository.refunds_by_method_for_orders(
        db, tenant_id=tenant_id, order_ids=order_ids
    )
    return sorted(
        [
            {
                "method": method,
                "amount": amount,
                "refunded_amount": refunds_by_method.get(method, Decimal("0.00")),
                "net_amount": calculator.money(
                    amount - refunds_by_method.get(method, Decimal("0.00"))
                ),
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
    restock_alerts: list[dict] | None = None,
) -> list[dict]:
    if completed_orders == 0:
        return [
            {
                "type": "opportunity",
                "title": "Genera la primera venta del periodo",
                "detail": (
                    "Abre caja y registra ventas reales para activar los "
                    "insights del análisis."
                ),
            }
        ]
    actions = []
    critical_restock = [a for a in (restock_alerts or []) if a["severity"] == "critical"][:1]
    for alert in critical_restock:
        actions.append(
            {
                "type": "risk",
                "title": f"Reabastece {alert['product_name']}",
                "detail": alert["detail"],
            }
        )
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
    # Dedupe: collapse entries with the same normalized title (case-insensitive).
    # Restock alerts and top-product suggestions can both reference the same
    # product; the first-seen entry wins.
    seen: set[str] = set()
    deduped: list[dict] = []
    for action in actions:
        key = (action.get("title") or "").strip().lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(action)
    return deduped[:5]


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
            f"Del {_format_day(start_date)} al {_format_day(end_date)}, no hay ventas "
            "completadas en el periodo. El análisis se actualizará cuando existan "
            "transacciones reales."
        )
    parts = [
        (
            f"Del {_format_day(start_date)} al {_format_day(end_date)}, "
            f"Kova generó {_format_money(net_sales)} en ventas netas a partir de "
            f"{completed_orders} orden{'es' if completed_orders != 1 else ''}."
        ),
        f"El ticket promedio fue {_format_money(average_ticket)}.",
    ]
    if best_day:
        parts.append(f"El mejor día fue {_format_day(best_day['date'])}.")
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
            f"{_payment_label(dominant_payment['method'])} concentró "
            f"{dominant_payment['sales_share_pct']}% de los cobros."
        )
    if refund_count == 0 and void_count == 0:
        parts.append("No hubo devoluciones ni cancelaciones.")
    elif refund_count > 0 or void_count > 0:
        parts.append("Hay correcciones operativas que conviene revisar.")
    return " ".join(parts)


def _format_money(amount: Decimal) -> str:
    return f"MX${calculator.money(amount):,.2f}"


# Spanish month names — avoids depending on a locale being installed in the
# container, which is not guaranteed. Mirrors the frontend `formatDayMonthLong`.
_MONTHS_ES = (
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
)

# Payment method keys (orders schema: cash | bank_transfer | manual_card) to
# es-MX labels. Mirrors the frontend `reasonLabel` map so both agree.
_PAYMENT_LABELS = {
    "cash": "Efectivo",
    "bank_transfer": "Transferencia",
    "manual_card": "Tarjeta manual",
}


def _format_day(value: date) -> str:
    """A business day as "5 de julio" (es-MX), not a raw ISO string."""
    return f"{value.day} de {_MONTHS_ES[value.month - 1]}"


def _payment_label(method: str) -> str:
    return _PAYMENT_LABELS.get(method, method.replace("_", " "))
