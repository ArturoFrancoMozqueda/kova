from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.auth.models import Membership, User, UserSession
from app.billing import repository as billing_repo
from app.billing.schemas import BILLING_PERIOD_FRESHNESS_MAX_AGE
from app.billing.stripe_client import StripeSubscriptionError
from app.config import settings
from app.db import get_db
from app.rbac.permissions import Permission, has_permission
from app.shared.dependencies import get_current_session
from app.shared.exceptions import forbidden, payment_required
from app.tenants import repository as tenant_repo

BILLING_RECOVERY_PATH = "/settings/billing"
BILLING_ACCESS_BLOCKED_DETAIL = "Billing access is required to continue using this POS feature"
BILLING_MAX_GRACE_DAYS = 2


@dataclass(frozen=True)
class BillingAccessStatus:
    allowed: bool
    reason: str
    trialing: bool
    trial_ends_at: datetime | None
    blocked_at: datetime | None
    recovery_path: str
    # Set only while in the past_due grace window, so the UI can show urgency
    # ("te quedan X días"). None in every other state.
    grace_period_ends_at: datetime | None = None
    valid_until: datetime | None = None


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _subscription_valid_until(subscription) -> datetime | None:
    observed = subscription.updated_at
    if observed is None:
        return None
    observed = _as_utc(observed)
    if observed > datetime.now(UTC):
        return None
    if subscription.status == "past_due":
        boundary = _grace_deadline(subscription)
    elif subscription.status == "trialing":
        boundary = subscription.trial_ends_at or subscription.current_period_end
    else:
        boundary = subscription.current_period_end
    if boundary is None:
        return None
    return min(observed + BILLING_PERIOD_FRESHNESS_MAX_AGE, _as_utc(boundary))


def _grace_deadline(subscription) -> datetime | None:
    if subscription.grace_period_ends_at is None:
        return None
    first_failure = subscription.past_due_at
    if first_failure is None:
        return None
    return min(_as_utc(subscription.grace_period_ends_at),
               _as_utc(first_failure) + timedelta(days=BILLING_MAX_GRACE_DAYS))


def _verification_required(now: datetime) -> BillingAccessStatus:
    return BillingAccessStatus(
        allowed=False, reason="verification_required", trialing=False,
        trial_ends_at=None, blocked_at=now, recovery_path=BILLING_RECOVERY_PATH,
    )


def get_billing_access_status(db: Session, *, tenant_id: UUID) -> BillingAccessStatus:
    now = datetime.now(UTC)
    subscription = billing_repo.get_subscription_by_tenant(db, tenant_id=tenant_id)

    if subscription:
        status = subscription.status
        # Courtesy trials have no Stripe lifecycle webhook to expire them.
        # Require a finite end date; Stripe-managed trials keep their existing policy.
        if status == "trialing" and not subscription.stripe_subscription_id:
            trial_end = (
                _as_utc(subscription.trial_ends_at) if subscription.trial_ends_at else None
            )
            if trial_end is None or trial_end <= now:
                return BillingAccessStatus(
                    allowed=False,
                    reason="trial_expired",
                    trialing=False,
                    trial_ends_at=trial_end,
                    blocked_at=now,
                    recovery_path=BILLING_RECOVERY_PATH,
                )
            return BillingAccessStatus(
                allowed=True, reason="trialing", trialing=True, trial_ends_at=trial_end,
                blocked_at=None, recovery_path=BILLING_RECOVERY_PATH, valid_until=trial_end,
            )
        potentially_allowed = status in {"active", "trialing"} or (
            status == "past_due" and _grace_deadline(subscription) is not None
            and _grace_deadline(subscription) > now
        )
        valid_until = _subscription_valid_until(subscription)
        if potentially_allowed and (valid_until is None or valid_until <= now):
            from app.billing.service import refresh_subscription_access_snapshot

            try:
                subscription = refresh_subscription_access_snapshot(db, tenant_id=tenant_id)
            except (StripeSubscriptionError, HTTPException):
                return _verification_required(now)
            if subscription is None:
                return _verification_required(now)
            status = subscription.status
            valid_until = _subscription_valid_until(subscription)
        if status in {"active", "trialing"}:
            if valid_until is None or valid_until <= now:
                return _verification_required(now)
            return BillingAccessStatus(
                allowed=True,
                reason=status,
                trialing=status == "trialing",
                trial_ends_at=subscription.trial_ends_at,
                blocked_at=None,
                recovery_path=BILLING_RECOVERY_PATH,
                valid_until=valid_until,
            )
        if status == "past_due" and subscription.grace_period_ends_at:
            grace_ends_at = _grace_deadline(subscription)
            if grace_ends_at is None:
                return _verification_required(now)
            if grace_ends_at > now:
                if valid_until is None or valid_until <= now:
                    return _verification_required(now)
                return BillingAccessStatus(
                    allowed=True,
                    reason="past_due_grace",
                    trialing=False,
                    trial_ends_at=None,
                    blocked_at=None,
                    recovery_path=BILLING_RECOVERY_PATH,
                    grace_period_ends_at=grace_ends_at,
                    valid_until=valid_until,
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
    if trial_ends_at > now:
        return BillingAccessStatus(
            allowed=True,
            reason="signup_trial",
            trialing=True,
            trial_ends_at=trial_ends_at,
            blocked_at=None,
            recovery_path=BILLING_RECOVERY_PATH,
            valid_until=trial_ends_at,
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
        "grace_period_ends_at": status.grace_period_ends_at,
        "valid_until": status.valid_until,
    }


def enforce_commercial_access(db: Session, *, request: Request, user, membership) -> None:
    status = get_billing_access_status(db, tenant_id=membership.tenant_id)
    if status.allowed:
        return
    audit_service.log(
        db, action="billing.access_blocked", tenant_id=membership.tenant_id,
        user_id=user.id, resource_type="billing_access",
        changes={"reason": status.reason, "path": request.url.path,
                 "method": request.method, "role": membership.role},
    )
    db.commit()
    raise payment_required({
        "message": BILLING_ACCESS_BLOCKED_DETAIL,
        "reason": status.reason,
        "recovery_path": status.recovery_path,
    })


def require_commercial_access(permission: Permission):
    def dependency(
        request: Request,
        db: Session = Depends(get_db),
        ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
    ) -> tuple[User, Membership, UserSession]:
        user, membership, _ = ctx
        if not has_permission(membership.role, permission):
            raise forbidden()

        enforce_commercial_access(db, request=request, user=user, membership=membership)
        return ctx

    dependency.commercial_policy_permission = permission
    return dependency
