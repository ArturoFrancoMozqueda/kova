from decimal import Decimal

from sqlalchemy.orm import Session

from app.pricing import calculator as money_calc
from app.shifts import repository as repo


def calculate_expected_cash(
    db: Session, *, shift_id: str
) -> Decimal:
    """
    Calculate expected cash amount based on shift movements.

    Expected = sum(opening_balance) + sum(cash_in) - sum(cash_out)
    """
    from uuid import UUID

    shift_uuid = UUID(shift_id)

    cash_in = repo.get_cash_movement_sum(db, shift_id=shift_uuid, type="cash_in")
    cash_out = repo.get_cash_movement_sum(db, shift_id=shift_uuid, type="cash_out")
    opening = repo.get_cash_movement_sum(db, shift_id=shift_uuid, type="opening_balance")

    expected = money_calc.money(opening + cash_in - cash_out)
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
