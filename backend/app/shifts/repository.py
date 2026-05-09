from decimal import Decimal
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.shifts.models import CashMovement, Shift


def get_open_shift(db: Session, *, tenant_id: UUID) -> Shift | None:
    return (
        db.query(Shift)
        .filter(Shift.tenant_id == tenant_id, Shift.status == "open")
        .first()
    )


def get_shift(db: Session, *, tenant_id: UUID, shift_id: UUID) -> Shift | None:
    return db.query(Shift).filter(Shift.tenant_id == tenant_id, Shift.id == shift_id).first()


def create_shift(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    opening_cash_amount: Decimal | None = None,
) -> Shift:
    shift = Shift(
        tenant_id=tenant_id,
        opened_by_user_id=user_id,
        status="open",
        opening_cash_amount=opening_cash_amount,
    )
    db.add(shift)
    db.flush()
    return shift


def close_shift(
    db: Session,
    *,
    shift: Shift,
    user_id: UUID,
    actual_cash_amount: Decimal,
    expected_cash_amount: Decimal,
    reconciliation_status: str,
    variance_amount: Decimal,
) -> Shift:
    from datetime import UTC, datetime

    shift.closed_by_user_id = user_id
    shift.status = "closed"
    shift.actual_cash_amount = actual_cash_amount
    shift.expected_cash_amount = expected_cash_amount
    shift.reconciliation_status = reconciliation_status
    shift.variance_amount = variance_amount
    shift.closed_at = datetime.now(UTC)
    db.add(shift)
    db.flush()
    return shift


def create_cash_movement(
    db: Session,
    *,
    tenant_id: UUID,
    shift_id: UUID,
    type: str,
    amount: Decimal,
    reason: str,
    user_id: UUID,
) -> CashMovement:
    movement = CashMovement(
        shift_id=shift_id,
        tenant_id=tenant_id,
        type=type,
        amount=amount,
        reason=reason,
        created_by_user_id=user_id,
    )
    db.add(movement)
    db.flush()
    return movement


def list_cash_movements(db: Session, *, shift_id: UUID) -> list[CashMovement]:
    return (
        db.query(CashMovement)
        .filter(CashMovement.shift_id == shift_id)
        .order_by(CashMovement.created_at)
        .all()
    )


def list_closed_shifts(db: Session, *, tenant_id: UUID, limit: int = 50) -> list[Shift]:
    return (
        db.query(Shift)
        .filter(Shift.tenant_id == tenant_id, Shift.status == "closed")
        .order_by(Shift.closed_at.desc())
        .limit(limit)
        .all()
    )


def get_cash_movement_sum(
    db: Session, *, shift_id: UUID, type: str
) -> Decimal:
    result = (
        db.query(func.sum(CashMovement.amount))
        .filter(CashMovement.shift_id == shift_id, CashMovement.type == type)
        .scalar()
    )
    return Decimal(result or 0)
