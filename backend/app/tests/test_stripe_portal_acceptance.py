"""Pure sandbox-runner tests: all provider, browser and application effects are stubbed."""

import json
import subprocess
import time
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts import stripe_sandbox_drill as drill


def _environment(tmp_path, code="esencial"):
    return {
        "GITHUB_ACTIONS": "true",
        "GITHUB_REF": "refs/heads/main",
        "KOV005_EXECUTION_ENVIRONMENT": "stripe-sandbox",
        "KOV005_CONFIRM": drill.ACKNOWLEDGEMENT,
        "APP_ENV": "local",
        "STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION": "false",
        "KOV005_STRIPE_SECRET_KEY": "rk_test_synthetic_only",
        "KOV005_PLAN_CODE": code,
        "KOV005_STRIPE_STANDARD_PRICE_ID": "price_standard",
        "KOV005_STRIPE_ESENCIAL_PRICE_ID": "price_esencial",
        "KOV005_STRIPE_GESTION_PRICE_ID": "price_gestion",
        "KOV005_STRIPE_ACCOUNT_ID": "acct_synthetic",
        "KOV005_INCLUDE_PORTAL": "true",
        "KOV005_PORTAL_MODE": "transitions",
        "KOV005_STRIPE_STANDARD_PORTAL_CONFIGURATION_ID": "bpc_standard",
        "KOV005_STRIPE_TIERED_PORTAL_CONFIGURATION_ID": "bpc_tiered",
        "DATABASE_URL": "postgresql+psycopg://pos:pos@127.0.0.1:1/no_connection_expected",
        "KOV005_EVIDENCE_PATH": str(tmp_path / "evidence.md"),
        "KOV005_CLEANUP_PATH": str(tmp_path / "cleanup.json"),
    }


def _configuration(code="esencial"):
    return {
        "id": "bpc_standard" if code == "standard" else "bpc_tiered",
        "active": True,
        "livemode": False,
        "features": {
            "subscription_update": {
                "enabled": code != "standard",
                "default_allowed_updates": ["price"],
                "proration_behavior": "always_invoice",
                "products": [
                    {
                        "product": "prod_synthetic",
                        "prices": ["price_esencial", "price_gestion"],
                        "adjustable_quantity": {"enabled": False},
                    }
                ],
                "schedule_at_period_end": {"conditions": [{"type": "decreasing_item_amount"}]},
            }
        },
    }


def _subscription(code="esencial", invoice_id="in_current"):
    end = int(time.time()) + 86400
    return {
        "id": "sub_owned",
        "customer": "cus_owned",
        "livemode": False,
        "status": "active",
        "items": {"data": [{"price": {"id": "price_" + code}, "quantity": 1}]},
        "current_period_end": end,
        "latest_invoice": {
            "id": invoice_id,
            "livemode": False,
            "status": "paid",
            "amount_remaining": 0,
            "subscription": "sub_owned",
            "customer": "cus_owned",
            "lines": {
                "data": [
                    {
                        "amount": 30000,
                        "pricing": {"price_details": {"price": "price_" + code}},
                        "period": {"start": int(time.time()) - 60, "end": end},
                    }
                ]
            },
        },
    }


def _kova(code="esencial", allowed=True):
    plan = drill.PLANS[code]
    return {
        "subscription": {
            "plan_code": code,
            "amount_minor_units": plan.amount_minor_units,
            "currency": "MXN",
        },
        "access": {"plan_code": code, "features": list(plan.features), "allowed": allowed},
    }


@pytest.mark.parametrize("code", ["standard", "esencial"])
def test_portal_opt_in_configures_only_the_ephemeral_cohort(tmp_path, monkeypatch, code):
    monkeypatch.setattr(drill.os, "environ", {})
    config = drill.validate_environment(_environment(tmp_path, code))
    env = drill._backend_environment(config, "synthetic-signing-value")
    assert config.include_portal
    assert env["BILLING_PORTAL_ENABLED"] == "true"
    assert env["STRIPE_STANDARD_PORTAL_CONFIGURATION_ID"] == (
        "bpc_standard" if code == "standard" else ""
    )
    assert env["STRIPE_TIERED_PORTAL_CONFIGURATION_ID"] == (
        "bpc_tiered" if code == "esencial" else ""
    )
    off = replace(config, include_portal=False, portal_configuration_id=None)
    assert drill._backend_environment(off, "synthetic")["BILLING_PORTAL_ENABLED"] == "false"


