"""Sandbox runner guards and PG observers; no provider I/O or fake Actions process."""
from copy import deepcopy
from io import BytesIO
from types import SimpleNamespace
from urllib.error import HTTPError

import pytest

from app.tests.test_stripe_sandbox_drill import _environment
from scripts import stripe_sandbox_drill as drill


def _config(tmp_path, *, include=True):
    # A dictionary exercises the validator; it is never installed into os.environ
    # and no real runner/provider execution is authorized by these unit fixtures.
    env = _environment(tmp_path)
    if include:
        env["KOV005_INCLUDE_RISK"] = "true"
    return drill.validate_environment(env)


def _record(kind):
    return {"event_type": kind, "mapping": "matched" if kind == "charge.refunded"
            else "no_subscription", "livemode": False, "process_attempts": 1,
            "audit_entries": 1, "duplicate_idempotent": True,
            "commercial_state_unchanged": True, "ops_visible": True,
            "triage_persisted": True, "listener_received": True}


class StripeFixture:
    def __init__(self, config):
        self.config = config
        self.created = []
        self.deleted = []
        self.fail_intent = False
        self.objects = {
            "/v1/subscriptions/sub_qa": {"id": "sub_qa", "customer": "cus_checkout",
                                        "livemode": False},
            "/v1/invoices/in_qa": {"id": "in_qa", "customer": "cus_checkout", "livemode": False,
                                    "status": "paid", "parent": {"type": "subscription_details",
                                    "subscription_details": {"subscription": "sub_qa"}}},
            "/v1/payment_intents/pi_qa": {"id": "pi_qa", "customer": "cus_checkout",
                                          "status": "succeeded", "livemode": False,
                                          "latest_charge": "ch_qa"},
            "/v1/charges/ch_qa": {"id": "ch_qa", "customer": "cus_checkout", "livemode": False,
                                   "payment_intent": "pi_qa", "paid": True, "amount": 29900,
                                   "amount_refunded": 0, "currency": "mxn"},
        }

    def get(self, path, query=None):
        if path == "/v1/invoice_payments":
            return {"data": [{"id": "inpay_qa", "invoice": "in_qa", "livemode": False,
                              "status": "paid", "payment": {"type": "payment_intent",
                                                             "payment_intent": "pi_qa"}}],
                    "has_more": False}
        return deepcopy(self.objects[path])

    def post(self, path, data):
        self.created.append((path, data.copy()))
        if path == "/v1/refunds":
            assert data["charge"] == "ch_qa" and data["amount"] == 100
            assert data["metadata[kov005_risk]"].startswith("risk-")
            return {"id": "re_qa", "charge": "ch_qa", "amount": 100, "status": "succeeded"}
        if path == "/v1/customers":
            return {"id": "cus_fixture" + str(len(self.created)), "livemode": False}
        if path == "/v1/payment_intents":
            import json
            manifest = json.loads(self.config.cleanup_path.read_text())
            assert data["customer"] in manifest["customers"], "Must persist cleanup before charging"
            assert data["payment_method"] in {
                "pm_card_createDispute", "pm_card_createIssuerFraudRecord",
            }
            assert "default_payment_method" not in data
            if self.fail_intent:
                raise drill.DrillError("Synthetic provider fixture failure")
            return {"id": "pi_fixture", "livemode": False, "status": "succeeded",
                    "customer": data["customer"], "latest_charge": "ch_fixture"}
        raise AssertionError("Unexpected provider mutation")

    def delete(self, path):
        self.deleted.append(path)
        return {"deleted": True}


def _context():
    return {"tenant_id": "00000000-0000-0000-0000-000000000001", "stripe_session": {
        "id": "cs_test_qa", "livemode": False, "customer": "cus_checkout",
        "subscription": "sub_qa", "invoice": "in_qa", "status": "complete",
        "payment_status": "paid",
    }}


def _prepare(monkeypatch):
    state = {"subscription": {"stripe_customer_id": "cus_checkout",
                              "stripe_subscription_id": "sub_qa"}}
    monkeypatch.setattr(drill, "_snapshot", lambda *args: SimpleNamespace(
        status="active", payment_watermark_at="paid", lifecycle_watermark_at="created",
    ))
    monkeypatch.setattr(drill, "_risk_local_state", lambda *args: state)
    def accept(*args, **kwargs):
        assert kwargs["mapping"] == ("matched" if args[5] == "charge.refunded"
                                     else "no_subscription")
        return _record(args[5])
    monkeypatch.setattr(drill, "_accept_risk_event", accept)
    return state


