"""Additional operating scope within a tenant; tenant RLS remains authoritative.

Only the authenticated dependency binds a browser-selected branch after verifying
its tenant. Operational ORM queries share this scope, including aggregate queries,
so a new report or inventory read cannot accidentally aggregate other drawers.
Privileged account exports/purges intentionally use tenant-wide SQL. A dedicated
reports endpoint temporarily clears branch scope after REPORTS_VIEW_ALL authorization.
"""

from contextlib import contextmanager
from uuid import UUID

from sqlalchemy import event, inspect
from sqlalchemy.orm import Mapped, Session, mapped_column, with_loader_criteria

from app.shared.exceptions import conflict, not_found

_SCOPE_KEY = "kova_branch_id"


def _principal_default(context):
    return context.get_current_parameters()["tenant_id"]


class BranchScoped:
    branch_id: Mapped[UUID] = mapped_column(nullable=False, default=_principal_default, index=True)


def active_branch_id(db: Session, tenant_id: UUID) -> UUID:
    return db.info.get(_SCOPE_KEY) or tenant_id


def bind_branch(db: Session, *, tenant_id: UUID, branch_id: UUID | None = None) -> UUID:
    from app.branches.models import Branch

    selected = branch_id or tenant_id
    branch = db.query(Branch).filter(Branch.tenant_id == tenant_id, Branch.id == selected).first()
    if branch is None:
        raise not_found("Sucursal no encontrada para este negocio")
    db.info[_SCOPE_KEY] = selected
    return selected


@contextmanager
def tenant_wide_branches(db: Session):
    previous = db.info.pop(_SCOPE_KEY, None)
    try:
        yield
    finally:
        if previous is not None:
            db.info[_SCOPE_KEY] = previous


@event.listens_for(Session, "do_orm_execute")
def _filter_branch(execute_state):
    branch_id = execute_state.session.info.get(_SCOPE_KEY)
    if branch_id is not None and execute_state.is_select:
        execute_state.statement = execute_state.statement.options(
            with_loader_criteria(
                BranchScoped, lambda model: model.branch_id == branch_id, include_aliases=True
            )
        )


@event.listens_for(Session, "before_flush")
def _stamp_branch(db: Session, _flush_context, _instances):
    selected = db.info.get(_SCOPE_KEY)
    for row in db.new:
        if isinstance(row, BranchScoped):
            expected = selected or row.tenant_id
            if row.branch_id is None:
                row.branch_id = expected
            elif row.branch_id != expected:
                raise conflict("La operación pertenece a otra sucursal")
    for row in db.dirty:
        if isinstance(row, BranchScoped):
            if inspect(row).attrs.branch_id.history.has_changes():
                raise conflict("La sucursal de una operación registrada no puede cambiar")
            if selected is not None and row.branch_id != selected:
                raise conflict("La operación pertenece a otra sucursal")
