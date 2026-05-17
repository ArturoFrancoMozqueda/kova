from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.auth.models import Membership, User, UserSession
from app.billing import repository as billing_repo
from app.config import settings
from app.db import get_db
from app.rbac.permissions import Permission, has_permission
from app.shared.dependencies import get_current_session
from app.shared.exceptions import forbidden, payment_required
from app.tenants import repository as tenant_repo

BILLING_RECOVERY_PATH = "/settings/billing"
BILLING_ACCESS_BLOCKED_DETAIL = "Billing access is required to continue using this POS feature"


@dataclass(frozen=True)
class BillingAccessStatus:
    allowed: bool
    reason: str
    trialing: bool
    trial_ends_at: datetime | None
    blocked_at: datetime | None
    recovery_path: str


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def get_billing_access_status(db: Session, *, tenant_id: UUID) -> BillingAccessStatus:
    now = datetime.now(UTC)
    subscription = billing_repo.get_subscription_by_tenant(db, tenant_id=tenant_id)

    if subscription:
        status = subscription.status
        if status in {"active", "trialing"}:
            return BillingAccessStatus(
                allowed=True,
                reason=status,
                trialing=status == "trialing",
                trial_ends_at=subscription.trial_ends_at,
                blocked_at=None,
                recovery_path=BILLING_RECOVERY_PATH,
            )
        if status == "past_due" and subscription.grace_period_ends_at:
            grace_ends_at = _as_utc(subscription.grace_period_ends_at)
            if grace_ends_at >= now:
                return BillingAccessStatus(
                    allowed=True,
                    reason="past_due_grace",
                    trialing=False,
                    trial_ends_at=None,
                    blocked_at=None,
                    recovery_path=BILLING_RECOVERY_PATH,
                )
            return BillingAccessStatus(
                allowed=False,
                reason="past_due_grace_expired",
                trialing=False,
                trial_ends_at=None,
                blocked_at=now,
                recovery_path=BILLING_RECOVERY_PATH,
            )
        return BillingAccessStatus(
            allowed=False,
            reason=status,
            trialing=False,
            trial_ends_at=None,
            blocked_at=now,
            recovery_path=BILLING_RECOVERY_PATH,
        )

    tenant = tenant_repo.get_by_id(db, tenant_id)
    if not tenant:
        return BillingAccessStatus(
            allowed=False,
            reason="tenant_not_found",
            trialing=False,
            trial_ends_at=None,
            blocked_at=now,
            recovery_path=BILLING_RECOVERY_PATH,
        )

    trial_ends_at = _as_utc(tenant.created_at) + timedelta(days=settings.billing_trial_days)
    if trial_ends_at >= now:
        return BillingAccessStatus(
            allowed=True,
            reason="signup_trial",
            trialing=True,
            trial_ends_at=trial_ends_at,
            blocked_at=None,
            recovery_path=BILLING_RECOVERY_PATH,
        )

    return BillingAccessStatus(
        allowed=False,
        reason="trial_expired",
        trialing=False,
        trial_ends_at=trial_ends_at,
        blocked_at=now,
        recovery_path=BILLING_RECOVERY_PATH,
    )


def serialize_billing_access(status: BillingAccessStatus) -> dict:
    return {
        "allowed": status.allowed,
        "reason": status.reason,
        "trialing": status.trialing,
        "trial_ends_at": status.trial_ends_at,
        "blocked_at": status.blocked_at,
        "recovery_path": status.recovery_path,
    }


def require_commercial_access(permission: Permission):
    def dependency(
        request: Request,
        db: Session = Depends(get_db),
        ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
    ) -> tuple[User, Membership, UserSession]:
        user, membership, _ = ctx
        if not has_permission(membership.role, permission):
            raise forbidden()

        status = get_billing_access_status(db, tenant_id=membership.tenant_id)
        if status.allowed:
            return ctx

        audit_service.log(
            db,
            action="billing.access_blocked",
            tenant_id=membership.tenant_id,
            user_id=user.id,
            resource_type="billing_access",
            changes={
                "reason": status.reason,
                "path": request.url.path,
                "method": request.method,
                "role": membership.role,
            },
        )
        db.commit()
        raise payment_required(
            {
                "message": BILLING_ACCESS_BLOCKED_DETAIL,
                "reason": status.reason,
                "recovery_path": status.recovery_path,
            }
        )

    return dependency
