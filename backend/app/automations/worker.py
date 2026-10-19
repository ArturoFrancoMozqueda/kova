"""Bounded tenant automation processing using the ordinary RLS runtime role."""

from uuid import UUID

from app.automations.service import process_pending
from app.branches.models import Branch
from app.branches.scope import bind_branch
from app.db import SessionLocal, set_tenant_context


def process_tenant(tenant_id: UUID, *, limit: int = 100) -> int:
    """Process only the server-authorized tenant passed by the private scheduler.

    Tenant admission belongs to the scheduler's explicit cohort. This function
    never enumerates tenants or accesses a privileged connection. Work is grouped
    by branches with current rules; unconfigured branches cannot produce effects.
    """
    from app.automations.models import AutomationRule

    tenant_id = UUID(str(tenant_id))
    processed = 0
    with SessionLocal() as db:
        set_tenant_context(db, tenant_id)
        branches = (
            db.query(Branch.id)
            .join(
                AutomationRule,
                (AutomationRule.tenant_id == Branch.tenant_id)
                & (AutomationRule.branch_id == Branch.id),
            )
            .filter(Branch.tenant_id == tenant_id)
            .distinct()
            .order_by(Branch.id)
            .all()
        )
        for (branch_id,) in branches:
            bind_branch(db, tenant_id=tenant_id, branch_id=branch_id)
            result = process_pending(db, tenant_id=tenant_id, branch_id=branch_id, limit=limit)
            db.commit()
            processed += result["processed"]
    return processed