@pytest.mark.parametrize(
    "key,value",
    [
        ("KOV005_INCLUDE_PORTAL", "yes"),
        ("KOV005_PLAN_CODE", "gestion"),
        ("KOV005_STRIPE_TIERED_PORTAL_CONFIGURATION_ID", "bad"),
        ("KOV005_STRIPE_TIERED_PORTAL_CONFIGURATION_ID", ""),
        ("GITHUB_ACTIONS", "false"),
        ("GITHUB_REF", "refs/heads/other"),
    ],
)
def test_portal_opt_in_keeps_existing_safety_guards(tmp_path, key, value):
    env = _environment(tmp_path)
    env[key] = value
    with pytest.raises(drill.DrillError):
        drill.validate_environment(env)


@pytest.mark.parametrize("code", ["standard", "esencial"])
def test_portal_preflight_reads_expanded_test_configuration(tmp_path, code):
    config = drill.validate_environment(_environment(tmp_path, code))
    reads = []

    class Stripe:
        def get(self, path, query):
            reads.append((path, query))
            return _configuration(code)

    result = drill._portal_preflight(Stripe(), config)
    assert reads == [
        (
            f"/v1/billing_portal/configurations/{config.portal_configuration_id}",
            [("expand[]", "features.subscription_update.products")],
        )
    ]
    assert result["subscription_update_enabled"] is (code != "standard")
    assert result["livemode"] is False


@pytest.mark.parametrize(
    "fault", ["live", "inactive", "price", "quantity", "proration", "immediate"]
)
def test_portal_preflight_rejects_unsafe_tiered_configuration(tmp_path, fault):
    config = drill.validate_environment(_environment(tmp_path))
    source = _configuration()
    update = source["features"]["subscription_update"]
    if fault == "live":
        source["livemode"] = True
    if fault == "inactive":
        source["active"] = False
    if fault == "price":
        update["products"][0]["prices"].append("price_unknown")
    if fault == "quantity":
        update["products"][0]["adjustable_quantity"]["enabled"] = True
    if fault == "proration":
        update["proration_behavior"] = "none"
    if fault == "immediate":
        update["schedule_at_period_end"]["conditions"] = []
    with pytest.raises(drill.DrillError):
        drill._portal_preflight(SimpleNamespace(get=lambda *args, **kwargs: source), config)


@pytest.mark.parametrize(
    "fault", ["unpaid", "remaining", "old_price", "credit", "pending", "future", "live", "customer"]
)
def test_upgrade_requires_the_new_settled_current_price_invoice(fault):
    sub = _subscription("gestion")
    invoice = sub["latest_invoice"]
    if fault == "unpaid":
        invoice["status"] = "open"
    if fault == "remaining":
        invoice["amount_remaining"] = 1
    if fault == "old_price":
        invoice["lines"]["data"][0]["pricing"]["price_details"]["price"] = "price_esencial"
    if fault == "credit":
        invoice["lines"]["data"][0]["amount"] = -100
    if fault == "pending":
        sub["pending_update"] = {"expires_at": 1}
    if fault == "future":
        invoice["lines"]["data"][0]["period"]["start"] = int(time.time()) + 1000
    if fault == "live":
        invoice["livemode"] = True
    if fault == "customer":
        invoice["customer"] = "cus_other"
    with pytest.raises(drill.DrillError):
        drill._portal_paid_invoice(sub, "price_gestion")
    assert drill._portal_paid_invoice(_subscription("gestion"), "price_gestion")["status"] == "paid"


