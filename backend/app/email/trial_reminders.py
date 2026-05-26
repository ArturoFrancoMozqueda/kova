"""Send trial-ending reminder emails ~3 days before trial expiry.

Designed to be invoked from an external scheduler (e.g. cron, Render
cron job, GitHub Actions). Idempotent per tenant via
`tenants.trial_reminder_sent_at` so duplicate runs in the same window
do not re-send.

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
from app.billing.models import Subscription
from app.config import settings
from app.email import service as email_service
from app.tenants.models import Tenant

logger = logging.getLogger(__name__)

REMINDER_LEAD_DAYS = 3
# Window: any tenant whose trial ends within [now + LEAD d, now + (LEAD+1) d]
# gets a reminder. A one-day window plus the sent-at idempotency guard
# means a daily cron catches every tenant exactly once.
REMINDER_WINDOW_HOURS = 24


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
    if subscription and subscription.status == "trialing" and subscription.trial_ends_at:
        return subscription.trial_ends_at
    if subscription is None or subscription.status == "incomplete":
        return tenant.created_at + timedelta(days=settings.billing_trial_days)
    return None


def send_due_trial_reminders(db: Session, *, now: datetime | None = None) -> int:
    """Send a reminder to every tenant whose trial ends within the window.

    Returns the count of reminders sent. Commits after each tenant so a
    crash mid-batch does not re-spam everyone.
    """
    now = now or datetime.now(UTC)
    window_start = now + timedelta(days=REMINDER_LEAD_DAYS)
    window_end = window_start + timedelta(hours=REMINDER_WINDOW_HOURS)

    sent = 0
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
        if not (window_start <= trial_end <= window_end):
            continue
        email = _owner_email(db, tenant_id=tenant.id)
        if not email:
            continue
        email_service.send_trial_ending_email(
            to=email, trial_ends_iso=trial_end.strftime("%Y-%m-%d")
        )
        tenant.trial_reminder_sent_at = now
        db.commit()
        sent += 1
        logger.info(
            "trial_reminder.sent tenant_id=%s trial_ends=%s",
            tenant.id,
            trial_end.isoformat(),
        )
    return sent