def test_risk_opt_in_is_false_by_default_and_keeps_all_existing_guards(tmp_path):
    assert _config(tmp_path, include=False).include_risk is False
    assert _config(tmp_path).include_risk is True
    for key, value in {
        "GITHUB_ACTIONS": "false", "GITHUB_REF": "refs/heads/feature/test",
        "KOV005_CONFIRM": "yes", "KOV005_STRIPE_SECRET_KEY": "sk_live_" + "forbidden",
        "KOV005_EXECUTION_ENVIRONMENT": "production", "APP_ENV": "production",
        "KOV005_APP_BASE_URL": "https://kovasuite.com",
    }.items():
        env = {**_environment(tmp_path), "KOV005_INCLUDE_RISK": "true", key: value}
        with pytest.raises(drill.DrillError):
            drill.validate_environment(env)
    env = {**_environment(tmp_path), "KOV005_INCLUDE_RISK": "yes"}
    with pytest.raises(drill.DrillError, match="false or true"):
        drill.validate_environment(env)


@pytest.mark.parametrize("enabled", [False, True])
def test_only_opt_in_listener_subscribes_risk_types_without_key_in_arguments(
    tmp_path, monkeypatch, enabled,
):
    config = _config(tmp_path, include=enabled)
    invocations = []
    monkeypatch.setattr(drill.subprocess, "Popen", lambda args, **kwargs:
                        invocations.append((args, kwargs)) or object())
    monkeypatch.setattr(drill, "_read_listener_secret", lambda *_args: "whsec_synthetic")
    drill._start_stripe_listener(config)
    args, kwargs = invocations[0]
    subscribed = set(args[args.index("--events") + 1].split(","))
    assert subscribed == drill.EVENT_TYPES | (drill.RISK_EVENTS if enabled else set())
    assert "--live" not in args and config.stripe_key not in " ".join(args)
    assert kwargs["env"]["STRIPE_API_KEY"].startswith("sk_test_")


@pytest.mark.parametrize(("path", "field", "value"), [
    ("/v1/charges/ch_qa", "livemode", True),
    ("/v1/charges/ch_qa", "customer", "cus_somebody_else"),
    ("/v1/charges/ch_qa", "payment_intent", "pi_somebody_else"),
    ("/v1/charges/ch_qa", "amount", 1),
    ("/v1/charges/ch_qa", "amount", 99),
    ("/v1/charges/ch_qa", "amount", 100),
    ("/v1/charges/ch_qa", "amount_refunded", 1),
    ("/v1/payment_intents/pi_qa", "livemode", True),
    ("/v1/payment_intents/pi_qa", "customer", "cus_somebody_else"),
    ("/v1/invoices/in_qa", "customer", "cus_somebody_else"),
    ("/v1/invoices/in_qa", "parent", {"type": "subscription_details",
                                       "subscription_details": {"subscription": "sub_other"}}),
    ("/v1/subscriptions/sub_qa", "livemode", True),
    ("/v1/subscriptions/sub_qa", "customer", "cus_somebody_else"),
])
def test_refund_cannot_start_before_checkout_ownership_is_proven(
    tmp_path, monkeypatch, path, field, value,
):
    config = _config(tmp_path)
    _prepare(monkeypatch)
    stripe = StripeFixture(config)
    stripe.objects[path][field] = value
    with pytest.raises(drill.DrillError):
        drill._run_risk_acceptance(stripe, config, None, _context(), "whsec_synthetic", [], [])
    assert stripe.created == []


def test_three_official_risk_fixtures_register_only_owned_cleanup_before_charging(tmp_path, monkeypatch):
    config = _config(tmp_path)
    _prepare(monkeypatch)
    stripe = StripeFixture(config)
    customers = []
    records = drill._run_risk_acceptance(
        stripe, config, None, _context(), "whsec_synthetic", [], customers,
    )
    assert {item["event_type"] for item in records} == drill.RISK_EVENTS
    assert len(customers) == 2
    assert len({data["metadata[kov005_risk]"] for _, data in stripe.created}) == 1
    assert [path for path, _ in stripe.created] == [
        "/v1/refunds", "/v1/customers", "/v1/payment_intents", "/v1/customers", "/v1/payment_intents",
    ]
    for path, data in stripe.created:
        if path == "/v1/payment_intents":
            assert data["automatic_payment_methods[allow_redirects]"] == "never"
            assert data["automatic_payment_methods[enabled]"] == "true"
            assert not any(key.startswith("payment_method_types") for key in data)
    assert drill.cleanup_provider_objects(config, stripe)["customers_deleted"] == 2
    assert set(stripe.deleted) == {"/v1/customers/" + value for value in customers}
    assert not config.cleanup_path.exists()