@pytest.mark.parametrize(
    "fault", [None, "immediate", "price", "quantity", "live", "subscription", "released"]
)
def test_downgrade_proves_future_schedule_and_preserves_current_gestion(tmp_path, fault):
    config = drill.validate_environment(_environment(tmp_path))
    sub = _subscription("gestion")
    end = sub["current_period_end"]
    schedule = {
        "livemode": False,
        "status": "active",
        "subscription": sub["id"],
        "phases": [{"start_date": end, "items": [{"price": "price_esencial", "quantity": 1}]}],
    }
    if fault == "immediate":
        schedule["phases"][0]["start_date"] = int(time.time())
    if fault == "price":
        sub["items"]["data"][0]["price"]["id"] = "price_esencial"
    if fault == "quantity":
        schedule["phases"][0]["items"][0]["quantity"] = 2
    if fault == "live":
        schedule["livemode"] = True
    if fault == "subscription":
        schedule["subscription"] = "sub_other"
    if fault == "released":
        schedule["status"] = "released"
    if fault is None:
        assert drill._assert_portal_schedule(schedule, sub, config) == end
    else:
        with pytest.raises(drill.DrillError):
            drill._assert_portal_schedule(schedule, sub, config)


@pytest.mark.parametrize("outcome", ["success", "failure", "timeout", "invalid_output"])
@pytest.mark.parametrize("portal_path", ["/p/session/test_private", "/p/test_private"])
def test_portal_bearer_state_is_private_and_removed_on_all_helper_outcomes(
    tmp_path, monkeypatch, outcome, portal_path
):
    config = drill.validate_environment(_environment(tmp_path))
    paths = []

    class Client:
        def request(self, method, path):
            assert (method, path) == ("POST", "/api/v1/billing/portal")
            return {"portal_url": "https://billing.stripe.com" + portal_path}

    def run(*args, **kwargs):
        filename = Path(kwargs["env"]["KOV005_PORTAL_STATE_FILE"])
        paths.append(filename)
        assert filename.stat().st_mode & 0o777 == 0o600
        assert json.loads(filename.read_text())["action"] == "upgrade_success"
        if outcome == "timeout":
            raise subprocess.TimeoutExpired("node", 120)
        return SimpleNamespace(
            returncode=1 if outcome == "failure" else 0,
            stderr="KOV005_PORTAL_FAILURE_STAGE=confirm_plan_change",
            stdout=(
                "{}"
                if outcome == "invalid_output"
                else json.dumps({"action": "upgrade_success", "submitted": True, "inspected": True})
            ),
        )

    monkeypatch.setattr(drill.subprocess, "run", run)
    if outcome == "success":
        drill._submit_portal_action(config, {"client": Client()}, "upgrade_success")
    else:
        with pytest.raises(drill.DrillError):
            drill._submit_portal_action(config, {"client": Client()}, "upgrade_success")
    assert paths and all(not p.exists() for p in paths)


@pytest.mark.parametrize("revision", [None, "offer-current"])
def test_signup_adapter_fetches_and_echoes_offer_revision_only_if_present(revision):
    client = drill.KovaClient("http://127.0.0.1:8000", "http://127.0.0.1:5173")
    calls = []

    def request(method, path, payload=None):
        calls.append((method, path, payload))
        if path == "/api/v1/billing/plans":
            return {"offer_revision": revision}
        if path == "/api/v1/auth/signup":
            return {"tenant_id": "synthetic", "dev_verification_token": "synthetic"}
        return {}

    client.request = request
    assert client.create_verified_owner("portal") == "synthetic"
    assert calls[0] == ("GET", "/api/v1/billing/plans", None)
    signup = calls[1][2]
    if revision is None:
        assert "billing_offer_revision" not in signup
    else:
        assert signup["billing_offer_revision"] == revision


def test_rejected_payment_can_preserve_essential_without_inventing_grace(tmp_path):
    config = drill.validate_environment(_environment(tmp_path))
    drill._assert_selected_plan(config, _kova(allowed=False), require_access=False)
    with pytest.raises(drill.DrillError):
        drill._assert_selected_plan(config, _kova("gestion"), require_access=False)


