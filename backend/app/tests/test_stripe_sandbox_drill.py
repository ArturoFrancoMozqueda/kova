from pathlib import Path

import pytest

from scripts import stripe_sandbox_drill as drill


def _environment(tmp_path: Path) -> dict[str, str]:
    return {
        "GITHUB_ACTIONS": "true",
        "GITHUB_REF": "refs/heads/main",
        "KOV005_EXECUTION_ENVIRONMENT": "stripe-sandbox",
        "KOV005_CONFIRM": drill.ACKNOWLEDGEMENT,
        "APP_ENV": "local",
        "STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION": "false",
        "KOV005_STRIPE_SECRET_KEY": "sk_test_safe_placeholder",
        "KOV005_STRIPE_STANDARD_PRICE_ID": "price_sandbox",
        "KOV005_STRIPE_ACCOUNT_ID": "acct_sandbox",
        "DATABASE_URL": "postgresql+psycopg://pos:pos@127.0.0.1:5432/pos",
        "KOV005_APP_BASE_URL": "http://127.0.0.1:8000",
        "FRONTEND_URL": "http://127.0.0.1:5173",
        "KOV005_EVIDENCE_PATH": str(tmp_path / "evidence.md"),
        "KOV005_CLEANUP_PATH": str(tmp_path / "cleanup.json"),
        "GITHUB_SHA": "a" * 40,
    }


@pytest.mark.parametrize("key", ["sk_live_forbidden", "rk_live_forbidden", "garbage"])
def test_guard_rejects_non_test_stripe_keys(tmp_path: Path, key: str) -> None:
    environ = _environment(tmp_path)
    environ["KOV005_STRIPE_SECRET_KEY"] = key

    with pytest.raises(drill.DrillError, match="test-mode key"):
        drill.validate_environment(environ)


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("GITHUB_REF", "refs/heads/feature/unsafe"),
        ("APP_ENV", "production"),
        ("KOV005_EXECUTION_ENVIRONMENT", "production"),
        ("KOV005_CONFIRM", "yes"),
        ("KOV005_APP_BASE_URL", "https://api.kovasuite.com"),
        ("DATABASE_URL", "postgresql://pos:pos@db.example.com/pos"),
    ],
)
def test_guard_rejects_non_isolated_execution(
    tmp_path: Path, name: str, value: str
) -> None:
    environ = _environment(tmp_path)
    environ[name] = value

    with pytest.raises(drill.DrillError):
        drill.validate_environment(environ)


class _FakeStripe:
    def __init__(self, account: dict, price: dict) -> None:
        self.account = account
        self.price = price

    def get(self, path: str) -> dict:
        return self.account if path == "/v1/account" else self.price


def test_preflight_requires_exact_sandbox_account_and_price(tmp_path: Path) -> None:
    config = drill.validate_environment(_environment(tmp_path))
    stripe = _FakeStripe(
        {"id": "acct_sandbox"},
        {
            "id": "price_sandbox",
            "livemode": False,
            "active": True,
            "unit_amount": 29_900,
            "currency": "mxn",
            "recurring": {"interval": "month"},
        },
    )

    result = drill.validate_stripe_preflight(stripe, config)  # type: ignore[arg-type]

    assert result["livemode"] is False
    assert result["amount_minor_units"] == 29_900
    stripe.price["livemode"] = True
    with pytest.raises(drill.DrillError, match="Sandbox price"):
        drill.validate_stripe_preflight(stripe, config)  # type: ignore[arg-type]


def test_event_selection_handles_current_invoice_parent_shape() -> None:
    subscription_id = "sub_temporal"
    events = [
        {
            "id": "evt_new",
            "type": "customer.subscription.deleted",
            "created": 200,
            "livemode": False,
            "data": {"object": {"id": subscription_id}},
        },
        {
            "id": "evt_old",
            "type": "invoice.paid",
            "created": 100,
            "livemode": False,
            "data": {
                "object": {
                    "id": "in_old",
                    "parent": {"subscription_details": {"subscription": subscription_id}},
                }
            },
        },
        {
            "id": "evt_live",
            "type": "invoice.paid",
            "created": 300,
            "livemode": True,
            "data": {"object": {"subscription": subscription_id}},
        },
    ]

    selected = drill.select_subscription_events(events, subscription_id, drill.EVENT_TYPES)

    assert [event["id"] for event in selected] == ["evt_old", "evt_new"]


def test_evidence_redacts_provider_ids_and_contains_acceptance(tmp_path: Path) -> None:
    config = drill.validate_environment(_environment(tmp_path))
    full_event_id = "evt_abcdefghijklmnopqrstuvwxyz"
    full_watermark_id = "evt_watermark_abcdefghijkl"
    snapshot = drill.SubscriptionSnapshot(
        status="canceled",
        cancel_at_period_end=True,
        current_period_end="2026-09-07T12:00:00Z",
        past_due_at=None,
        grace_period_ends_at=None,
        lifecycle_watermark_at="2026-09-07T12:00:00Z",
        lifecycle_event_type="customer.subscription.deleted",
        lifecycle_event_id=drill.redact_identifier(full_watermark_id),
        payment_watermark_at="2026-09-07T11:00:00Z",
        payment_event_type="invoice.paid",
        payment_event_id=drill.redact_identifier(full_event_id),
    )
    rendered = drill.render_evidence(
        config=config,
        preflight={"account_id": "acct_…andbox", "price_id": "price_…andbox"},
        checkout={
            "checkout_session_id": "cs_test_…andbox",
            "provider_status": "complete",
            "provider_payment_status": "paid",
            "local_subscription_status": "active",
            "delivery": "stripe_cli_forward",
        },
        records=[
            {
                "step": "cancel_then_old_payment",
                "order": 1,
                "event_type": "customer.subscription.deleted",
                "event_id": drill.redact_identifier(full_event_id),
                "event_created_at": "2026-09-07T12:00:00Z",
                "delivered_at": "2026-09-07T12:01:00Z",
                "response": "processed",
                "subscription": snapshot.__dict__,
            }
        ],
        cleanup={"clocks_deleted": 3, "customers_deleted": 1},
    )

    assert full_event_id not in rendered
    assert full_watermark_id not in rendered
    assert "livemode=false" in rendered
    assert "both arrival orders" in rendered


class _CleanupStripe:
    def __init__(self) -> None:
        self.deleted: list[str] = []

    def delete(self, path: str) -> dict:
        self.deleted.append(path)
        return {"deleted": True}


def test_cleanup_manifest_is_consumed_only_after_provider_deletes(tmp_path: Path) -> None:
    config = drill.validate_environment(_environment(tmp_path))
    drill._persist_cleanup(config, ["clock_sandbox"], ["cus_sandbox"])
    stripe = _CleanupStripe()

    result = drill.cleanup_provider_objects(config, stripe)  # type: ignore[arg-type]

    assert result == {"clocks_deleted": 1, "customers_deleted": 1}
    assert stripe.deleted == [
        "/v1/test_helpers/test_clocks/clock_sandbox",
        "/v1/customers/cus_sandbox",
    ]
    assert not config.cleanup_path.exists()
