import hashlib
import json
from datetime import date
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.expenses import repository as repo
from app.expenses.models import Expense
from app.expenses.schemas import ExpenseCreate, ExpenseResponse, ExpenseUpdate
from app.idempotency import service as idempotency_service
from app.shared.exceptions import bad_request, not_found


def _hash_payload(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def _stored_response(
    db: Session, *, tenant_id: UUID, key: str, payload: dict[str, Any]
) -> tuple[int, dict[str, Any]] | None:
    existing = idempotency_service.claim(
        db,
        tenant_id=tenant_id,
        key=key,
        request_hash=_hash_payload(payload),
    )
    if not existing:
        return None
    return existing.response_status or 200, existing.response_body or {}


def _store_response(
    db: Session,
    *,
    tenant_id: UUID,
    key: str,
    payload: dict[str, Any],
    status_code: int,
    response_body: dict[str, Any],
) -> None:
    idempotency_service.store(
        db,
        tenant_id=tenant_id,
        key=key,
        request_hash=_hash_payload(payload),
        response_status=status_code,
        response_body=response_body,
    )


def _body(expense: Expense) -> dict[str, Any]:
    # Use the same DTO as reads, including canonical timestamps after DB reload.
    return ExpenseResponse.model_validate(expense).model_dump(mode="json")


def list_expenses(
    db: Session,
    *,
    tenant_id: UUID,
    start_date: date | None,
    end_date: date | None,
) -> list[Expense]:
    if start_date and end_date and start_date > end_date:
        raise bad_request("La fecha inicial no puede ser posterior a la fecha final")
    return repo.list_expenses(
        db, tenant_id=tenant_id, start_date=start_date, end_date=end_date
    )


def create_expense(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    body: ExpenseCreate,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = body.model_dump(mode="json")
    stored = _stored_response(
        db, tenant_id=tenant_id, key=idempotency_key, payload=payload
    )
    if stored:
        return stored
    expense = Expense(
        tenant_id=tenant_id,
        category=body.category,
        amount=body.amount,
        expense_date=body.expense_date,
        note=body.note,
        created_by_user_id=user_id,
    )
    db.add(expense)
    db.flush()
    response_body = _body(expense)
    audit_service.log(
        db,
        action="expense.create",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="expense",
        resource_id=expense.id,
        changes=response_body,
    )
    _store_response(
        db,
        tenant_id=tenant_id,
        key=idempotency_key,
        payload=payload,
        status_code=201,
        response_body=response_body,
    )
    db.commit()
    return 201, response_body


def update_expense(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    expense_id: UUID,
    body: ExpenseUpdate,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    changes = body.model_dump(mode="json", exclude_unset=True)
    payload = {"expense_id": str(expense_id), **changes}
    stored = _stored_response(
        db, tenant_id=tenant_id, key=idempotency_key, payload=payload
    )
    if stored:
        return stored
    expense = repo.get_expense(db, tenant_id=tenant_id, expense_id=expense_id)
    if not expense:
        raise not_found("Gasto no encontrado")
    for field in ("category", "amount", "expense_date", "note"):
        if field in body.model_fields_set:
            setattr(expense, field, getattr(body, field))
    db.flush()
    response_body = _body(expense)
    audit_service.log(
        db,
        action="expense.update",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="expense",
        resource_id=expense.id,
        changes=changes,
    )
    _store_response(
        db,
        tenant_id=tenant_id,
        key=idempotency_key,
        payload=payload,
        status_code=200,
        response_body=response_body,
    )
    db.commit()
    return 200, response_body


def delete_expense(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    expense_id: UUID,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = {"expense_id": str(expense_id)}
    stored = _stored_response(
        db, tenant_id=tenant_id, key=idempotency_key, payload=payload
    )
    if stored:
        return stored
    expense = repo.get_expense(db, tenant_id=tenant_id, expense_id=expense_id)
    if not expense:
        raise not_found("Gasto no encontrado")
    response_body = _body(expense)
    repo.delete_expense(db, expense=expense)
    audit_service.log(
        db,
        action="expense.delete",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="expense",
        resource_id=expense.id,
        changes=response_body,
    )
    _store_response(
        db,
        tenant_id=tenant_id,
        key=idempotency_key,
        payload=payload,
        status_code=200,
        response_body=response_body,
    )
    db.commit()
    return 200, response_body