def test_late_portal_failure_still_cleans_every_created_customer(tmp_path, monkeypatch):
    config = drill.validate_environment(_environment(tmp_path))
    deleted = []

    class Stripe:
        def __init__(self, key):
            pass

        def delete(self, path):
            deleted.append(path)
            return {"deleted": True}

    monkeypatch.setattr(drill, "StripeTestClient", Stripe)
    monkeypatch.setattr(drill, "validate_stripe_preflight", lambda *args: {})
    monkeypatch.setattr(drill, "_start_stripe_listener", lambda *args: ("listener", "synthetic"))
    monkeypatch.setattr(drill, "_start_backend", lambda *args: "backend")
    monkeypatch.setattr(drill, "_wait_for_health", lambda *args: None)
    stopped = []
    monkeypatch.setattr(drill, "_stop_process", lambda process: stopped.append(process))
    monkeypatch.setattr(drill, "create_engine", lambda *args, **kwargs: None)

    def checkout(stripe, config, engine, clocks, customers, **kwargs):
        customers.append("cus_first")
        drill._persist_cleanup(config, clocks, customers)
        return {"accepted": True}

    def portal(stripe, config, engine, context, clocks, customers):
        customers.append("cus_second")
        drill._persist_cleanup(config, clocks, customers)
        raise drill.DrillError("Synthetic late hosted Portal failure")

    monkeypatch.setattr(drill, "_run_checkout", checkout)
    monkeypatch.setattr(drill, "_run_portal_acceptance", portal)
    with pytest.raises(drill.DrillError, match="late hosted Portal"):
        drill.run(config)
    assert deleted == ["/v1/customers/cus_second", "/v1/customers/cus_first"]
    assert "listener" in stopped and "backend" in stopped
    assert not config.cleanup_path.exists()
    assert not config.evidence_path.exists()


def test_portal_acceptance_uses_separate_rejected_and_successful_customers(tmp_path, monkeypatch):
    config = drill.validate_environment(_environment(tmp_path))
    initial_sub = _subscription("esencial", "in_initial")
    success_sub = _subscription("esencial", "in_successinitial")
    success_sub["id"], success_sub["customer"] = "sub_success", "cus_success"
    success_sub["latest_invoice"].update(subscription="sub_success", customer="cus_success")
    current_code = {"initial": "esencial", "success": "esencial"}

    class Client:
        def __init__(self, name):
            self.name = name

        def request(self, *args):
            return _kova(current_code[self.name], allowed=self.name == "success")

    initial = {
        "client": Client("initial"),
        "tenant_id": "initial",
        "stripe_session": {"subscription": "sub_owned", "customer": "cus_owned"},
    }
    event = {
        "id": "evt_newfailure",
        "type": "invoice.payment_failed",
        "livemode": False,
        "data": {"object": {"id": "in_failed", "subscription": "sub_owned"}},
    }
    actions, posts = [], []

    class Stripe:
        def get(self, path, query=None):
            if path == "/v1/subscriptions/sub_owned":
                return initial_sub
            if path == "/v1/subscriptions/sub_success":
                return success_sub
            if path == "/v1/invoices/in_failed":
                return {
                    "id": "in_failed",
                    "livemode": False,
                    "status": "open",
                    "subscription": "sub_owned",
                    "customer": "cus_owned",
                    "amount_remaining": 30000,
                }
            if path == "/v1/subscription_schedules/sub_sched_future":
                return {
                    "livemode": False,
                    "status": "active",
                    "subscription": "sub_success",
                    "phases": [
                        {
                            "start_date": success_sub["current_period_end"],
                            "items": [{"price": "price_esencial", "quantity": 1}],
                        }
                    ],
                }
            raise AssertionError("Unexpected provider read")

        def post(self, path, payload):
            posts.append((path, payload))
            return {}

    monkeypatch.setattr(drill, "_create_payment_method", lambda *args: {"id": "pm_synthetic"})
    monkeypatch.setattr(drill, "_matching_event_ids", lambda *args: {"evt_old"})
    monkeypatch.setattr(drill, "_wait_for_event", lambda *args, **kwargs: event)

    def submit(config, context, action):
        actions.append((context["tenant_id"], action))
        if action == "upgrade_success":
            success_sub["items"]["data"][0]["price"]["id"] = "price_gestion"
            invoice = success_sub["latest_invoice"]
            invoice["id"] = "in_upgrade"
            invoice["lines"]["data"][0]["pricing"]["price_details"]["price"] = "price_gestion"
            current_code["success"] = "gestion"
        if action == "downgrade":
            success_sub["schedule"] = "sub_sched_future"

    monkeypatch.setattr(drill, "_submit_portal_action", submit)

    def checkout(stripe, config, engine, clocks, customers, *, label, context):
        assert label == "portal-success"
        customers.append("cus_success")
        drill._persist_cleanup(config, clocks, customers)
        context.update(
            client=Client("success"),
            tenant_id="success",
            stripe_session={"subscription": "sub_success", "customer": "cus_success"},
        )

    monkeypatch.setattr(drill, "_run_checkout", checkout)

    def snapshot(engine, tenant):
        code = current_code[tenant]
        return drill.SubscriptionSnapshot(
            status="active",
            plan_code=code,
            amount_minor_units=drill.PLANS[code].amount_minor_units,
            currency="MXN",
            features=list(drill.PLANS[code].features),
            cancel_at_period_end=False,
            current_period_end=drill._epoch_iso(success_sub["current_period_end"]),
            past_due_at=None,
            grace_period_ends_at=None,
            lifecycle_watermark_at=None,
            lifecycle_event_type=None,
            lifecycle_event_id=None,
            payment_watermark_at=None,
            payment_event_type=None,
            payment_event_id=None,
            plan_effective_until=drill._epoch_iso(success_sub["current_period_end"]),
        )

    monkeypatch.setattr(drill, "_snapshot", snapshot)
    customers = ["cus_owned"]
    records = drill._run_portal_acceptance(Stripe(), config, None, initial, [], customers)
    assert actions == [
        ("initial", "upgrade_decline"),
        ("success", "upgrade_success"),
        ("success", "downgrade"),
    ]
    assert [r["step"] for r in records] == [
        "upgrade_rejected_keeps_esencial",
        "upgrade_paid_grants_gestion",
        "downgrade_scheduled_keeps_gestion",
    ]
    assert records[0]["kova"]["plan_code"] == "esencial"
    assert records[1]["kova"]["plan_code"] == records[2]["kova"]["plan_code"] == "gestion"
    assert customers == ["cus_owned", "cus_success"]
    assert all(set(payload) <= {"customer", "default_payment_method"} for _, payload in posts)
    assert records[2]["provider_schedule"]["target_plan"] == "esencial"


