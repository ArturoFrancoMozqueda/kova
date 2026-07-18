from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Response
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.billing.access import require_commercial_access
from app.db import get_db
from app.expenses import service
from app.expenses.schemas import ExpenseCreate, ExpenseResponse, ExpenseUpdate
from app.rbac.permissions import Permission
from app.shared.exceptions import bad_request

router = APIRouter(prefix="/api/v1/expenses", tags=["expenses"])


def _idempotency_key(
    value: str | None = Header(default=None, alias="Idempotency-Key"),
) -> str:
    if not value:
        raise bad_request("Idempotency-Key header is required")
    return value


@router.get("", response_model=list[ExpenseResponse])
def list_expenses(
    start_date: date | None = None,
    end_date: date | None = None,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.EXPENSES_MANAGE)
    ),
):
    _, membership, _ = ctx
    return service.list_expenses(
        db,
        tenant_id=membership.tenant_id,
        start_date=start_date,
        end_date=end_date,
    )


@router.post("", response_model=ExpenseResponse, status_code=201)
def create_expense(
    body: ExpenseCreate,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.EXPENSES_MANAGE)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.create_expense(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        body=body,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body


@router.patch("/{expense_id}", response_model=ExpenseResponse)
def update_expense(
    expense_id: UUID,
    body: ExpenseUpdate,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.EXPENSES_MANAGE)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.update_expense(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        expense_id=expense_id,
        body=body,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body


@router.delete("/{expense_id}", response_model=ExpenseResponse)
def delete_expense(
    expense_id: UUID,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.EXPENSES_MANAGE)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.delete_expense(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        expense_id=expense_id,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body
