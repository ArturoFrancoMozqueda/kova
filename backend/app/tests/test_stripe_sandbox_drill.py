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


@pytest.mark.parametrize("reported,expected", [
    ("field_unstable", "field_unstable"),
    ("field_missing", "field_missing"),
    ("private_bearer_value", "unknown"),
])
def test_checkout_failure_relays_only_fixed_reason_without_raw_provider_error(
    tmp_path, monkeypatch, reported, expected,
):
    from types import SimpleNamespace

    config = drill.validate_environment(_environment(tmp_path))
    monkeypatch.setattr(drill.subprocess, "run", lambda *args, **kwargs: SimpleNamespace(
        returncode=1, stderr=(
            "KOV005_CHECKOUT_FAILURE_STAGE=fill_optional_billing\n"
            f"KOV005_CHECKOUT_FAILURE_REASON={reported}\n"
            "provider raw error https://checkout.stripe.com/private?token=do-not-log\n"
        ),
    ))
    with pytest.raises(drill.DrillError) as caught:
        drill._complete_hosted_checkout(config, tmp_path / "state.json")
    assert str(caught.value) == (
        f"Stripe hosted Checkout automation failed at fill_optional_billing ({expected})"
    )


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
        ("GITHUB_ACTIONS", "false"),
        ("FRONTEND_URL", "https://kovasuite.com"),
        ("STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION", "true"),
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
            "recurring": {"interval": "month", "interval_count": 1},
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


