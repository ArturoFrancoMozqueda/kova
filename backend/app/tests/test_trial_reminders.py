import importlib.util
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.billing.models import Subscription
from app.config import settings
from app.email import service as email_service
from app.email import trial_reminders
from app.tenants.models import Tenant

# Password cost is incidental to these business scenarios; real auth routes stay active.
pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _signup_verify(client: TestClient, email: str, tenant_name: str) -> dict:
    response = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "S3cur3pass!", "tenant_name": tenant_name, "accepted_terms": True},
    )
    assert response.status_code == 201, response.text
    signup = response.json()
    verify = client.post("/api/v1/auth/verify", json={"token": signup["dev_verification_token"]})
    assert verify.status_code == 200, verify.text
    return signup


def _set_tenant_created_at(db: Session, tenant_id: str, created_at: datetime) -> None:
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    assert tenant is not None
    tenant.created_at = created_at
    tenant.trial_reminder_sent_at = None
    db.flush()


def test_signup_trial_reminder_fires_three_days_before_expiry(
    client: TestClient, db: Session, monkeypatch
) -> None:
    email = f"trial-{uuid4().hex}@example.com"
    signup = _signup_verify(client, email, "Trial Tenant")

    # billing_trial_days defaults to 7; place created_at so trial ends in ~3.5d
    now = datetime.now(UTC)
    created_at = now - timedelta(days=settings.billing_trial_days) + timedelta(
        days=3, hours=12
    )
    _set_tenant_created_at(db, signup["tenant_id"], created_at)

    sent: list[dict] = []
    monkeypatch.setattr(
        email_service,
        "send_trial_ending_email",
        lambda **kwargs: sent.append(kwargs) or True,
    )
    monkeypatch.setattr(
        trial_reminders.email_service,
        "send_trial_ending_email",
        lambda **kwargs: sent.append(kwargs) or True,
    )

    count = trial_reminders.send_due_trial_reminders(db, now=now)
    assert count == 1
    assert sent[0]["to"] == email

    # Idempotency: a second pass should not re-send.
    sent.clear()
    count2 = trial_reminders.send_due_trial_reminders(db, now=now)
    assert count2 == 0
    assert sent == []


def test_trial_reminder_skips_tenants_outside_window(
    client: TestClient, db: Session, monkeypatch
) -> None:
    signup = _signup_verify(
        client, f"early-{uuid4().hex}@example.com", "Early Tenant"
    )
    now = datetime.now(UTC)
    # Trial ends in 6 days — outside the 2-3 day window.
    created_at = now - timedelta(days=1)
    _set_tenant_created_at(db, signup["tenant_id"], created_at)

    sent: list[dict] = []
    monkeypatch.setattr(
        trial_reminders.email_service,
        "send_trial_ending_email",
        lambda **kwargs: sent.append(kwargs) or True,
    )

    count = trial_reminders.send_due_trial_reminders(db, now=now)
    assert count == 0
    assert sent == []