def test_fixture_failure_stops_local_processes_cleans_owned_customers_and_emits_no_evidence(
    tmp_path, monkeypatch,
):
    config = _config(tmp_path)
    _prepare(monkeypatch)
    stripe = StripeFixture(config)
    stripe.fail_intent = True
    stopped = []
    monkeypatch.setattr(drill, "StripeTestClient", lambda *_args, **_kwargs: stripe)
    monkeypatch.setattr(drill, "validate_stripe_preflight", lambda *_args: {})
    monkeypatch.setattr(drill, "_start_stripe_listener", lambda *_args: ("listener", "whsec_fake"))
    monkeypatch.setattr(drill, "_start_backend", lambda *_args: "backend")
    monkeypatch.setattr(drill, "_wait_for_health", lambda *_args: None)
    monkeypatch.setattr(drill, "create_engine", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(drill, "_stop_process", stopped.append)
    def checkout(_stripe, _config, _engine, clocks, customers, *, context):
        context.update(_context())
        customers.append("cus_checkout")
        drill._persist_cleanup(config, clocks, customers)
        return {}
    monkeypatch.setattr(drill, "_run_checkout", checkout)
    with pytest.raises(drill.DrillError, match="fixture failure"):
        drill.run(config)
    assert set(stopped) == {"listener", "backend"}
    assert len(stripe.deleted) == 2 and "/v1/customers/cus_checkout" in stripe.deleted
    assert not config.evidence_path.exists()
    assert not config.cleanup_path.exists()


def test_risk_evidence_requires_all_types_and_projects_no_external_data():
    records = [_record(kind) for kind in sorted(drill.RISK_EVENTS)]
    records[0]["raw_external"] = "sk_test_" + "NEVERPERSIST pi_secret_NEVERPERSIST qa@example.invalid"
    text = "\n".join(drill._render_risk_evidence(records))
    assert "NEVERPERSIST" not in text and "@example.invalid" not in text
    assert "MFA UI" in text and "global no_subscription" in text
    assert "100 MXN minor units (MXN 1.00)" in text
    assert '"audit_entries": 1' in text and '"process_attempts": 1' in text
    for invalid in [records[:2], [records[0]] * 3]:
        with pytest.raises(drill.DrillError):
            drill._render_risk_evidence(invalid)
    for field, value in [("livemode", True), ("mapping", "lookup_unavailable"),
                         ("audit_entries", 2), ("ops_visible", False), ("listener_received", False)]:
        invalid = deepcopy(records)
        invalid[0][field] = value
        with pytest.raises(drill.DrillError):
            drill._render_risk_evidence(invalid)


def test_endive_risk_http_reads_and_errors_never_reveal_provider_ids(tmp_path, monkeypatch):
    calls = []
    def respond(request, **kwargs):
        calls.append(request)
        return BytesIO(b'{"data":[],"has_more":false}')
    monkeypatch.setattr(drill, "urlopen", respond)
    stripe = drill.StripeTestClient("sk_test_" + "synthetic", api_version=drill.StripeRiskClient.API_VERSION)
    stripe.get("/v1/invoice_payments", query=[("status", "paid")])
    assert calls[0].headers["Stripe-version"] == "2026-09-30.endive"
    def fail(request, **kwargs):
        raise HTTPError(request.full_url, 403, "private", {}, BytesIO(b"NEVER_PERSIST"))
    monkeypatch.setattr(drill, "urlopen", fail)
    with pytest.raises(drill.DrillError) as error:
        stripe.get("/v1/payment_intents/pi_NEVER_PERSIST")
    assert "NEVER_PERSIST" not in str(error.value)


def test_risk_is_noop_without_opt_in_and_never_contacts_a_provider(tmp_path):
    assert drill._run_risk_acceptance(None, _config(tmp_path, include=False), None,
                                      {}, "unused", [], []) == []


@pytest.mark.parametrize("change_at", [0, 1])
def test_changed_commercial_state_cannot_be_accepted_even_with_processed_delivery(
    tmp_path, monkeypatch, change_at,
):
    config = _config(tmp_path)
    context = {**_context(), "client": SimpleNamespace(request=lambda *_args: {
        "user": {"id": "00000000-0000-0000-0000-000000000002"},
    })}
    baseline = {"state": "original"}
    reads = iter([{"state": "changed"} if index == change_at else baseline
                  for index in range(2)])
    monkeypatch.setattr(drill, "_wait_risk_event", lambda *_args: {"id": "evt_synthetic"})
    monkeypatch.setattr(drill, "_risk_delivery_state", lambda *_args:
                        {"process_attempts": 1, "audit_entries": 1})
    monkeypatch.setattr(drill, "_risk_local_state", lambda *_args: next(reads))
    monkeypatch.setattr(drill, "_deliver_event", lambda *_args: ({"status": "processed"}, "time"))
    monkeypatch.setattr(drill, "_risk_ops_triage", lambda *_args: None)
    with pytest.raises(drill.DrillError, match="changed Kova"):
        drill._accept_risk_event(None, config, None, context, "whsec_synthetic",
                                 "charge.refunded", "ch_synthetic", 0, baseline, mapping="matched")


def test_missing_official_risk_event_times_out_without_raw_ids_or_payload(tmp_path, monkeypatch):
    ticks = iter([0, 1, 100])
    monkeypatch.setattr(drill.time, "monotonic", lambda: next(ticks))
    monkeypatch.setattr(drill.time, "sleep", lambda *_args: None)
    monkeypatch.setattr(drill, "_risk_pages", lambda *_args: [])
    with pytest.raises(drill.DrillError, match="did not emit") as error:
        drill._wait_risk_event(None, "radar.early_fraud_warning.created", "ch_PRIVATE", 0)
    assert "PRIVATE" not in str(error.value)


def test_real_pg_delivery_and_ops_triage_observers_require_exact_proof(db, monkeypatch):
    from contextlib import nullcontext
    from uuid import uuid4

    from app.billing import risk
    from app.config import settings
    from app.tests.test_stripe_risk import SyntheticStripe, deliver, event, seed

    tenant, subscription = seed(db)
    monkeypatch.setattr(risk, "client", SyntheticStripe())
    monkeypatch.setattr(settings, "stripe_secret_key", "synthetic-risk-read-key")
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_risk_synthetic")
    # Keep helper sessions inside pytest's real PostgreSQL rollback transaction.
    monkeypatch.setattr(drill, "Session", lambda *_args: nullcontext(db))
    payload = event()
    deliver(db, payload)
    assert drill._risk_delivery_state(None, payload, str(tenant.id), "matched") == {
        "process_attempts": 1, "audit_entries": 1,
    }
    with pytest.raises(drill.DrillError, match="ownership"):
        drill._risk_delivery_state(None, payload, None, "no_subscription")
    drill._risk_ops_triage(None, payload["id"], uuid4())
    assert drill.ops_repository.get_incident_state(
        db, source="stripe_webhook", external_id=payload["id"],
    ).triage_status == "resolved"
    assert drill.ops_repository.unresolved_risk_count(db) == 0
    db.refresh(subscription)
    assert subscription.status == "active"


def test_failed_fixture_cleanup_keeps_its_durable_manifest_for_retry(tmp_path):
    config = _config(tmp_path)
    stripe = StripeFixture(config)
    drill._persist_cleanup(config, [], ["cus_own_fixture"])
    def fail(_path):
        raise drill.DrillError("Synthetic cleanup failure")
    stripe.delete = fail
    with pytest.raises(drill.DrillError, match="could not be deleted"):
        drill.cleanup_provider_objects(config, stripe)
    assert "cus_own_fixture" in config.cleanup_path.read_text()
    assert not config.evidence_path.exists()


def test_owned_charge_above_qa_refund_amount_remains_partial(tmp_path):
    config = _config(tmp_path)
    stripe = StripeFixture(config)
    stripe.objects["/v1/charges/ch_qa"]["amount"] = 101
    owned = {"stripe_customer_id": "cus_checkout", "stripe_subscription_id": "sub_qa"}
    assert drill._owned_risk_charge(stripe, _context(), owned)["amount"] == 101
    assert stripe.created == []


@pytest.mark.parametrize("returned_amount", [1, 99, 101])
def test_risk_refund_requires_exact_qa_amount_in_provider_response(
    tmp_path, monkeypatch, returned_amount,
):
    config = _config(tmp_path)
    _prepare(monkeypatch)
    stripe = StripeFixture(config)
    post = stripe.post
    def wrong_amount(path, data):
        result = post(path, data)
        return {**result, "amount": returned_amount} if path == "/v1/refunds" else result
    monkeypatch.setattr(stripe, "post", wrong_amount)
    with pytest.raises(drill.DrillError, match="exactly 100 MXN minor units"):
        drill._run_risk_acceptance(stripe, config, None, _context(), "whsec_synthetic", [], [])
    assert [path for path, _ in stripe.created] == ["/v1/refunds"]