def test_different_products_fail_before_any_portal_customer_is_created(tmp_path):
    config = drill.validate_environment(_environment(tmp_path))
    source = _configuration()
    source["features"]["subscription_update"]["products"] = [
        {"product": "prod_esencial", "prices": ["price_esencial"]},
        {"product": "prod_gestion", "prices": ["price_gestion"]},
    ]
    with pytest.raises(drill.DrillError, match="same Product"):
        drill._portal_preflight(SimpleNamespace(get=lambda *args, **kwargs: source), config)
    assert not config.cleanup_path.exists()


def _basic_environment(tmp_path, code="esencial"):
    return {**_environment(tmp_path, code), "KOV005_PORTAL_MODE": "basic"}


def _basic_configuration(code="esencial"):
    source = _configuration(code)
    source["features"].update(
        payment_method_update={"enabled": True},
        invoice_history={"enabled": True},
        subscription_cancel={"enabled": True, "mode": "at_period_end"},
    )
    source["features"]["subscription_update"]["enabled"] = False
    return source


@pytest.mark.parametrize("code", ["standard", "esencial", "gestion"])
def test_basic_portal_is_default_and_accepts_distinct_product_catalog(tmp_path, code):
    env = _basic_environment(tmp_path, code)
    env.pop("KOV005_PORTAL_MODE")
    config = drill.validate_environment(env)
    assert config.portal_mode == "basic"
    source = _basic_configuration(code)
    source["features"]["subscription_update"]["products"] = [
        {"product": "prod_esencial", "prices": ["price_esencial"]},
        {"product": "prod_gestion", "prices": ["price_gestion"]},
    ]
    result = drill._portal_preflight(SimpleNamespace(get=lambda *args, **kwargs: source), config)
    assert result["subscription_update_enabled"] is False


@pytest.mark.parametrize("fault", ["tiers", "payment", "history", "cancel", "immediate"])
def test_basic_portal_preflight_blocks_unaccepted_features(tmp_path, fault):
    config = drill.validate_environment(_basic_environment(tmp_path))
    source = _basic_configuration()
    feature = {
        "tiers": "subscription_update",
        "payment": "payment_method_update",
        "history": "invoice_history",
        "cancel": "subscription_cancel",
    }
    if fault == "immediate":
        source["features"]["subscription_cancel"]["mode"] = "immediately"
    else:
        source["features"][feature[fault]]["enabled"] = fault == "tiers"
    with pytest.raises(drill.DrillError, match="payment/history/deferred cancellation only"):
        drill._portal_preflight(SimpleNamespace(get=lambda *args, **kwargs: source), config)


