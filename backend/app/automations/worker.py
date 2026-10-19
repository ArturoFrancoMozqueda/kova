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
    from sqlalchemy import or_, select

    from app.automations.models import AutomationRule
    from app.crm.engagement import process_due_followups
    from app.crm.engagement_models import FollowupPolicy
    from app.loyalty.models import LoyaltyPolicyRevision
    from app.loyalty.service import process as process_loyalty
    from app.messaging.models import Message
    from app.messaging.service import recover_uncertain

    tenant_id = UUID(str(tenant_id))
    processed = 0
    with SessionLocal() as db:
        set_tenant_context(db, tenant_id)
        branches = (
            db.query(Branch.id)
            .filter(Branch.tenant_id == tenant_id, or_(
                Branch.id.in_(select(AutomationRule.branch_id).where(
                    AutomationRule.tenant_id == tenant_id)),
                Branch.id.in_(select(FollowupPolicy.branch_id).where(
                    FollowupPolicy.tenant_id == tenant_id)),
                Branch.id.in_(select(LoyaltyPolicyRevision.branch_id).where(
                    LoyaltyPolicyRevision.tenant_id == tenant_id)),
                Branch.id.in_(select(Message.branch_id).where(
                    Message.tenant_id == tenant_id, Message.state == "sending")),
            ))
            .order_by(Branch.id)
            .all()
        )
        for (branch_id,) in branches:
            bind_branch(db, tenant_id=tenant_id, branch_id=branch_id)
            result = process_pending(db, tenant_id=tenant_id, branch_id=branch_id, limit=limit)
            followups = process_due_followups(db, tenant_id, limit=limit)
            # Recovery is branch-scoped too, including branches with no rule or
            # post-sale policy. Never retry an external effect automatically.
            recover_uncertain(db, tenant_id=tenant_id, limit=limit)
            loyalty = process_loyalty(db, tenant_id, limit=limit)
            db.commit()
            processed += result["processed"] + followups + loyalty
    return processed
