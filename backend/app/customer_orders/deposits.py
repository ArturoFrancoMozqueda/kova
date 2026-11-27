"""Deposits (anticipos) on customer orders: money received before the sale.

Rules (ADR-044):
- A deposit is not income. Cash enters the open shift's drawer when received
  (a `cash_in` movement) so the shift balances that day.
- The sale is recorded once, when the order is settled; the remaining balance
  is applied to it as payments already collected (`deposit_applied`), which
  never count again as cash taken.
- Cancelling an order with a balance returns it, or keeps it when the
  business's policy allows; a kept balance is income of the cancellation day.
"""

from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.customer_orders.models import CustomerOrder, CustomerOrderDeposit, CustomerOrderSettings
from app.orders.models import Order
from app.pricing import calculator
from app.shared.exceptions import bad_request
from app.shifts import repository as shifts_repo

METHODS = ("cash", "bank_transfer", "manual_card")
ZERO = Decimal("0.00")


def settings_for(db: Session, *, tenant_id: UUID) -> CustomerOrderSettings | None:
    return db.get(CustomerOrderSettings, tenant_id)


def settings_body(row: CustomerOrderSettings | None) -> dict[str, Any]:
    return {
        "deposit_minimum_percent": str(
            calculator.money(row.deposit_minimum_percent) if row else Decimal("0.00")
        ),
        "cancelled_deposit_policy": row.cancelled_deposit_policy if row else "refund",
    }


def minimum_amount(db: Session, *, order: CustomerOrder) -> Decimal:
    """Deposit the business requires before confirming this order (0 when none)."""
    row = settings_for(db, tenant_id=order.tenant_id)
    percent = row.deposit_minimum_percent if row else ZERO
    if percent <= 0:
        return ZERO
    return (order.total_amount * percent / Decimal(100)).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )


def entries(db: Session, *, order: CustomerOrder) -> list[CustomerOrderDeposit]:
    return (
        db.query(CustomerOrderDeposit)
        .filter(
            CustomerOrderDeposit.tenant_id == order.tenant_id,
            CustomerOrderDeposit.customer_order_id == order.id,
        )
        .order_by(CustomerOrderDeposit.created_at, CustomerOrderDeposit.id)
        .all()
    )


def net_by_method(rows: list[CustomerOrderDeposit]) -> dict[str, Decimal]:
    """Money still held per payment method: received minus returned."""
    net: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for row in rows:
        if row.kind == "deposit":
            net[row.method] += row.amount
        elif row.kind == "refund":
            net[row.method] -= row.amount
    return {method: calculator.money(amount) for method, amount in net.items() if amount > 0}


def _applied(db: Session, order: CustomerOrder) -> bool:
    """True once a sale that is not voided settled the order."""
    if not order.sale_order_id:
        return False
    status = (
        db.query(Order.status)
        .filter(Order.tenant_id == order.tenant_id, Order.id == order.sale_order_id)
        .scalar()
    )
    return status is not None and status != "voided"


def balance(db: Session, *, order: CustomerOrder, rows=None) -> Decimal:
    """Deposit money still held for this order, not yet applied, returned or kept."""
    rows = entries(db, order=order) if rows is None else rows
    if _applied(db, order):
        return ZERO
    retained = sum((row.amount for row in rows if row.kind == "retained"), ZERO)
    return calculator.money(max(ZERO, sum(net_by_method(rows).values(), ZERO) - retained))