@pytest.mark.parametrize("code", ["standard", "esencial", "gestion"])
@pytest.mark.parametrize("cancellation_form", ["legacy", "timestamp"])
@pytest.mark.parametrize(
    "override", [False, True], ids=["customer-default", "subscription-default"]
)
def test_basic_portal_updates_effective_payment_and_defers_cancellation_without_tier_change(
    tmp_path,
    monkeypatch,
    code,
    override,
    cancellation_form,
):
    config = drill.validate_environment(_basic_environment(tmp_path, code))
    source = _subscription(code)
    source["cancel_at_period_end"] = False
    source["default_payment_method"] = "pm_old" if override else None
    customer = {
        "id": "cus_owned",
        "livemode": False,
        "invoice_settings": {"default_payment_method": "pm_old"},
    }
    actions = []
    kova_cancellation_scheduled = False

    class Client:
        def request(self, *args):
            result = _kova(code)
            result["subscription"]["cancel_at_period_end"] = kova_cancellation_scheduled
            return result

    context = {
        "client": Client(),
        "tenant_id": "synthetic",
        "stripe_session": {"subscription": "sub_owned", "customer": "cus_owned"},
    }

    class Stripe:
        def get(self, path, query=None):
            if path == "/v1/subscriptions/sub_owned":
                return source
            if path == "/v1/customers/cus_owned":
                return customer
            if path == "/v1/payment_methods/pm_new":
                return {"id": "pm_new", "livemode": False, "customer": "cus_owned", "type": "card"}
            raise AssertionError("Unexpected provider read")

        def post(self, *args):
            raise AssertionError("Basic billing changes must be submitted by hosted Portal")

    def submit(config, context, action):
        nonlocal kova_cancellation_scheduled
        actions.append(action)
        if action == "payment_update":
            customer["invoice_settings"]["default_payment_method"] = "pm_new"
            if override:
                source["default_payment_method"] = "pm_new"
        if action == "cancel":
            source["cancel_at_period_end"] = cancellation_form == "legacy"
            source["cancel_at"] = source["current_period_end"] if cancellation_form == "timestamp" else None
            # Expected Kova contract is independently specified, not computed by app code.
            kova_cancellation_scheduled = True

    monkeypatch.setattr(drill, "_submit_portal_action", submit)

    def snapshot(*args):
        return drill.SubscriptionSnapshot(
            status="active",
            plan_code=code,
            amount_minor_units=drill.PLANS[code].amount_minor_units,
            currency="MXN",
            features=list(drill.PLANS[code].features),
            cancel_at_period_end=kova_cancellation_scheduled,
            current_period_end=drill._epoch_iso(source["current_period_end"]),
            past_due_at=None,
            grace_period_ends_at=None,
            lifecycle_watermark_at=None,
            lifecycle_event_type=None,
            lifecycle_event_id=None,
            payment_watermark_at=None,
            payment_event_type=None,
            payment_event_id=None,
            plan_effective_until=None
            if code == "standard"
            else drill._epoch_iso(source["current_period_end"]),
        )

    monkeypatch.setattr(drill, "_snapshot", snapshot)
    result = drill._run_portal_acceptance(Stripe(), config, None, context, [], ["cus_owned"])
    assert actions == ["inspect", "payment_update", "cancel"]
    assert [r["step"] for r in result] == [
        "basic_overview_no_tier_changes",
        "basic_payment_method_updated",
        "basic_cancellation_scheduled",
    ]
    assert all(r["kova"]["plan_code"] == code for r in result)
    assert all(
        r["kova"]["amount_minor_units"] == drill.PLANS[code].amount_minor_units for r in result
    )
    assert result[1]["provider_payment_method"]["changed"] is True
    assert result[2]["provider_subscription"]["cancel_at_period_end"] is (cancellation_form == "legacy")
    assert result[2]["provider_cancellation"] == {
        "at_period_end": True, "scheduled_at": drill._epoch_iso(source["current_period_end"]),
        "source": "cancel_at_period_end" if cancellation_form == "legacy" else "cancel_at",
    }
    assert result[2]["kova"]["cancel_at_period_end"] is True
    assert result[2]["kova_access"]["allowed"] is True
    assert result[2]["limits"] == {"effective_cancellation": False, "tier_changes": "blocked"}