@pytest.mark.parametrize("code", ["standard", "esencial", "gestion"])
def test_evidence_redacts_provider_ids_and_contains_acceptance(tmp_path: Path, code) -> None:
    config = drill.validate_environment(_commercial_environment(tmp_path, code))
    plan = drill.PLANS[code]
    full_event_id = "evt_abcdefghijklmnopqrstuvwxyz"
    full_watermark_id = "evt_watermark_abcdefghijkl"
    snapshot = drill.SubscriptionSnapshot(
        status="canceled",
        plan_code=code,
        amount_minor_units=plan.amount_minor_units,
        currency="MXN",
        features=list(plan.features),
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
            "kova_plan": {"plan_code": code, "amount_minor_units": plan.amount_minor_units,
                          "features": list(plan.features)},
            "kova_access": {"allowed": True, "reason": "active", "valid_until": "bounded"},
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
    assert f"Plan under acceptance: `{code}`" in rendered
    assert "MXN " + {"standard": "299.00", "esencial": "399.00", "gestion": "699.00"}[code] in rendered
    assert "Provider Test Clocks advance Stripe only" in rendered
    assert "effective downgrades are NOT accepted" in rendered
    assert '"plan_code": "' + code + '"' in rendered


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


def _commercial_environment(tmp_path: Path, plan_code: str) -> dict[str, str]:
    return {
        **_environment(tmp_path), "KOV005_PLAN_CODE": plan_code,
        "KOV005_STRIPE_ESENCIAL_PRICE_ID": "price_esencial",
        "KOV005_STRIPE_GESTION_PRICE_ID": "price_gestion",
    }


def _commercial_price(code: str) -> dict:
    return {
        "id": f"price_{code}", "livemode": False, "active": True,
        "unit_amount": drill.PLANS[code].amount_minor_units, "currency": "mxn",
        "recurring": {"interval": "month", "interval_count": 1}, "tax_behavior": "inclusive",
    }


@pytest.mark.parametrize("code", ["standard", "esencial", "gestion"])
def test_selected_plan_configures_only_ephemeral_backend_and_keeps_portal_off(
    tmp_path, monkeypatch, code,
):
    # Ignore inherited provider settings: these are process-local synthetic values.
    monkeypatch.setattr(drill.os, "environ", {"BILLING_PORTAL_ENABLED": "true",
                                              "BILLING_TIERED_PLANS_ENABLED": "true"})
    config = drill.validate_environment(_commercial_environment(tmp_path, code))
    environment = drill._backend_environment(config, "synthetic-signing-value")
    assert config.plan_code == code
    assert environment["STRIPE_STANDARD_PRICE_ID"] == "price_sandbox"
    assert environment["BILLING_PORTAL_ENABLED"] == "false"
    assert environment["STRIPE_STANDARD_PORTAL_CONFIGURATION_ID"] == ""
    assert environment["STRIPE_TIERED_PORTAL_CONFIGURATION_ID"] == ""
    assert environment["BILLING_TIERED_PLANS_ENABLED"] == str(code != "standard").lower()
    for plan in ("esencial", "gestion"):
        expected = f"price_{plan}" if code != "standard" else ""
        assert environment[f"STRIPE_{plan.upper()}_PRICE_ID"] == expected
    assert config.price_id == ("price_sandbox" if code == "standard" else f"price_{code}")


@pytest.mark.parametrize("code", ["esencial", "gestion"])
def test_new_plan_requires_both_distinct_configured_prices(tmp_path, code):
    environment = _commercial_environment(tmp_path, code)
    environment.pop("KOV005_STRIPE_GESTION_PRICE_ID")
    with pytest.raises(drill.DrillError, match="Missing required"):
        drill.validate_environment(environment)
    environment["KOV005_STRIPE_GESTION_PRICE_ID"] = "price_esencial"
    with pytest.raises(drill.DrillError, match="distinct"):
        drill.validate_environment(environment)
    environment["KOV005_PLAN_CODE"] = "unknown"
    with pytest.raises(drill.DrillError, match="KOV005_PLAN_CODE"):
        drill.validate_environment(environment)


class _CommercialStripe:
    def __init__(self):
        self.prices = {code: _commercial_price(code) for code in ("esencial", "gestion")}
        self.reads = []

    def get(self, path):
        self.reads.append(path)
        if path == "/v1/account":
            return {"id": "acct_sandbox"}
        return self.prices[path.removeprefix("/v1/prices/price_")]


@pytest.mark.parametrize("code", ["esencial", "gestion"])
def test_preflight_checks_both_new_prices_against_catalog(tmp_path, code):
    config = drill.validate_environment(_commercial_environment(tmp_path, code))
    stripe = _CommercialStripe()
    result = drill.validate_stripe_preflight(stripe, config)
    assert result["plan_code"] == code
    assert result["amount_minor_units"] == drill.PLANS[code].amount_minor_units
    assert result["tax_inclusive"] is True
    assert stripe.reads == ["/v1/account", "/v1/prices/price_esencial", "/v1/prices/price_gestion"]


@pytest.mark.parametrize("field,value", [
    ("id", "price_different"), ("unit_amount", 29900), ("currency", "usd"),
    ("livemode", True), ("active", False), ("tax_behavior", "exclusive"),
    ("recurring", {"interval": "year", "interval_count": 1}),
    ("recurring", {"interval": "month", "interval_count": 2}),
    ("recurring", {"interval": "month"}),
])
def test_new_plan_preflight_rejects_wrong_price_in_either_plan(tmp_path, field, value):
    config = drill.validate_environment(_commercial_environment(tmp_path, "esencial"))
    stripe = _CommercialStripe()
    stripe.prices["gestion"][field] = value
    with pytest.raises(drill.DrillError, match="Sandbox price"):
        drill.validate_stripe_preflight(stripe, config)


@pytest.mark.parametrize("code", ["standard", "esencial", "gestion"])
def test_kova_acceptance_requires_exact_paid_plan_amount_features_and_access(tmp_path, code):
    config = drill.validate_environment(_commercial_environment(tmp_path, code))
    plan = drill.PLANS[code]
    result = {
        "subscription": {"plan_code": code, "amount_minor_units": plan.amount_minor_units,
                         "currency": "MXN"},
        "access": {"plan_code": code, "features": list(plan.features), "allowed": True},
    }
    drill._assert_selected_plan(config, result)
    for section, field, invalid in [
        ("subscription", "plan_code", "unknown"),
        ("subscription", "amount_minor_units", 1),
        ("access", "features", ["pos"]),
        ("access", "allowed", False),
    ]:
        original = result[section][field]
        result[section][field] = invalid
        with pytest.raises(drill.DrillError, match="Kova did not grant"):
            drill._assert_selected_plan(config, result)
        result[section][field] = original


@pytest.mark.parametrize("code", ["standard", "esencial", "gestion"])
@pytest.mark.parametrize("provider_status,payment_status", [
    ("complete", "paid"), ("open", "unpaid"), ("complete", "unpaid"),
])
@pytest.mark.parametrize("retry_lookup", [False, True], ids=["initial-lookup", "recovered-lookup"])
def test_hosted_checkout_sends_explicit_plan_and_checks_kova_entitlement(
    tmp_path, monkeypatch, code, provider_status, payment_status, retry_lookup,
):
    config = drill.validate_environment(_commercial_environment(tmp_path, code))
    plan = drill.PLANS[code]
    requests = []
    snapshot = drill.SubscriptionSnapshot(
        status="active", plan_code=code, amount_minor_units=plan.amount_minor_units,
        currency="MXN", features=list(plan.features), cancel_at_period_end=False,
        current_period_end="2026-12-01T00:00:00Z", past_due_at=None, grace_period_ends_at=None,
        lifecycle_watermark_at="2026-11-01T00:00:00Z", lifecycle_event_type="created",
        lifecycle_event_id="evt_redacted", payment_watermark_at=None,
        payment_event_type=None, payment_event_id=None,
    )
    class Client:
        def __init__(self, *args):
            pass

        def create_verified_owner(self, label):
            return "synthetic-tenant"

        def request(self, method, path, payload=None, headers=None):
            requests.append((method, path, payload))
            return {"checkout_url": "https://checkout.stripe.com/c/pay/cs_test_synthetic",
                    "checkout_session_id": "cs_test_synthetic"}
    class Stripe:
        def __init__(self):
            self.lookups = 0
            self.deleted = []

        def get(self, path):
            self.lookups += 1
            if retry_lookup and self.lookups == 1:
                raise drill.DrillError("Synthetic first session lookup failure")
            return {"livemode": False, "status": provider_status, "payment_status": payment_status,
                    "customer": "cus_synthetic"}

        def delete(self, path):
            self.deleted.append(path)
            return {"deleted": True}
    status = {
        "subscription": {"status": "active", "plan_code": code,
                         "amount_minor_units": plan.amount_minor_units, "currency": "MXN"},
        "access": {"allowed": True, "reason": "active", "plan_code": code,
                   "features": list(plan.features)},
    }
    monkeypatch.setattr(drill, "KovaClient", Client)
    monkeypatch.setattr(drill, "_complete_hosted_checkout", lambda *args: None)
    monkeypatch.setattr(drill, "_wait_for_subscription_status", lambda *args: status)
    monkeypatch.setattr(drill, "_snapshot", lambda *args: snapshot)
    stripe = Stripe()
    customers = []
    if provider_status != "complete" or payment_status != "paid":
        with pytest.raises(drill.DrillError, match="paid result"):
            drill._run_checkout(stripe, config, None, [], customers)
        return
    evidence = drill._run_checkout(stripe, config, None, [], customers)
    assert requests == [("POST", "/api/v1/billing/checkout", {"plan_code": code})]
    assert evidence["provider_status"] == "complete"
    assert evidence["kova_plan"]["plan_code"] == code
    assert evidence["kova_plan"]["amount_minor_units"] == plan.amount_minor_units
    assert evidence["kova_plan"]["features"] == list(plan.features)
    assert evidence["kova_access"]["allowed"] is True
    assert stripe.lookups == (2 if retry_lookup else 1)
    assert customers == ["cus_synthetic"]
    import json
    assert json.loads(config.cleanup_path.read_text())["customers"] == customers
    assert drill.cleanup_provider_objects(config, stripe) == {
        "clocks_deleted": 0, "customers_deleted": 1,
    }
    assert stripe.deleted == ["/v1/customers/cus_synthetic"]
    assert not config.cleanup_path.exists()


@pytest.mark.parametrize("field,value", [
    ("plan_code", "unknown"), ("amount_minor_units", 29900),
    ("currency", "USD"), ("features", ["pos"]),
])
def test_lifecycle_cannot_accept_an_unknown_or_wrong_local_plan(tmp_path, monkeypatch, field, value):
    from types import SimpleNamespace

    config = drill.validate_environment(_commercial_environment(tmp_path, "esencial"))
    values = {"plan_code": "esencial", "amount_minor_units": 39900, "currency": "MXN",
              "features": list(drill.PLANS["esencial"].features)}
    values[field] = value
    monkeypatch.setattr(drill, "_deliver_event", lambda *args: ({"status": "processed"}, "now"))
    monkeypatch.setattr(drill, "_snapshot", lambda *args: SimpleNamespace(**values))
    with pytest.raises(drill.DrillError, match="lifecycle snapshot"):
        drill._deliver_and_record(config, None, "synthetic", [], tenant_id="synthetic",
                                  step="renewal_paid", order=1, event={})


@pytest.mark.parametrize("customer", [None, "", "customer_invalid", "cus_../unsafe", {"id": "cus_x"}])
def test_checkout_cannot_be_accepted_without_a_valid_cleanup_customer(tmp_path, customer):
    config = drill.validate_environment(_environment(tmp_path))
    customers = []
    with pytest.raises(drill.DrillError, match="valid customer for cleanup"):
        drill._register_checkout_customer(config, {"livemode": False, "customer": customer},
                                          [], customers)
    assert customers == []
    assert not config.cleanup_path.exists()
