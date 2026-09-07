import hashlib
import json
from typing import Any
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.idempotency import service as idempotency_service
from app.pricing import calculator as money_calc
from app.shared.exceptions import bad_request, conflict, not_found
from app.shifts import calculator
from app.shifts import repository as repo
from app.shifts.models import Shift
from app.shifts.schemas import CashMovementCreate, ShiftCloseCreate, ShiftOpenCreate


def _hash_payload(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def _stored_response(
    db: Session, *, tenant_id: UUID, idempotency_key: str, payload: dict[str, Any]
) -> tuple[int, dict[str, Any]] | None:
    existing = idempotency_service.claim(
        db,
        tenant_id=tenant_id,
        key=idempotency_key,
        request_hash=_hash_payload(payload),
    )
    if not existing:
        return None
    return existing.response_status or 200, existing.response_body or {}


def _store_response(
    db: Session,
    *,
    tenant_id: UUID,
    idempotency_key: str,
    payload: dict[str, Any],
    status_code: int,
    response_body: dict[str, Any],
) -> None:
    idempotency_service.store(
        db,
        tenant_id=tenant_id,
        key=idempotency_key,
        request_hash=_hash_payload(payload),
        response_status=status_code,
        response_body=response_body,
    )


def _shift_body(db: Session, *, shift: Shift) -> dict[str, Any]:
    movements = repo.list_cash_movements(db, shift_id=shift.id)
    # For an open shift, expose the live expected cash (incl. cash sales) so the
    # running total and the close preview are correct. A closed shift keeps the
    # value computed and frozen at close time.
    if shift.status == "open":
        expected_cash_amount = str(
            calculator.calculate_expected_cash(
                db, tenant_id=shift.tenant_id, shift_id=shift.id
            )
        )
    elif shift.expected_cash_amount is not None:
        expected_cash_amount = str(shift.expected_cash_amount)
    else:
        expected_cash_amount = None
    return {
        "id": str(shift.id),
        "tenant_id": str(shift.tenant_id),
        "status": shift.status,
        "opening_cash_amount": (
            str(shift.opening_cash_amount) if shift.opening_cash_amount is not None else None
        ),
        "actual_cash_amount": (
            str(shift.actual_cash_amount) if shift.actual_cash_amount is not None else None
        ),
        "expected_cash_amount": expected_cash_amount,
        "reconciliation_status": shift.reconciliation_status,
        "variance_amount": (
            str(shift.variance_amount) if shift.variance_amount is not None else None
        ),
        "opened_at": shift.opened_at.isoformat(),
        "closed_at": shift.closed_at.isoformat() if shift.closed_at else None,
        "movements": [
            {
                "id": str(m.id),
                "shift_id": str(m.shift_id),
                "type": m.type,
                "amount": str(m.amount),
                "reason": m.reason,
                "created_at": m.created_at.isoformat(),
            }
            for m in movements
        ],
    }


def open_shift(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    body: ShiftOpenCreate,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = body.model_dump(mode="json")
    stored = _stored_response(
        db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload
    )
    if stored:
        return stored

    existing_open = repo.get_open_shift(db, tenant_id=tenant_id)
    if existing_open:
        raise bad_request("A shift is already open for this tenant")

    opening_cash = (
        money_calc.money(body.opening_cash_amount)
        if body.opening_cash_amount is not None
        else None
    )

    # The app-level check above loses a race between two concurrent opens: both
    # can read "no open shift" and both insert. The partial unique index
    # (uq_one_open_shift_per_tenant) is the real backstop — catch its violation
    # and return 409 so exactly one open shift can ever exist per tenant.
    try:
        shift = repo.create_shift(
            db,
            tenant_id=tenant_id,
            user_id=user_id,
            opening_cash_amount=opening_cash,
        )
    except IntegrityError as exc:
        db.rollback()
        raise conflict("A shift is already open for this tenant") from exc

    if opening_cash is not None:
        repo.create_cash_movement(
            db,
            tenant_id=tenant_id,
            shift_id=shift.id,
            type="opening_balance",
            amount=opening_cash,
            reason="Opening balance",
            user_id=user_id,
        )

    response_body = _shift_body(db, shift=shift)
    audit_service.log(
        db,
        action="shifts.open",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="shift",
        resource_id=shift.id,
        changes=response_body,
    )
    _store_response(
        db,
        tenant_id=tenant_id,
        idempotency_key=idempotency_key,
        payload=payload,
        status_code=201,
        response_body=response_body,
    )
    db.commit()
    return 201, response_body


def get_open_shift(db: Session, *, tenant_id: UUID) -> dict[str, Any] | None:
    shift = repo.get_open_shift(db, tenant_id=tenant_id)
    if not shift:
        return None
    return _shift_body(db, shift=shift)


def get_shift(db: Session, *, tenant_id: UUID, shift_id: UUID) -> dict[str, Any]:
    shift = repo.get_shift(db, tenant_id=tenant_id, shift_id=shift_id)
    if not shift:
        raise not_found("Shift not found")
    return _shift_body(db, shift=shift)


def list_closed_shifts(db: Session, *, tenant_id: UUID) -> list[dict[str, Any]]:
    shifts = repo.list_closed_shifts(db, tenant_id=tenant_id)
    return [_shift_body(db, shift=s) for s in shifts]


def close_shift(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    shift_id: UUID,
    body: ShiftCloseCreate,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = body.model_dump(mode="json")
    payload["shift_id"] = str(shift_id)
    stored = _stored_response(
        db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload
    )
    if stored:
        return stored

    shift = repo.get_shift(db, tenant_id=tenant_id, shift_id=shift_id)
    if not shift:
        raise not_found("Shift not found")

    if shift.status == "closed":
        raise bad_request("Shift is already closed")

    actual_cash = money_calc.money(body.actual_cash_amount)
    expected_cash = calculator.calculate_expected_cash(
        db, tenant_id=tenant_id, shift_id=shift_id
    )
    status, variance = calculator.determine_reconciliation(actual_cash, expected_cash)

    shift = repo.close_shift(
        db,
        shift=shift,
        user_id=user_id,
        actual_cash_amount=actual_cash,
        expected_cash_amount=expected_cash,
        reconciliation_status=status,
        variance_amount=variance,
    )

    response_body = _shift_body(db, shift=shift)
    audit_service.log(
        db,
        action="shifts.close",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="shift",
        resource_id=shift.id,
        changes=response_body,
    )
    _store_response(
        db,
        tenant_id=tenant_id,
        idempotency_key=idempotency_key,
        payload=payload,
        status_code=201,
        response_body=response_body,
    )
    db.commit()
    return 201, response_body


def record_cash_movement(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    shift_id: UUID,
    body: CashMovementCreate,
) -> tuple[int, dict[str, Any]]:
    shift = repo.get_shift(db, tenant_id=tenant_id, shift_id=shift_id)
    if not shift:
        raise not_found("Shift not found")

    if shift.status == "closed":
        raise bad_request("Cannot record cash movements for a closed shift")

    amount = money_calc.money(body.amount)
    movement = repo.create_cash_movement(
        db,
        tenant_id=tenant_id,
        shift_id=shift_id,
        type=body.type,
        amount=amount,
        reason=body.reason,
        user_id=user_id,
    )

    response_body = {
        "id": str(movement.id),
        "shift_id": str(movement.shift_id),
        "type": movement.type,
        "amount": str(movement.amount),
        "reason": movement.reason,
        "created_at": movement.created_at.isoformat(),
    }

    audit_service.log(
        db,
        action="shifts.cash_movement",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="cash_movement",
        resource_id=movement.id,
        changes=response_body,
    )
    db.commit()
    return 201, response_body