@pytest.mark.parametrize("nested", [False, True])
@pytest.mark.parametrize("kind", ["timestamp", "none", "zero", "bool", "string", "float", "past",
                                 "other_future", "overflow", "missing_period"])
def test_basic_cancellation_oracle_requires_exact_future_provider_period(nested, kind):
    end = int(time.time()) + 86400
    value = {"timestamp": end, "none": None, "zero": 0, "bool": True, "string": str(end),
             "float": float(end), "past": 1, "other_future": end + 86400,
             "overflow": 10**100, "missing_period": end}[kind]
    boundary = 1 if kind == "past" else (10**100 if kind == "overflow" else end)
    source = {"cancel_at_period_end": False, "cancel_at": value}
    if kind != "missing_period":
        if nested:
            source["items"] = {"data": [{"current_period_end": boundary}]}
        else:
            source["current_period_end"] = boundary
    assert drill._basic_portal_cancel_at_end(source, boundary) is (kind == "timestamp")
    if kind == "timestamp":
        assert drill._basic_portal_cancel_at_end(source, boundary + 1) is False


@pytest.mark.parametrize(
    "url",
    [
        "http://billing.stripe.com/p/test_private",
        "https://billing.stripe.com.evil.test/p/test_private",
        "https://user@billing.stripe.com/p/test_private",
        "https://api.stripe.com/p/test_private",
        "https://billing.stripe.com:8443/p/test_private",
        None,
    ],
)
def test_portal_opaque_path_does_not_expand_the_trusted_origin(tmp_path, monkeypatch, url):
    config = drill.validate_environment(_basic_environment(tmp_path))
    context = {"client": SimpleNamespace(request=lambda *args: {"portal_url": url})}

    def unexpected_browser(*args, **kwargs):
        raise AssertionError("Untrusted Portal origin must never reach the browser")

    monkeypatch.setattr(drill.subprocess, "run", unexpected_browser)
    with pytest.raises(drill.DrillError, match="accepted hosted Portal URL"):
        drill._submit_portal_action(config, context, "inspect")


@pytest.mark.parametrize(
    "reason",
    [
        "control_not_found",
        "control_disabled",
        "click_timeout",
        "unsafe_reason",
        "field_missing",
        "billing_country_missing",
        "billing_postal_missing",
    ],
)
def test_helper_failure_diagnostic_forwards_only_safe_enums(tmp_path, monkeypatch, reason):
    config = drill.validate_environment(_basic_environment(tmp_path))
    context = {
        "client": SimpleNamespace(
            request=lambda *args: {
                "portal_url": "https://billing.stripe.com/p/test_synthetic",
            }
        )
    }
    raw = (
        "KOV005_PORTAL_FAILURE_STAGE=save_payment_method\n"
        f"KOV005_PORTAL_FAILURE_REASON={reason}\n"
        "KOV005_PORTAL_PUBLIC_CONTROLS=save_changes:disabled,add_card:enabled,"
        "private.customer@example.com:enabled,https://billing.stripe.com/p/secret_bearer\n"
        "raw error contains a customer and private bearer\n"
    )
    monkeypatch.setattr(
        drill.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(
            returncode=1,
            stdout="",
            stderr=raw,
        ),
    )
    with pytest.raises(drill.DrillError) as error:
        drill._submit_portal_action(config, context, "payment_update")
    message = str(error.value)
    expected = "unknown" if reason == "unsafe_reason" else reason
    assert f"reason={expected}" in message
    assert "save_changes:disabled,add_card:enabled" in message
    assert "private" not in message and "bearer" not in message and "example.com" not in message
    assert "unsafe_reason" not in message


def _field_state(**overrides):
    field = {"kind": "card_number", "filled": False, "required": True, "html_valid": False,
             "aria_invalid": True, "checked": False, **overrides}
    if isinstance(field["kind"], str) and field["kind"] in {
        "card_number", "card_expiry", "card_cvc", "billing_country", "billing_postal",
    }:
        field.setdefault("fixture_match", False)
    return field


