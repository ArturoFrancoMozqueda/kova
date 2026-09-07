from uuid import UUID

from fastapi import APIRouter, Depends, Header, Response
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.billing.access import require_commercial_access
from app.db import get_db
from app.rbac.permissions import Permission
from app.shared.dependencies import get_current_session
from app.shared.exceptions import bad_request
from app.shifts import service
from app.shifts.schemas import CashMovementCreate, ShiftCloseCreate, ShiftOpenCreate

router = APIRouter(prefix="/api/v1/shifts", tags=["shifts"])


def _idempotency_key(value: str | None = Header(default=None, alias="Idempotency-Key")) -> str:
    if not value:
        raise bad_request("Idempotency-Key header is required")
    return value


@router.post("", status_code=201)
def open_shift(
    body: ShiftOpenCreate,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.SHIFTS_OPEN)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.open_shift(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        body=body,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body


@router.get("/current")
def get_current_shift(
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    _, membership, _ = ctx
    return service.get_open_shift(db, tenant_id=membership.tenant_id)


@router.get("")
def list_closed(
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    _, membership, _ = ctx
    return service.list_closed_shifts(db, tenant_id=membership.tenant_id)


@router.get("/{shift_id}")
def get_shift(
    shift_id: UUID,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    _, membership, _ = ctx
    return service.get_shift(db, tenant_id=membership.tenant_id, shift_id=shift_id)


@router.post("/{shift_id}/close", status_code=201)
def close_shift(
    shift_id: UUID,
    body: ShiftCloseCreate,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.SHIFTS_CLOSE)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.close_shift(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        shift_id=shift_id,
        body=body,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body


@router.post("/{shift_id}/cash-movements", status_code=201)
def record_movement(
    shift_id: UUID,
    body: CashMovementCreate,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.SHIFTS_OPEN)
    ),
):
    user, membership, _ = ctx
    _, response_body = service.record_cash_movement(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        shift_id=shift_id,
        body=body,
        idempotency_key=idempotency_key,
    )
    return response_body


@router.get("/{shift_id}/cash-movements")
def list_movements(
    shift_id: UUID,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    _, membership, _ = ctx
    shift = service.get_shift(db, tenant_id=membership.tenant_id, shift_id=shift_id)
    return shift["movements"]
