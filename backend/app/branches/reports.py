"""Tenant-wide comparisons using the same sale-cohort/refund basis as Análisis."""

from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import aggregate_order_by
from sqlalchemy.orm import Session

from app.branches.models import Branch
from app.branches.scope import tenant_wide_branches
from app.orders.models import Order, OrderItem, Refund, RefundItem
from app.pricing.calculator import money
from app.reports.service import _local_bounds, _normalize_range, _tenant_timezone


class BranchProductSales(BaseModel):
    product_id: UUID
    product_name: str
    net_quantity: int
    net_sales: Decimal


class BranchSales(BaseModel):
    branch_id: UUID
    branch_name: str
    completed_orders: int
    gross_sales: Decimal
    refunded_amount: Decimal
    net_sales: Decimal
    average_ticket: Decimal
    share_pct: Decimal
    products: list[BranchProductSales]


class BranchComparisonResponse(BaseModel):
    start_date: date
    end_date: date
    timezone: str
    total_net_sales: Decimal
    leader_branch_ids: list[UUID]
    branches: list[BranchSales]


def compare_branches(
    db: Session, *, tenant_id: UUID, start_date: date | None, end_date: date | None
) -> BranchComparisonResponse:
    tz = _tenant_timezone(db, tenant_id=tenant_id)
    start_date, end_date = _normalize_range(start_date, end_date, tz)
    start, end = _local_bounds(start_date, end_date, tz)
    sale_time = func.coalesce(Order.occurred_at, Order.created_at)
    # This endpoint has separate REPORTS_VIEW_ALL authorization. Never remove tenant filters.
    with tenant_wide_branches(db):
        branches = db.query(Branch).filter(Branch.tenant_id == tenant_id).all()
        refunds = (
            db.query(Refund.order_id, func.sum(Refund.refunded_amount).label("amount"))
            .filter(Refund.tenant_id == tenant_id)
            .group_by(Refund.order_id)
            .subquery()
        )
        totals = (
            db.query(
                Order.branch_id,
                func.count(Order.id).label("count"),
                func.sum(Order.total_amount).label("gross"),
                func.sum(func.coalesce(refunds.c.amount, 0)).label("refunded"),
            )
            .outerjoin(refunds, refunds.c.order_id == Order.id)
            .filter(
                Order.tenant_id == tenant_id,
                Order.status == "completed",
                sale_time >= start,
                sale_time <= end,
            )
            .group_by(Order.branch_id)
            .all()
        )
        returned_items = (
            db.query(
                RefundItem.order_item_id,
                func.sum(RefundItem.quantity).label("quantity"),
                func.sum(RefundItem.line_total_amount).label("amount"),
            )
            .filter(RefundItem.tenant_id == tenant_id)
            .group_by(RefundItem.order_item_id)
            .subquery()
        )
        products = (
            db.query(
                Order.branch_id,
                OrderItem.product_id,
                func.array_agg(
                    aggregate_order_by(
                        OrderItem.product_name, sale_time.desc(), OrderItem.id.desc()
                    )
                )[1].label("name"),
                func.sum(OrderItem.quantity - func.coalesce(returned_items.c.quantity, 0)).label(
                    "qty"
                ),
                func.sum(
                    OrderItem.line_total_amount - func.coalesce(returned_items.c.amount, 0)
                ).label("net"),
            )
            .join(
                Order, (Order.id == OrderItem.order_id) & (Order.tenant_id == OrderItem.tenant_id)
            )
            .outerjoin(returned_items, returned_items.c.order_item_id == OrderItem.id)
            .filter(
                Order.tenant_id == tenant_id,
                OrderItem.tenant_id == tenant_id,
                Order.status == "completed",
                sale_time >= start,
                sale_time <= end,
            )
            .group_by(Order.branch_id, OrderItem.product_id)
            .all()
        )
    by_id = {row.branch_id: row for row in totals}
    by_branch: dict[UUID, list[BranchProductSales]] = {}
    for row in products:
        by_branch.setdefault(row.branch_id, []).append(
            BranchProductSales(
                product_id=row.product_id,
                product_name=row.name,
                net_quantity=int(row.qty),
                net_sales=money(row.net),
            )
        )
    total_net = money(sum((row.gross - row.refunded for row in totals), Decimal("0")))
    result = []
    for branch in branches:
        row = by_id.get(branch.id)
        gross = money(row.gross) if row else Decimal("0.00")
        refunded = money(row.refunded) if row else Decimal("0.00")
        net = money(gross - refunded)
        count = int(row.count) if row else 0
        branch_products = sorted(
            by_branch.get(branch.id, []),
            key=lambda p: (-p.net_sales, -p.net_quantity, p.product_name),
        )
        result.append(
            BranchSales(
                branch_id=branch.id,
                branch_name=branch.name,
                completed_orders=count,
                gross_sales=gross,
                refunded_amount=refunded,
                net_sales=net,
                average_ticket=money(net / count) if count else Decimal("0.00"),
                share_pct=(net / total_net * 100).quantize(Decimal("0.01"))
                if total_net > 0
                else Decimal("0.00"),
                products=branch_products,
            )
        )
    result.sort(key=lambda b: (-b.net_sales, b.branch_name, str(b.branch_id)))
    leaders = [
        b.branch_id for b in result if b.completed_orders > 0 and b.net_sales == result[0].net_sales
    ]
    return BranchComparisonResponse(
        start_date=start_date,
        end_date=end_date,
        timezone=str(tz),
        total_net_sales=total_net,
        leader_branch_ids=leaders,
        branches=result,
    )
