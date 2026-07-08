import importlib.util
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.billing.models import Subscription
from app.config import settings
from app.email import service as email_service
from app.email import trial_reminders
from app.tenants.models import Tenant


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
        lambda **kwargs: sent.append(kwargs),
    )
    monkeypatch.setattr(
        trial_reminders.email_service,
        "send_trial_ending_email",
        lambda **kwargs: sent.append(kwargs),
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
        lambda **kwargs: sent.append(kwargs),
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
        lambda **kwargs: sent.append(kwargs),
    )

    count = trial_reminders.send_due_trial_reminders(db, now=now)
    assert count == 0
    assert sent == []
