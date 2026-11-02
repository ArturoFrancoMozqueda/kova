"""Send trial-ending reminders and catch up missed sends before expiry.

Invoked by the GitHub Actions scheduler. Provider acceptance is marked per
tenant via `tenants.trial_reminder_sent_at` so later runs skip accepted sends.
There is no durable outbox or provider-level exactly-once guarantee.

Covers two trial sources:
  1. Signup-trial (no Stripe subscription yet) — expiry derived from
     ``tenant.created_at + settings.billing_trial_days``.
  2. Stripe ``trialing`` subscription — expiry from
     ``subscriptions.trial_ends_at``.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy.orm import Session

from app.auth.models import Membership, User
from app.billing.access import has_complimentary_access
from app.billing.models import Subscription
from app.config import settings
from app.email import service as email_service
from app.tenants.models import Tenant

logger = logging.getLogger(__name__)

REMINDER_LEAD_DAYS = 3
# Normally the daily run sends 3–4 days before expiry. A missed/failed run
# remains eligible until expiry; successful acceptance keeps the existing mark.
REMINDER_WINDOW_HOURS = 24


class TrialReminderBatchError(RuntimeError):
    """Aggregate failure without recipient addresses or provider exceptions."""

    def __init__(self, *, sent: int, failed: int) -> None:
        self.sent = sent
        self.failed = failed
        super().__init__(f"trial_reminder.batch_failed sent={sent} failed={failed}")


def _owner_email(db: Session, *, tenant_id: UUID) -> str | None:
    owner = (
        db.query(User)
        .join(Membership, Membership.user_id == User.id)
        .filter(
            Membership.tenant_id == tenant_id,
            Membership.role == "owner",
            Membership.is_active.is_(True),
            User.is_active.is_(True),
        )
        .order_by(Membership.created_at.asc())
        .first()
    )
    return owner.email if owner else None


def _trial_end_for_tenant(
    tenant: Tenant, subscription: Subscription | None
) -> datetime | None:
    if subscription and has_complimentary_access(subscription):
        return None
    if subscription and subscription.status == "trialing" and subscription.trial_ends_at:
        return subscription.trial_ends_at
    if subscription is None or subscription.status == "incomplete":
        return tenant.created_at + timedelta(days=settings.billing_trial_days)
    return None


def send_due_trial_reminders(db: Session, *, now: datetime | None = None) -> int:
    """Send a reminder to every tenant whose trial ends within the window.

    Returns accepted sends, or raises an aggregate failure after trying all
    eligible tenants. Each acceptance is committed before advancing, so a retry
    skips it while still retrying the failed recipients before their trial ends.
    """
    now = now or datetime.now(UTC)
    window_end = now + timedelta(days=REMINDER_LEAD_DAYS, hours=REMINDER_WINDOW_HOURS)

    sent = 0
    failed = 0
    tenants = (
        db.query(Tenant)
        .filter(Tenant.is_active.is_(True), Tenant.trial_reminder_sent_at.is_(None))
        .all()
    )
    for tenant in tenants:
        subscription = (
            db.query(Subscription).filter(Subscription.tenant_id == tenant.id).first()
        )
        # If they already have an active paid plan, do not pester them.
        if subscription and subscription.status in {"active", "past_due"}:
            continue
        trial_end = _trial_end_for_tenant(tenant, subscription)
        if trial_end is None:
            continue
        if not (now < trial_end <= window_end):
            continue
        email = _owner_email(db, tenant_id=tenant.id)
        if not email:
            continue
        delivered = email_service.send_trial_ending_email(
            to=email, trial_ends_iso=trial_end.strftime("%Y-%m-%d")
        )
        if not delivered:
            failed += 1
            logger.warning(
                "trial_reminder.delivery_failed tenant_id=%s trial_ends=%s",
                tenant.id,
                trial_end.isoformat(),
            )
            continue
        tenant.trial_reminder_sent_at = now
        db.commit()
        sent += 1
        logger.info(
            "trial_reminder.sent tenant_id=%s trial_ends=%s",
            tenant.id,
            trial_end.isoformat(),
        )
    if failed:
        raise TrialReminderBatchError(sent=sent, failed=failed)
    return sent
