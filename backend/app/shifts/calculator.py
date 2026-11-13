from decimal import Decimal
from uuid import UUID

from sqlalchemy.orm import Session

from app.orders import repository as orders_repo
from app.pricing import calculator as money_calc
from app.shifts import repository as repo


def calculate_expected_cash(
    db: Session, *, tenant_id: UUID, shift_id: str | UUID
) -> Decimal:
    """
    Calculate the cash that should be in the drawer for this shift.

    Expected = opening_balance + cash_sales + cash_in - cash_out - refund_payout

    cash_sales is the cash collected from sales rung in this shift (cash portion
    of split payments only). Without it every shift with cash sales reported a
    false overage equal to the day's takings. This matches the cashier-facing
    promise: "Efectivo inicial + ventas en efectivo + entradas − salidas."
    """
    shift_uuid = UUID(shift_id) if isinstance(shift_id, str) else shift_id

    sums = repo.get_cash_movement_sums(db, shift_id=shift_uuid)
    zero = Decimal(0)
    cash_in = sums.get("cash_in", zero)
    cash_out = sums.get("cash_out", zero)
    refund_payout = sums.get("refund_payout", zero)
    opening = sums.get("opening_balance", zero)
    cash_sales = orders_repo.cash_sales_total_for_shift(
        db, tenant_id=tenant_id, shift_id=shift_uuid
    )

    expected = money_calc.money(opening + cash_sales + cash_in - cash_out - refund_payout)
    return expected


def determine_reconciliation(
    actual: Decimal, expected: Decimal
) -> tuple[str, Decimal]:
    """
    Determine reconciliation status and variance.

    Returns: (status, variance) where status is 'balanced', 'overage', or 'shortage'
    """
    from app.pricing import calculator as money_calc

    variance = money_calc.money(actual - expected)

    if variance == Decimal("0.00"):
        status = "balanced"
    elif variance > Decimal("0.00"):
        status = "overage"
    else:
        status = "shortage"

    return status, variance