def balances_for_orders(db: Session, *, tenant_id: UUID, orders: list[CustomerOrder]):
    """Balance per order for a list page, in one query (settled orders hold none)."""
    open_ids = [order.id for order in orders if not order.sale_order_id]
    voided = {
        order_id
        for (order_id,) in db.query(Order.id).filter(
            Order.tenant_id == tenant_id,
            Order.id.in_([order.sale_order_id for order in orders if order.sale_order_id]),
            Order.status == "voided",
        )
    } if any(order.sale_order_id for order in orders) else set()
    ids = open_ids + [order.id for order in orders if order.sale_order_id in voided]
    if not ids:
        return {}
    totals: dict[UUID, Decimal] = defaultdict(lambda: ZERO)
    for order_id, kind, amount in (
        db.query(
            CustomerOrderDeposit.customer_order_id,
            CustomerOrderDeposit.kind,
            func.sum(CustomerOrderDeposit.amount),
        )
        .filter(
            CustomerOrderDeposit.tenant_id == tenant_id,
            CustomerOrderDeposit.customer_order_id.in_(ids),
        )
        .group_by(CustomerOrderDeposit.customer_order_id, CustomerOrderDeposit.kind)
    ):
        totals[order_id] += amount if kind == "deposit" else -amount
    return {order_id: calculator.money(max(ZERO, value)) for order_id, value in totals.items()}


def summary(db: Session, *, order: CustomerOrder) -> dict[str, Any]:
    rows = entries(db, order=order)
    held = balance(db, order=order, rows=rows)
    applied = _applied(db, order)
    received = sum((row.amount for row in rows if row.kind == "deposit"), ZERO)
    return {
        "received_amount": str(calculator.money(received)),
        "balance_amount": str(held),
        "due_amount": str(
            ZERO if applied else calculator.money(max(ZERO, order.total_amount - held))
        ),
        # Only a new order still has to meet the minimum to be confirmed.
        "minimum_amount": str(minimum_amount(db, order=order) if order.status == "new" else ZERO),
        "applied": applied and received > 0,
        "entries": [
            {
                "id": str(row.id),
                "kind": row.kind,
                "method": row.method,
                "amount": str(row.amount),
                "reference": row.reference,
                "reason": row.reason,
                "created_at": row.created_at.isoformat(),
            }
            for row in rows
        ],
    }


def record(
    db: Session,
    *,
    order: CustomerOrder,
    user_id: UUID,
    kind: str,
    method: str | None,
    amount: Decimal,
    reference: str | None = None,
    reason: str | None = None,
) -> CustomerOrderDeposit:
    """Append one money row; cash moves the open shift's drawer in the same transaction."""
    shift_id = None
    if method == "cash":
        shift = shifts_repo.get_open_shift_for_update(db, tenant_id=order.tenant_id)
        if shift is None:
            raise bad_request("Hay que abrir un turno de caja antes de recibir o devolver efectivo")
        shift_id = shift.id
        shifts_repo.create_cash_movement(
            db,
            tenant_id=order.tenant_id,
            shift_id=shift.id,
            type="cash_in" if kind == "deposit" else "cash_out",
            amount=amount,
            reason=(
                f"Anticipo del pedido {order.folio}"
                if kind == "deposit"
                else f"Devolución de anticipo del pedido {order.folio}"
            ),
            user_id=user_id,
        )
    row = CustomerOrderDeposit(
        tenant_id=order.tenant_id,
        branch_id=order.branch_id,
        customer_order_id=order.id,
        kind=kind,
        method=method,
        amount=amount,
        reference=reference,
        reason=reason,
        shift_id=shift_id,
        created_by_user_id=user_id,
    )
    db.add(row)
    db.flush()
    return row


def retained_between(db: Session, *, tenant_id: UUID, start, end) -> tuple[Decimal, int]:
    """Deposits kept on cancelled orders in a window: income outside sales."""
    amount, count = (
        db.query(func.coalesce(func.sum(CustomerOrderDeposit.amount), 0), func.count())
        .filter(
            CustomerOrderDeposit.tenant_id == tenant_id,
            CustomerOrderDeposit.kind == "retained",
            CustomerOrderDeposit.created_at >= start,
            CustomerOrderDeposit.created_at <= end,
        )
        .one()
    )
    return calculator.money(Decimal(amount)), int(count)