def _load_reminder_script():
    script_path = Path(__file__).resolve().parents[2] / "scripts" / "send_trial_reminders.py"
    spec = importlib.util.spec_from_file_location("send_trial_reminders_script", script_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_reminder_script_entrypoint_runs_a_dry_pass(monkeypatch) -> None:
    """The scheduled cron entrypoint wires the reminder job and exits cleanly.

    Stubs the actual sender so the smoke test doesn't depend on live email or
    DB rows — it only proves `main()` invokes the job and returns success."""
    module = _load_reminder_script()
    calls: list[object] = []
    monkeypatch.setattr(
        module,
        "send_due_trial_reminders",
        lambda db, **kwargs: calls.append(db) or 0,
    )

    assert module.main() == 0
    assert len(calls) == 1


def test_trial_reminder_skips_active_subscribers(
    client: TestClient, db: Session, monkeypatch
) -> None:
    signup = _signup_verify(
        client, f"active-{uuid4().hex}@example.com", "Active Tenant"
    )
    now = datetime.now(UTC)
    created_at = now - timedelta(days=settings.billing_trial_days) + timedelta(days=3)
    _set_tenant_created_at(db, signup["tenant_id"], created_at)

    # Insert an active subscription — should suppress reminder.
    db.add(
        Subscription(
            tenant_id=signup["tenant_id"],
            status="active",
            stripe_subscription_id=f"sub_{uuid4().hex}",
        )
    )
    db.flush()

    sent: list[dict] = []
    monkeypatch.setattr(
        trial_reminders.email_service,
        "send_trial_ending_email",
        lambda **kwargs: sent.append(kwargs) or True,
    )

    count = trial_reminders.send_due_trial_reminders(db, now=now)
    assert count == 0
    assert sent == []


def test_trial_reminder_does_not_mark_sent_when_delivery_fails(
    client: TestClient, db: Session, monkeypatch
) -> None:
    signup = _signup_verify(
        client, f"delivery-fail-{uuid4().hex}@example.com", "Delivery Fail Tenant"
    )
    now = datetime.now(UTC)
    created_at = now - timedelta(days=settings.billing_trial_days) + timedelta(
        days=3, hours=12
    )
    _set_tenant_created_at(db, signup["tenant_id"], created_at)

    monkeypatch.setattr(
        trial_reminders.email_service,
        "send_trial_ending_email",
        lambda **kwargs: False,
    )

    with pytest.raises(trial_reminders.TrialReminderBatchError) as failure:
        trial_reminders.send_due_trial_reminders(db, now=now)

    assert failure.value.sent == 0
    assert failure.value.failed == 1

    tenant = db.query(Tenant).filter(Tenant.id == signup["tenant_id"]).first()
    assert tenant is not None
    assert tenant.trial_reminder_sent_at is None


@pytest.mark.parametrize("status", ["incomplete", "trialing"])
def test_permanent_courtesy_never_receives_a_trial_reminder(
    client: TestClient, db: Session, monkeypatch, status: str
) -> None:
    signup = _signup_verify(client, f"courtesy-{uuid4().hex}@example.com", "Courtesy Tenant")
    now = datetime.now(UTC)
    _set_tenant_created_at(
        db, signup["tenant_id"], now - timedelta(days=settings.billing_trial_days - 3)
    )
    db.add(Subscription(
        tenant_id=signup["tenant_id"], status=status, complimentary_access=True,
        trial_ends_at=now + timedelta(days=3),
    ))
    db.flush()
    sent = []
    monkeypatch.setattr(email_service, "send_trial_ending_email", lambda **kw: sent.append(kw) or True)

    assert trial_reminders.send_due_trial_reminders(db, now=now) == 0
    assert sent == []


def test_failed_recipient_does_not_block_others_and_catches_up_next_day(
    client: TestClient, db: Session, monkeypatch
) -> None:
    failed_email = f"retry-{uuid4().hex}@example.com"
    accepted_email = f"accepted-{uuid4().hex}@example.com"
    now = datetime.now(UTC)
    created = now - timedelta(days=settings.billing_trial_days) + timedelta(days=3, hours=12)
    for email in (failed_email, accepted_email):
        signup = _signup_verify(client, email, "Reminder Recovery")
        _set_tenant_created_at(db, signup["tenant_id"], created)
    calls = []

    def partially_accept(**kwargs):
        calls.append(kwargs["to"])
        return kwargs["to"] != failed_email

    monkeypatch.setattr(email_service, "send_trial_ending_email", partially_accept)
    with pytest.raises(trial_reminders.TrialReminderBatchError) as failure:
        trial_reminders.send_due_trial_reminders(db, now=now)
    assert (failure.value.sent, failure.value.failed) == (1, 1)
    assert set(calls) == {failed_email, accepted_email}
    assert failed_email not in str(failure.value)
    assert accepted_email not in str(failure.value)

    calls.clear()
    monkeypatch.setattr(
        email_service, "send_trial_ending_email", lambda **kw: calls.append(kw["to"]) or True
    )
    assert trial_reminders.send_due_trial_reminders(db, now=now + timedelta(days=1)) == 1
    assert calls == [failed_email]
    calls.clear()
    assert trial_reminders.send_due_trial_reminders(db, now=now + timedelta(days=2)) == 0
    assert calls == []


def test_courtesy_flag_does_not_suppress_a_stripe_managed_trial(
    client: TestClient, db: Session, monkeypatch
) -> None:
    email = f"managed-{uuid4().hex}@example.com"
    signup = _signup_verify(client, email, "Managed Trial")
    now = datetime.now(UTC)
    db.add(Subscription(
        tenant_id=signup["tenant_id"], status="trialing", complimentary_access=True,
        stripe_subscription_id=f"sub_{uuid4().hex}", trial_ends_at=now + timedelta(hours=1),
    ))
    db.flush()
    sent = []
    monkeypatch.setattr(email_service, "send_trial_ending_email", lambda **kw: sent.append(kw) or True)
    assert trial_reminders.send_due_trial_reminders(db, now=now) == 1
    assert sent[0]["to"] == email


@pytest.mark.parametrize("hours_to_expiry", [0, -1, 97])
def test_reminders_exclude_expired_and_early_trials(
    client: TestClient, db: Session, monkeypatch, hours_to_expiry: int
) -> None:
    signup = _signup_verify(client, f"boundary-{uuid4().hex}@example.com", "Boundary Tenant")
    now = datetime.now(UTC)
    _set_tenant_created_at(
        db, signup["tenant_id"],
        now - timedelta(days=settings.billing_trial_days) + timedelta(hours=hours_to_expiry),
    )
    sent = []
    monkeypatch.setattr(email_service, "send_trial_ending_email", lambda **kw: sent.append(kw) or True)
    assert trial_reminders.send_due_trial_reminders(db, now=now) == 0
    assert sent == []


def test_reminder_script_returns_failure_without_private_provider_details(monkeypatch, caplog):
    module = _load_reminder_script()

    def fail(_db):
        raise trial_reminders.TrialReminderBatchError(sent=2, failed=1)

    monkeypatch.setattr(module, "send_due_trial_reminders", fail)
    assert module.main() == 1
    assert "trial_reminder.batch_failed sent=2 failed=1" in caplog.text
