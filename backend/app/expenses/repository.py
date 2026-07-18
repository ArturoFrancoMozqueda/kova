from datetime import date
from uuid import UUID

from sqlalchemy.orm import Session

from app.expenses.models import Expense


def list_expenses(
    db: Session,
    *,
    tenant_id: UUID,
    start_date: date | None = None,
    end_date: date | None = None,
) -> list[Expense]:
    query = db.query(Expense).filter(Expense.tenant_id == tenant_id)
    if start_date is not None:
        query = query.filter(Expense.expense_date >= start_date)
    if end_date is not None:
        query = query.filter(Expense.expense_date <= end_date)
    return query.order_by(Expense.expense_date.desc(), Expense.created_at.desc()).all()


def get_expense(db: Session, *, tenant_id: UUID, expense_id: UUID) -> Expense | None:
    return (
        db.query(Expense)
        .filter(Expense.tenant_id == tenant_id, Expense.id == expense_id)
        .first()
    )


def delete_expense(db: Session, *, expense: Expense) -> None:
    db.delete(expense)