def test_field_state_parser_preserves_only_closed_enums_and_booleans():
    fields = [_field_state(), _field_state(filled=True, fixture_match=True),
              _field_state(kind="link_name")]
    assert drill._parse_portal_field_state("KOV005_PORTAL_FIELD_STATE=" + json.dumps(fields)) == fields
    assert drill._parse_portal_field_state("KOV005_PORTAL_FIELD_STATE=[]") == []
    assert drill._parse_portal_field_state("KOV005_PORTAL_FIELD_STATE=" + json.dumps(
        [_field_state() for _ in range(64)],
    )) is not None


@pytest.mark.parametrize("payload", [
    {"fields": []}, [None], ["private-secret"], [_field_state(kind="private-secret")],
    [_field_state(kind={"token": "private-secret"})], [_field_state(filled="true")],
    [_field_state(filled=1)], [_field_state(checked=None)],
    [_field_state(fixture_match=1)], [_field_state(fixture_match="true")],
    [_field_state(fixture_match=None)], [_field_state(fixture_match={"secret": "private-secret"})],
    [_field_state(kind="link_email", fixture_match=True)],
    [_field_state(aria_invalid={"token": "private-secret"})],
    [_field_state(value="private.card@example.com https://secret.invalid/bearer")],
    [_field_state(), _field_state(value="private-secret")],
    [_field_state() for _ in range(65)],
])
def test_field_state_parser_rejects_unknown_nested_keys_types_and_excess_fields(payload):
    assert drill._parse_portal_field_state("KOV005_PORTAL_FIELD_STATE=" + json.dumps(payload)) is None


@pytest.mark.parametrize("raw", [
    "KOV005_PORTAL_FIELD_STATE=not-json",
    "KOV005_PORTAL_FIELD_STATE=[]\nKOV005_PORTAL_FIELD_STATE=[]",
    "KOV005_PORTAL_FIELD_STATE=" + json.dumps([_field_state()]).replace(
        '"kind": "card_number"', '"kind": "private-secret", "kind": "card_number"',
    ),
    "KOV005_PORTAL_FIELD_STATE=[]" + " " * 16_384,
])
def test_field_state_parser_rejects_ambiguous_or_unbounded_envelopes(raw):
    assert drill._parse_portal_field_state(raw) is None


@pytest.mark.parametrize("valid", [True, False])
def test_helper_error_forwards_only_validated_field_state(tmp_path, monkeypatch, valid):
    config = drill.validate_environment(_basic_environment(tmp_path))
    context = {"client": SimpleNamespace(request=lambda *args: {
        "portal_url": "https://billing.stripe.com/p/test_synthetic",
    })}
    field = _field_state() if valid else _field_state(value="private.customer@secret.invalid/bearer")
    raw = ("KOV005_PORTAL_FAILURE_STAGE=save_payment_method\n"
           "KOV005_PORTAL_FAILURE_REASON=control_disabled\n"
           "KOV005_PORTAL_FIELD_STATE=" + json.dumps([field]) + "\nraw private error")
    monkeypatch.setattr(drill.subprocess, "run", lambda *args, **kwargs: SimpleNamespace(
        returncode=1, stdout="", stderr=raw,
    ))
    with pytest.raises(drill.DrillError) as error:
        drill._submit_portal_action(config, context, "payment_update")
    message = str(error.value)
    assert "reason=control_disabled" in message
    assert ('"kind":"card_number"' in message) is valid
    assert ("field_state=unavailable" in message) is not valid
    assert "private" not in message and "secret" not in message and "bearer" not in message



@pytest.mark.parametrize("kind", [
    "card_number", "card_expiry", "card_cvc", "billing_country", "billing_postal",
])
@pytest.mark.parametrize("matched", [False, True])
def test_fixture_match_is_strictly_boolean_and_required_only_for_test_fields(kind, matched):
    field = _field_state(kind=kind, fixture_match=matched)
    raw = "KOV005_PORTAL_FIELD_STATE=" + json.dumps([field])
    assert drill._parse_portal_field_state(raw) == [field]
    del field["fixture_match"]
    assert drill._parse_portal_field_state("KOV005_PORTAL_FIELD_STATE=" + json.dumps([field])) is None
