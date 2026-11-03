#!/usr/bin/env python3
"""Run KOV-005 against Stripe test mode and an isolated local Kova stack.

The script is intentionally unsuitable for production: it requires a GitHub
Actions runner, a loopback-only application/database, an explicit operator
acknowledgement, and a Stripe test/restricted-test key. It never prints raw
Stripe identifiers, Checkout URLs, credentials, or customer data.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import queue
import re
import secrets
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from decimal import Decimal
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import HTTPCookieProcessor, Request, build_opener, urlopen
from uuid import UUID

from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = BACKEND_ROOT.parent
sys.path.insert(0, str(BACKEND_ROOT))

from app.audit.models import AuditLog  # noqa: E402
from app.billing.models import Subscription, WebhookEvent  # noqa: E402
from app.billing.plans import PLANS, build_plan_snapshot  # noqa: E402
from app.billing.risk import RISK_EVENTS  # noqa: E402
from app.billing.stripe_client import StripeRiskClient  # noqa: E402
from app.config import sqlalchemy_database_url  # noqa: E402
from app.ops import incidents as ops_incidents  # noqa: E402
from app.ops import repository as ops_repository  # noqa: E402
from app.orders.models import Payment, Refund  # noqa: E402

ACKNOWLEDGEMENT = "KOV-005-STRIPE-SANDBOX-ONLY"
EXPECTED_ENVIRONMENT = "stripe-sandbox"
EVENT_TYPES = {
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_succeeded",
    "invoice.payment_failed",
}
SECRET_RE = re.compile(r"(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+")


class DrillError(RuntimeError):
    """A safe, operator-actionable failure."""


@dataclass(frozen=True)
class DrillConfig:
    stripe_key: str
    price_id: str
    expected_account_id: str
    database_url: str
    app_base_url: str
    frontend_origin: str
    evidence_path: Path
    cleanup_path: Path
    checkout_helper: Path
    release_sha: str
    plan_code: str
    price_ids: dict[str, str]
    include_risk: bool = False
    include_portal: bool = False
    portal_mode: str = "basic"
    portal_configuration_id: str | None = None
    portal_helper: Path | None = None


@dataclass(frozen=True)
class SubscriptionSnapshot:
    status: str
    plan_code: str
    amount_minor_units: int
    currency: str
    features: list[str]
    cancel_at_period_end: bool
    current_period_end: str | None
    past_due_at: str | None
    grace_period_ends_at: str | None
    lifecycle_watermark_at: str | None
    lifecycle_event_type: str | None
    lifecycle_event_id: str | None
    payment_watermark_at: str | None
    payment_event_type: str | None
    payment_event_id: str | None
    plan_effective_until: str | None = None


def _utc_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    normalized = value if value.tzinfo else value.replace(tzinfo=UTC)
    return normalized.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _epoch_iso(value: Any) -> str | None:
    try:
        return datetime.fromtimestamp(int(value), tz=UTC).isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError, OSError):
        return None


def redact_identifier(value: str | None) -> str | None:
    if not value:
        return None
    prefix = value.split("_", 1)[0]
    if value.startswith("cs_test_"):
        prefix = "cs_test"
    suffix = value[-6:] if len(value) > 6 else "*" * len(value)
    return f"{prefix}_…{suffix}"


def _require_loopback_url(value: str, *, name: str) -> None:
    parsed = urlparse(value)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise DrillError(f"{name} must be an http loopback URL")


def validate_environment(environ: dict[str, str]) -> DrillConfig:
    plan_code = environ.get("KOV005_PLAN_CODE", "standard")
    if plan_code not in PLANS:
        raise DrillError("KOV005_PLAN_CODE must be standard, esencial or gestion")
    risk_value = environ.get("KOV005_INCLUDE_RISK", "false")
    if risk_value not in {"false", "true"}:
        raise DrillError("KOV005_INCLUDE_RISK must be false or true")
    include_risk = risk_value == "true"
    include_portal_value = environ.get("KOV005_INCLUDE_PORTAL", "false")
    if include_portal_value not in {"false", "true"}:
        raise DrillError("KOV005_INCLUDE_PORTAL must be false or true")
    include_portal = include_portal_value == "true"
    portal_mode = environ.get("KOV005_PORTAL_MODE", "basic")
    if portal_mode not in {"basic", "transitions"}:
        raise DrillError("KOV005_PORTAL_MODE must be basic or transitions")
    if include_portal and portal_mode == "transitions" and plan_code == "gestion":
        raise DrillError("Portal transition acceptance must start from standard or esencial")
    portal_cohort = "STANDARD" if plan_code == "standard" else "TIERED"
    portal_name = f"KOV005_STRIPE_{portal_cohort}_PORTAL_CONFIGURATION_ID"
    codes = ("standard",) if plan_code == "standard" else ("standard", "esencial", "gestion")
    required = {
        "KOV005_STRIPE_SECRET_KEY",
        "KOV005_STRIPE_STANDARD_PRICE_ID",
        "KOV005_STRIPE_ACCOUNT_ID",
        "DATABASE_URL",
        "KOV005_EVIDENCE_PATH",
        "KOV005_CLEANUP_PATH",
    }
    required.update(f"KOV005_STRIPE_{code.upper()}_PRICE_ID" for code in codes)
    if include_portal:
        required.add(portal_name)
    missing = sorted(name for name in required if not environ.get(name))
    if missing:
        raise DrillError(f"Missing required configuration names: {', '.join(missing)}")
    if environ.get("GITHUB_ACTIONS") != "true":
        raise DrillError("The provider drill is restricted to GitHub Actions")
    if environ.get("GITHUB_REF") != "refs/heads/main":
        raise DrillError("The provider drill can only run from refs/heads/main")
    if environ.get("KOV005_EXECUTION_ENVIRONMENT") != EXPECTED_ENVIRONMENT:
        raise DrillError(f"KOV005_EXECUTION_ENVIRONMENT must be {EXPECTED_ENVIRONMENT}")
    if environ.get("KOV005_CONFIRM") != ACKNOWLEDGEMENT:
        raise DrillError(f"KOV005_CONFIRM must equal {ACKNOWLEDGEMENT}")
    if environ.get("APP_ENV") != "local":
        raise DrillError("APP_ENV must be local for the isolated drill")
    if environ.get("STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION", "").lower() in {"1", "true", "yes"}:
        raise DrillError("STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION must remain disabled")

    stripe_key = environ["KOV005_STRIPE_SECRET_KEY"]
    if not stripe_key.startswith(("sk_test_", "rk_test_")):
        raise DrillError("KOV005_STRIPE_SECRET_KEY must be a Stripe test-mode key")
    price_ids = {code: environ[f"KOV005_STRIPE_{code.upper()}_PRICE_ID"] for code in codes}
    if any(not value.startswith("price_") for value in price_ids.values()):
        raise DrillError("Configured sandbox plan prices must be Stripe Price ids")
    if len(set(price_ids.values())) != len(price_ids):
        raise DrillError("Sandbox commercial plans must use distinct Price ids")
    if not environ["KOV005_STRIPE_ACCOUNT_ID"].startswith("acct_"):
        raise DrillError("KOV005_STRIPE_ACCOUNT_ID must be a Stripe account id")

    portal_id = environ.get(portal_name) if include_portal else None
    if portal_id and re.fullmatch(r"bpc_[A-Za-z0-9]+", portal_id) is None:
        raise DrillError("Sandbox Portal configuration must be a configuration id")

    database = make_url(sqlalchemy_database_url(environ["DATABASE_URL"]))
    if database.get_backend_name() != "postgresql" or database.host not in {
        "127.0.0.1",
        "localhost",
        "::1",
    }:
        raise DrillError("DATABASE_URL must point to loopback PostgreSQL")
    app_base_url = environ.get("KOV005_APP_BASE_URL", "http://127.0.0.1:8000")
    frontend_origin = environ.get("FRONTEND_URL", "http://127.0.0.1:5173")
    _require_loopback_url(app_base_url, name="KOV005_APP_BASE_URL")
    _require_loopback_url(frontend_origin, name="FRONTEND_URL")

    return DrillConfig(
        stripe_key=stripe_key,
        price_id=price_ids[plan_code],
        plan_code=plan_code,
        price_ids=price_ids,
        include_risk=include_risk,
        include_portal=include_portal,
        portal_mode=portal_mode,
        portal_configuration_id=portal_id,
        portal_helper=REPOSITORY_ROOT / "frontend/scripts/complete-stripe-test-portal.mjs",
        expected_account_id=environ["KOV005_STRIPE_ACCOUNT_ID"],
        database_url=sqlalchemy_database_url(environ["DATABASE_URL"]),
        app_base_url=app_base_url.rstrip("/"),
        frontend_origin=frontend_origin.rstrip("/"),
        evidence_path=Path(environ["KOV005_EVIDENCE_PATH"]).resolve(),
        cleanup_path=Path(environ["KOV005_CLEANUP_PATH"]).resolve(),
        checkout_helper=Path(
            environ.get(
                "KOV005_CHECKOUT_HELPER",
                REPOSITORY_ROOT / "frontend" / "scripts" / "complete-stripe-test-checkout.mjs",
            )
        ).resolve(),
        release_sha=environ.get("GITHUB_SHA", "unknown"),
    )


class StripeTestClient:
    def __init__(self, key: str, *, api_version: str | None = None) -> None:
        self._key = key
        self._api_version = api_version

    def request(
        self,
        method: str,
        path: str,
        data: dict[str, Any] | None = None,
        query: list[tuple[str, str]] | None = None,
    ) -> dict[str, Any]:
        url = f"https://api.stripe.com{path}"
        if query:
            url = f"{url}?{urlencode(query)}"
        body = None if data is None else urlencode(data).encode()
        request = Request(
            url,
            data=body,
            method=method,
            headers={
                "Authorization": f"Bearer {self._key}",
                "Content-Type": "application/x-www-form-urlencoded",
                **({"Stripe-Version": self._api_version} if self._api_version else {}),
            },
        )
        diagnostic_path = path if self._api_version is None else "sandbox risk resource"
        try:
            with urlopen(request, timeout=20) as response:
                payload = json.loads(response.read())
        except HTTPError as exc:
            exc.read()
            raise DrillError(
                f"Stripe API request failed with HTTP {exc.code} at {diagnostic_path}"
            ) from None
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise DrillError(
                f"Stripe API request failed at {diagnostic_path}: {type(exc).__name__}"
            ) from None
        if not isinstance(payload, dict):
            raise DrillError(f"Stripe API returned an invalid object at {diagnostic_path}")
        return payload

    def get(self, path: str, query: list[tuple[str, str]] | None = None) -> dict[str, Any]:
        return self.request("GET", path, query=query)

    def post(self, path: str, data: dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", path, data=data)

    def delete(self, path: str) -> dict[str, Any]:
        return self.request("DELETE", path)


def validate_stripe_preflight(
    stripe: StripeTestClient, config: DrillConfig
) -> dict[str, Any]:
    account = stripe.get("/v1/account")
    if account.get("id") != config.expected_account_id:
        raise DrillError("Stripe key does not belong to the configured sandbox account")
    codes = ("standard",) if config.plan_code == "standard" else ("esencial", "gestion")
    for code in codes:
        plan = PLANS[code]
        price_id = config.price_ids[code]
        price = stripe.get(f"/v1/prices/{price_id}")
        recurring = price.get("recurring") or {}
        if (
            price.get("id") != price_id
            or price.get("livemode") is not False
            or price.get("active") is not True
            or price.get("unit_amount") != plan.amount_minor_units
            or str(price.get("currency", "")).upper() != "MXN"
            or recurring.get("interval") != "month"
            or recurring.get("interval_count") != 1
            or (plan.tax_inclusive and price.get("tax_behavior") != "inclusive")
        ):
            raise DrillError(f"Sandbox price does not match the server catalog for {code}")
    portal_config = _portal_preflight(stripe, config) if config.include_portal else None
    plan = PLANS[config.plan_code]
    return {
        "portal_configuration": portal_config,
        "account_id": redact_identifier(str(account.get("id") or "")),
        "price_id": redact_identifier(config.price_id),
        "plan_code": config.plan_code,
        "livemode": False,
        "amount_minor_units": plan.amount_minor_units,
        "currency": "MXN",
        "interval": "month",
        "interval_count": 1,
        "tax_inclusive": plan.tax_inclusive,
    }


class KovaClient:
    def __init__(self, base_url: str, origin: str) -> None:
        self.base_url = base_url
        self.origin = origin
        self.cookies = CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.cookies))

    def request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        data = None if payload is None else json.dumps(payload).encode()
        outgoing = {"Accept": "application/json", "Origin": self.origin}
        if data is not None:
            outgoing["Content-Type"] = "application/json"
        outgoing.update(headers or {})
        csrf = next((cookie.value for cookie in self.cookies if cookie.name == "csrf_token"), None)
        if csrf and method in {"POST", "PUT", "PATCH", "DELETE"}:
            outgoing["X-CSRF-Token"] = csrf
        request = Request(f"{self.base_url}{path}", data=data, headers=outgoing, method=method)
        try:
            with self.opener.open(request, timeout=20) as response:
                raw = response.read()
        except HTTPError as exc:
            exc.read()
            raise DrillError(f"Kova returned HTTP {exc.code} at {path}") from exc
        except (URLError, TimeoutError) as exc:
            raise DrillError(f"Kova request failed at {path}: {type(exc).__name__}") from exc
        if not raw:
            return {}
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            raise DrillError(f"Kova returned an invalid response at {path}")
        return parsed

    def create_verified_owner(self, suffix: str) -> str:
        email = f"kov005-{suffix}@example.com"
        password = f"Kov005-{suffix}-71"
        offer = self.request("GET", "/api/v1/billing/plans")
        payload = {"email": email, "password": password,
                   "tenant_name": f"KOV-005 Stripe Sandbox {suffix}", "accepted_terms": True}
        revision = offer.get("offer_revision")
        if isinstance(revision, str) and revision:
            payload["billing_offer_revision"] = revision
        signup = self.request("POST", "/api/v1/auth/signup", payload)
        tenant_id = str(signup.get("tenant_id") or "")
        token = str(signup.get("dev_verification_token") or "")
        if not tenant_id or not token:
            raise DrillError("Local signup did not return isolated QA identifiers")
        self.request("POST", "/api/v1/auth/verify", {"token": token})
        self.request("POST", "/api/v1/auth/login", {"email": email, "password": password})
        return tenant_id


def _read_listener_secret(process: subprocess.Popen[str], timeout_seconds: int = 30) -> str:
    lines: queue.Queue[str | None] = queue.Queue()

    def read_lines() -> None:
        assert process.stdout is not None
        for line in process.stdout:
            lines.put(line)
        lines.put(None)

    threading.Thread(target=read_lines, daemon=True).start()
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            line = lines.get(timeout=0.5)
        except queue.Empty:
            if process.poll() is not None:
                break
            continue
        if line is None:
            break
        match = re.search(r"whsec_[A-Za-z0-9]+", line)
        if match:
            return match.group(0)
    raise DrillError("Stripe CLI listener did not provide an ephemeral signing secret")


def _start_stripe_listener(config: DrillConfig) -> tuple[subprocess.Popen[str], str]:
    child_env = os.environ.copy()
    child_env["STRIPE_API_KEY"] = config.stripe_key
    process = subprocess.Popen(
        [
            "stripe",
            "listen",
            "--forward-to",
            f"{config.app_base_url}/api/v1/billing/webhooks/stripe",
            "--events",
            ",".join(sorted(EVENT_TYPES | (RISK_EVENTS if config.include_risk else set()))),
        ],
        cwd=REPOSITORY_ROOT,
        env=child_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    try:
        return process, _read_listener_secret(process)
    except Exception:
        _stop_process(process)
        raise


def _backend_environment(config: DrillConfig, webhook_secret: str) -> dict[str, str]:
    child_env = os.environ.copy()
    child_env.update(
        {
            "APP_ENV": "local",
            "DATABASE_URL": config.database_url,
            "APP_DATABASE_URL": config.database_url,
            "MIGRATION_DATABASE_URL": config.database_url,
            "FRONTEND_URL": config.frontend_origin,
            "SECRET_KEY": secrets.token_urlsafe(48),
            "STRIPE_SECRET_KEY": config.stripe_key,
            "STRIPE_WEBHOOK_SECRET": webhook_secret,
            "STRIPE_STANDARD_PRICE_ID": config.price_ids["standard"],
            "STRIPE_ESENCIAL_PRICE_ID": config.price_ids.get("esencial", ""),
            "STRIPE_GESTION_PRICE_ID": config.price_ids.get("gestion", ""),
            "BILLING_TIERED_PLANS_ENABLED": str(config.plan_code != "standard").lower(),
            "BILLING_PORTAL_ENABLED": str(config.include_portal).lower(),
            "STRIPE_STANDARD_PORTAL_CONFIGURATION_ID": (
                config.portal_configuration_id if config.plan_code == "standard" else ""
            ) or "",
            "STRIPE_TIERED_PORTAL_CONFIGURATION_ID": (
                config.portal_configuration_id if config.plan_code != "standard" else ""
            ) or "",
            "STRIPE_CHECKOUT_SUCCESS_URL": f"{config.app_base_url}/health",
            "STRIPE_CHECKOUT_CANCEL_URL": f"{config.app_base_url}/health",
            "STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION": "false",
            "RESEND_API_KEY": "",
            "INTERNAL_ADMIN_EMAILS": "",
        }
    )
    return child_env


def _start_backend(config: DrillConfig, webhook_secret: str) -> subprocess.Popen[str]:
    child_env = _backend_environment(config, webhook_secret)
    log_file = tempfile.TemporaryFile(mode="w+", encoding="utf-8")
    process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=BACKEND_ROOT,
        env=child_env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        text=True,
    )
    process._kova_log_file = log_file  # type: ignore[attr-defined]
    return process


def _stop_process(process: subprocess.Popen[str] | None) -> None:
    if process is None:
        return
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    log_file = getattr(process, "_kova_log_file", None)
    if log_file is not None:
        log_file.close()


def _wait_for_health(config: DrillConfig, process: subprocess.Popen[str]) -> None:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise DrillError("The isolated Kova backend exited during startup")
        try:
            with urlopen(f"{config.app_base_url}/health", timeout=2) as response:
                if response.status == 200:
                    return
        except (HTTPError, URLError, TimeoutError):
            time.sleep(0.25)
    raise DrillError("The isolated Kova backend did not become healthy")


def _assert_test_object(value: dict[str, Any], *, object_name: str) -> None:
    if value.get("livemode") is not False:
        raise DrillError(f"Stripe {object_name} was not explicitly test mode")


def _related_subscription(event: dict[str, Any]) -> str | None:
    event_type = str(event.get("type") or "")
    stripe_object = event.get("data", {}).get("object", {})
    if event_type.startswith("customer.subscription."):
        return stripe_object.get("id")
    return stripe_object.get("subscription") or (
        stripe_object.get("parent", {}).get("subscription_details", {}).get("subscription")
    )


def select_subscription_events(
    events: list[dict[str, Any]], subscription_id: str, event_types: set[str]
) -> list[dict[str, Any]]:
    selected = [
        event
        for event in events
        if event.get("type") in event_types
        and _related_subscription(event) == subscription_id
        and event.get("livemode") is False
    ]
    return sorted(selected, key=lambda event: (int(event.get("created") or 0), str(event["id"])))


def _list_events(stripe: StripeTestClient) -> list[dict[str, Any]]:
    response = stripe.get("/v1/events", query=[("limit", "100")])
    data = response.get("data")
    if not isinstance(data, list):
        raise DrillError("Stripe Events response did not contain a list")
    return [item for item in data if isinstance(item, dict)]


def _matching_event_ids(
    stripe: StripeTestClient, subscription_id: str, event_types: set[str]
) -> set[str]:
    return {
        str(event["id"])
        for event in select_subscription_events(
            _list_events(stripe), subscription_id, event_types
        )
    }


def _wait_for_event(
    stripe: StripeTestClient,
    subscription_id: str,
    event_types: set[str],
    *,
    exclude_ids: set[str] | None = None,
    timeout_seconds: int = 45,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        candidates = select_subscription_events(_list_events(stripe), subscription_id, event_types)
        if exclude_ids:
            candidates = [event for event in candidates if event.get("id") not in exclude_ids]
        if candidates:
            return candidates[-1]
        time.sleep(1)
    raise DrillError(f"Stripe did not emit expected event types: {', '.join(sorted(event_types))}")


def _advance_clock(stripe: StripeTestClient, clock_id: str, frozen_time: int) -> None:
    clock = stripe.post(
        f"/v1/test_helpers/test_clocks/{clock_id}/advance", {"frozen_time": frozen_time}
    )
    _assert_test_object(clock, object_name="test clock")
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        clock = stripe.get(f"/v1/test_helpers/test_clocks/{clock_id}")
        _assert_test_object(clock, object_name="test clock")
        if clock.get("status") == "ready":
            return
        time.sleep(1)
    raise DrillError("Stripe test clock did not return to ready")


def _create_payment_method(stripe: StripeTestClient, token: str) -> dict[str, Any]:
    payment_method = stripe.post(
        "/v1/payment_methods", {"type": "card", "card[token]": token}
    )
    _assert_test_object(payment_method, object_name="payment method")
    return payment_method


def _create_clock_subscription(
    stripe: StripeTestClient,
    config: DrillConfig,
    cleanup_clocks: list[str],
    cleanup_customers: list[str],
    *,
    tenant_id: str,
    label: str,
    price_id: str,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    clock = stripe.post(
        "/v1/test_helpers/test_clocks",
        {"frozen_time": int(time.time()), "name": f"KOV-005 {label}"},
    )
    _assert_test_object(clock, object_name="test clock")
    cleanup_clocks.append(clock["id"])
    _persist_cleanup(config, cleanup_clocks, cleanup_customers)
    customer = stripe.post(
        "/v1/customers",
        {
            "test_clock": clock["id"],
            "name": f"KOV-005 Sandbox {label}",
            "metadata[tenant_id]": tenant_id,
        },
    )
    _assert_test_object(customer, object_name="customer")
    payment_method = _create_payment_method(stripe, "tok_visa")
    stripe.post(
        f"/v1/payment_methods/{payment_method['id']}/attach", {"customer": customer["id"]}
    )
    stripe.post(
        f"/v1/customers/{customer['id']}",
        {"invoice_settings[default_payment_method]": payment_method["id"]},
    )
    subscription = stripe.post(
        "/v1/subscriptions",
        {
            "customer": customer["id"],
            "items[0][price]": price_id,
            "default_payment_method": payment_method["id"],
            "metadata[tenant_id]": tenant_id,
            "payment_behavior": "error_if_incomplete",
        },
    )
    _assert_test_object(subscription, object_name="subscription")
    return clock, customer, payment_method, subscription


def _seed_subscription_mapping(
    engine: Any, *, tenant_id: str, customer_id: str, subscription_id: str, price_id: str
) -> None:
    parsed_tenant_id = UUID(tenant_id)
    with Session(engine) as db:
        existing = db.scalar(
            select(Subscription).where(Subscription.tenant_id == parsed_tenant_id)
        )
        if existing is None:
            existing = Subscription(tenant_id=parsed_tenant_id)
            db.add(existing)
        existing.stripe_customer_id = customer_id
        existing.stripe_subscription_id = subscription_id
        existing.stripe_price_id = price_id
        existing.status = "incomplete"
        db.commit()


def _snapshot(engine: Any, tenant_id: str) -> SubscriptionSnapshot:
    parsed_tenant_id = UUID(tenant_id)
    with Session(engine) as db:
        subscription = db.scalar(
            select(Subscription).where(Subscription.tenant_id == parsed_tenant_id)
        )
        if subscription is None:
            raise DrillError("Expected local subscription mapping was not found")
        return SubscriptionSnapshot(
            status=subscription.status,
            plan_code=subscription.plan_code,
            amount_minor_units=subscription.amount_minor_units,
            currency=subscription.currency,
            features=build_plan_snapshot(db, tenant_id=parsed_tenant_id)["features"],
            cancel_at_period_end=subscription.cancel_at_period_end,
            current_period_end=_utc_iso(subscription.current_period_end),
            past_due_at=_utc_iso(subscription.past_due_at),
            grace_period_ends_at=_utc_iso(subscription.grace_period_ends_at),
            lifecycle_watermark_at=_utc_iso(subscription.stripe_lifecycle_watermark_at),
            lifecycle_event_type=subscription.stripe_lifecycle_event_type,
            lifecycle_event_id=redact_identifier(subscription.stripe_lifecycle_event_id),
            payment_watermark_at=_utc_iso(subscription.stripe_payment_watermark_at),
            payment_event_type=subscription.stripe_payment_event_type,
            payment_event_id=redact_identifier(subscription.stripe_payment_event_id),
            plan_effective_until=_utc_iso(subscription.plan_effective_until),
        )


def _audit_count(engine: Any, event_id: str) -> int:
    with Session(engine) as db:
        rows = db.scalars(select(AuditLog)).all()
        return sum(1 for row in rows if (row.changes or {}).get("stripe_event_id") == event_id)


def _webhook_attempts(engine: Any, event_id: str) -> int:
    with Session(engine) as db:
        event = db.scalar(select(WebhookEvent).where(WebhookEvent.stripe_event_id == event_id))
        return event.process_attempts if event else 0


def _deliver_event(
    config: DrillConfig,
    webhook_secret: str,
    event: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    payload = json.dumps(event, separators=(",", ":"), ensure_ascii=False).encode()
    timestamp = int(time.time())
    digest = hmac.new(
        webhook_secret.encode(), f"{timestamp}.".encode() + payload, hashlib.sha256
    ).hexdigest()
    request = Request(
        f"{config.app_base_url}/api/v1/billing/webhooks/stripe",
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Stripe-Signature": f"t={timestamp},v1={digest}",
        },
    )
    try:
        with urlopen(request, timeout=20) as response:
            result = json.loads(response.read())
    except HTTPError as exc:
        exc.read()
        raise DrillError(f"Kova webhook returned HTTP {exc.code}") from exc
    if not isinstance(result, dict):
        raise DrillError("Kova webhook returned an invalid response")
    return result, datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _record_event(
    records: list[dict[str, Any]],
    *,
    step: str,
    order: int,
    event: dict[str, Any],
    delivered_at: str,
    response: dict[str, Any],
    snapshot: SubscriptionSnapshot,
) -> None:
    records.append(
        {
            "step": step,
            "order": order,
            "event_type": event.get("type"),
            "provider_object_status": (event.get("data", {}).get("object") or {}).get("status"),
            "event_id": redact_identifier(str(event.get("id") or "")),
            "event_created_at": _epoch_iso(event.get("created")),
            "delivered_at": delivered_at,
            "delivery": "controlled_signed_replay_of_stripe_event",
            "response": response.get("status"),
            "subscription": asdict(snapshot),
        }
    )


def _deliver_and_record(
    config: DrillConfig,
    engine: Any,
    webhook_secret: str,
    records: list[dict[str, Any]],
    *,
    tenant_id: str,
    step: str,
    order: int,
    event: dict[str, Any],
) -> dict[str, Any]:
    response, delivered_at = _deliver_event(config, webhook_secret, event)
    snapshot = _snapshot(engine, tenant_id)
    expected_plan = PLANS[config.plan_code]
    if (snapshot.plan_code != expected_plan.code
            or snapshot.amount_minor_units != expected_plan.amount_minor_units
            or snapshot.currency != "MXN"
            or set(snapshot.features) != set(expected_plan.features)):
        raise DrillError("Local lifecycle snapshot no longer matches the selected commercial plan")
    _record_event(
        records,
        step=step,
        order=order,
        event=event,
        delivered_at=delivered_at,
        response=response,
        snapshot=snapshot,
    )
    return response


def _subscription_period_end(subscription: dict[str, Any]) -> int:
    value = subscription.get("current_period_end")
    if value is None:
        items = subscription.get("items", {}).get("data", [])
        value = items[0].get("current_period_end") if items else None
    if value is None:
        raise DrillError("Stripe subscription did not expose current_period_end")
    return int(value)


def _complete_hosted_checkout(config: DrillConfig, state_path: Path) -> None:
    child_env = os.environ.copy()
    child_env["KOV005_CHECKOUT_STATE_FILE"] = str(state_path)
    result = subprocess.run(
        ["node", str(config.checkout_helper)],
        cwd=REPOSITORY_ROOT,
        env=child_env,
        check=False,
        timeout=120,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        match = re.search(r"KOV005_CHECKOUT_FAILURE_STAGE=([a-z_]+)", result.stderr)
        stage = match.group(1) if match else "unknown"
        raise DrillError(f"Stripe hosted Checkout automation failed at {stage}")


def _wait_for_subscription_status(
    client: KovaClient, expected: set[str], timeout_seconds: int = 60
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        result = client.request("GET", "/api/v1/billing/subscription")
        subscription = result.get("subscription") or {}
        if subscription.get("status") in expected:
            return result
        time.sleep(1)
    raise DrillError(f"Kova did not converge to one of: {', '.join(sorted(expected))}")


def _assert_selected_plan(
    config: DrillConfig, result: dict[str, Any], *, expected_code: str | None = None,
    require_access: bool = True,
) -> None:
    plan = PLANS[expected_code or config.plan_code]
    subscription = result.get("subscription") or {}
    access = result.get("access") or {}
    if (subscription.get("plan_code") != plan.code
            or subscription.get("amount_minor_units") != plan.amount_minor_units
            or subscription.get("currency") != "MXN"
            or access.get("plan_code") != plan.code
            or set(access.get("features") or []) != set(plan.features)
            or (require_access and access.get("allowed") is not True)):
        raise DrillError("Kova did not grant the paid plan, amount and exact catalog features")


def _assert_status(engine: Any, tenant_id: str, expected: str) -> None:
    actual = _snapshot(engine, tenant_id).status
    if actual != expected:
        raise DrillError(f"Expected local subscription status {expected}, received {actual}")


def _assert_event_watermark(
    engine: Any,
    tenant_id: str,
    *,
    family: str,
    event: dict[str, Any],
) -> None:
    snapshot = _snapshot(engine, tenant_id)
    if family == "lifecycle":
        actual_id = snapshot.lifecycle_event_id
        actual_type = snapshot.lifecycle_event_type
        actual_at = snapshot.lifecycle_watermark_at
    else:
        actual_id = snapshot.payment_event_id
        actual_type = snapshot.payment_event_type
        actual_at = snapshot.payment_watermark_at
    if (
        actual_id != redact_identifier(str(event.get("id") or ""))
        or actual_type != event.get("type")
        or actual_at != _epoch_iso(event.get("created"))
    ):
        raise DrillError(f"{family} watermark did not match the delivered Stripe event")


def _create_cross_order_scenario(
    stripe: StripeTestClient,
    config: DrillConfig,
    engine: Any,
    webhook_secret: str,
    records: list[dict[str, Any]],
    cleanup_clocks: list[str],
    cleanup_customers: list[str],
    *,
    label: str,
    cancellation_first: bool,
) -> None:
    client = KovaClient(config.app_base_url, config.frontend_origin)
    tenant_id = client.create_verified_owner(label)
    clock, customer, _, subscription = _create_clock_subscription(
        stripe,
        config,
        cleanup_clocks,
        cleanup_customers,
        tenant_id=tenant_id,
        label=label,
        price_id=config.price_id,
    )
    subscription_id = subscription["id"]
    payment = _wait_for_event(
        stripe, subscription_id, {"invoice.paid", "invoice.payment_succeeded"}
    )
    _advance_clock(stripe, clock["id"], int(clock["frozen_time"]) + 60)
    stripe.delete(f"/v1/subscriptions/{subscription_id}")
    cancellation = _wait_for_event(
        stripe, subscription_id, {"customer.subscription.deleted"}
    )
    if int(cancellation["created"]) <= int(payment["created"]):
        raise DrillError("Cross-family fixture timestamps were not strictly ordered")
    _seed_subscription_mapping(
        engine,
        tenant_id=tenant_id,
        customer_id=customer["id"],
        subscription_id=subscription_id,
        price_id=config.price_id,
    )
    payloads = [cancellation, payment] if cancellation_first else [payment, cancellation]
    for order, event in enumerate(payloads, start=1):
        _deliver_and_record(
            config,
            engine,
            webhook_secret,
            records,
            tenant_id=tenant_id,
            step=label,
            order=order,
            event=event,
        )
    audit_before = _audit_count(engine, str(payment["id"]))
    attempts_before = _webhook_attempts(engine, str(payment["id"]))
    _deliver_and_record(
        config,
        engine,
        webhook_secret,
        records,
        tenant_id=tenant_id,
        step=f"{label}_duplicate",
        order=3,
        event=payment,
    )
    if _audit_count(engine, str(payment["id"])) != audit_before:
        raise DrillError("Duplicate payment produced a second audit side effect")
    if _webhook_attempts(engine, str(payment["id"])) != attempts_before:
        raise DrillError("Duplicate payment was processed a second time")
    _assert_status(engine, tenant_id, "canceled")
    _assert_event_watermark(
        engine, tenant_id, family="lifecycle", event=cancellation
    )
    _assert_event_watermark(engine, tenant_id, family="payment", event=payment)


def _run_lifecycle(
    stripe: StripeTestClient,
    config: DrillConfig,
    engine: Any,
    webhook_secret: str,
    records: list[dict[str, Any]],
    cleanup_clocks: list[str],
    cleanup_customers: list[str],
) -> None:
    client = KovaClient(config.app_base_url, config.frontend_origin)
    tenant_id = client.create_verified_owner("lifecycle")
    clock, customer, success_pm, subscription = _create_clock_subscription(
        stripe,
        config,
        cleanup_clocks,
        cleanup_customers,
        tenant_id=tenant_id,
        label="lifecycle",
        price_id=config.price_id,
    )
    subscription_id = subscription["id"]
    _seed_subscription_mapping(
        engine,
        tenant_id=tenant_id,
        customer_id=customer["id"],
        subscription_id=subscription_id,
        price_id=config.price_id,
    )
    created = _wait_for_event(stripe, subscription_id, {"customer.subscription.created"})
    initial_paid = _wait_for_event(
        stripe, subscription_id, {"invoice.paid", "invoice.payment_succeeded"}
    )
    for order, event in enumerate((created, initial_paid), start=1):
        _deliver_and_record(
            config,
            engine,
            webhook_secret,
            records,
            tenant_id=tenant_id,
            step="initial_active",
            order=order,
            event=event,
        )
    _assert_status(engine, tenant_id, "active")
    _assert_selected_plan(config, client.request("GET", "/api/v1/billing/subscription"))

    paid_event_types = {"invoice.paid", "invoice.payment_succeeded"}
    known_paid_ids = _matching_event_ids(stripe, subscription_id, paid_event_types)
    renewal_end = _subscription_period_end(subscription)
    _advance_clock(stripe, clock["id"], renewal_end + 3600)
    renewal_paid = _wait_for_event(
        stripe,
        subscription_id,
        paid_event_types,
        exclude_ids=known_paid_ids,
    )
    _deliver_and_record(
        config,
        engine,
        webhook_secret,
        records,
        tenant_id=tenant_id,
        step="renewal_paid",
        order=1,
        event=renewal_paid,
    )
    _assert_status(engine, tenant_id, "active")
    _assert_event_watermark(
        engine, tenant_id, family="payment", event=renewal_paid
    )

    failing_pm = _create_payment_method(stripe, "tok_chargeCustomerFail")
    stripe.post(
        f"/v1/payment_methods/{failing_pm['id']}/attach", {"customer": customer["id"]}
    )
    stripe.post(
        f"/v1/subscriptions/{subscription_id}", {"default_payment_method": failing_pm["id"]}
    )
    known_failed_ids = _matching_event_ids(
        stripe, subscription_id, {"invoice.payment_failed"}
    )
    subscription = stripe.get(f"/v1/subscriptions/{subscription_id}")
    failure_end = _subscription_period_end(subscription)
    _advance_clock(stripe, clock["id"], failure_end + 3600)
    failed = _wait_for_event(
        stripe,
        subscription_id,
        {"invoice.payment_failed"},
        exclude_ids=known_failed_ids,
    )
    _deliver_and_record(
        config,
        engine,
        webhook_secret,
        records,
        tenant_id=tenant_id,
        step="payment_failed",
        order=1,
        event=failed,
    )
    _assert_status(engine, tenant_id, "past_due")
    _assert_event_watermark(engine, tenant_id, family="payment", event=failed)
    past_due = client.request("GET", "/api/v1/billing/subscription")
    if (past_due.get("access") or {}).get("reason") != "past_due_grace":
        raise DrillError("past_due did not produce the configured grace access")

    stripe.post(
        f"/v1/subscriptions/{subscription_id}", {"default_payment_method": success_pm["id"]}
    )
    failed_invoice_id = str(failed.get("data", {}).get("object", {}).get("id") or "")
    if not failed_invoice_id.startswith("in_"):
        raise DrillError("Payment failure did not identify an invoice")
    known_paid_ids = _matching_event_ids(stripe, subscription_id, paid_event_types)
    stripe.post(f"/v1/invoices/{failed_invoice_id}/pay", {})
    recovered = _wait_for_event(
        stripe,
        subscription_id,
        paid_event_types,
        exclude_ids=known_paid_ids,
    )
    _deliver_and_record(
        config,
        engine,
        webhook_secret,
        records,
        tenant_id=tenant_id,
        step="payment_recovered",
        order=1,
        event=recovered,
    )
    _assert_status(engine, tenant_id, "active")
    _assert_event_watermark(engine, tenant_id, family="payment", event=recovered)

    canceled = client.request("POST", "/api/v1/billing/cancel")
    if not (canceled.get("subscription") or {}).get("cancel_at_period_end"):
        raise DrillError("Kova cancellation did not set cancel_at_period_end")
    subscription = stripe.get(f"/v1/subscriptions/{subscription_id}")
    if subscription.get("cancel_at_period_end") is not True:
        raise DrillError("Stripe did not persist cancel_at_period_end")
    cancel_end = _subscription_period_end(subscription)
    _advance_clock(stripe, clock["id"], cancel_end + 3600)
    deleted = _wait_for_event(stripe, subscription_id, {"customer.subscription.deleted"})
    _deliver_and_record(
        config,
        engine,
        webhook_secret,
        records,
        tenant_id=tenant_id,
        step="period_end_canceled",
        order=1,
        event=deleted,
    )
    _assert_status(engine, tenant_id, "canceled")
    _assert_event_watermark(engine, tenant_id, family="lifecycle", event=deleted)


def _register_checkout_customer(
    config: DrillConfig, stripe_session: dict[str, Any],
    cleanup_clocks: list[str], cleanup_customers: list[str],
) -> None:
    """Persist every recovered Checkout customer before accepting provider evidence."""
    _assert_test_object(stripe_session, object_name="Checkout Session")
    customer_id = stripe_session.get("customer")
    if not isinstance(customer_id, str) or re.fullmatch(r"cus_[A-Za-z0-9]+", customer_id) is None:
        raise DrillError("Checkout Session did not identify a valid customer for cleanup")
    if customer_id not in cleanup_customers:
        cleanup_customers.append(customer_id)
    _persist_cleanup(config, cleanup_clocks, cleanup_customers)


def _run_checkout(
    stripe: StripeTestClient,
    config: DrillConfig,
    engine: Any,
    cleanup_clocks: list[str],
    cleanup_customers: list[str],
    *, label: str = "checkout", context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    client = KovaClient(config.app_base_url, config.frontend_origin)
    tenant_id = client.create_verified_owner(label)
    checkout = client.request(
        "POST",
        "/api/v1/billing/checkout",
        {"plan_code": config.plan_code},
        headers={"Idempotency-Key": f"kov005-{secrets.token_hex(12)}"},
    )
    checkout_url = str(checkout.get("checkout_url") or "")
    checkout_id = str(checkout.get("checkout_session_id") or "")
    if not checkout_id.startswith("cs_test_") or not checkout_url.startswith(
        "https://checkout.stripe.com/"
    ):
        raise DrillError("Kova did not return a Stripe test-mode hosted Checkout Session")
    state_fd, state_name = tempfile.mkstemp(prefix="kov005-checkout-", suffix=".json")
    os.close(state_fd)
    state_path = Path(state_name)
    stripe_session: dict[str, Any] | None = None
    try:
        state_path.write_text(json.dumps({"checkout_url": checkout_url}), encoding="utf-8")
        _complete_hosted_checkout(config, state_path)
    finally:
        state_path.unlink(missing_ok=True)
        try:
            stripe_session = stripe.get(f"/v1/checkout/sessions/{checkout_id}")
            if stripe_session.get("customer") is not None:
                _register_checkout_customer(
                    config, stripe_session, cleanup_clocks, cleanup_customers,
                )
        except DrillError:
            pass
    status = _wait_for_subscription_status(client, {"active", "trialing"})
    stripe_session = stripe_session or stripe.get(f"/v1/checkout/sessions/{checkout_id}")
    _register_checkout_customer(config, stripe_session, cleanup_clocks, cleanup_customers)
    if (stripe_session.get("status") != "complete"
            or stripe_session.get("payment_status") != "paid"):
        raise DrillError("Stripe hosted Checkout did not complete with a paid result")
    _assert_selected_plan(config, status)
    subscription = status.get("subscription") or {}
    local = _snapshot(engine, tenant_id)
    if local.status not in {"active", "trialing"} or local.lifecycle_watermark_at is None:
        raise DrillError("Hosted Checkout did not establish a lifecycle watermark")
    if context is not None:
        context.update(client=client, tenant_id=tenant_id, stripe_session=stripe_session)
    return {
        "checkout_session_id": redact_identifier(checkout_id),
        "provider_status": stripe_session.get("status"),
        "provider_payment_status": stripe_session.get("payment_status"),
        "livemode": False,
        "local_subscription_status": subscription.get("status"),
        "kova_plan": {"plan_code": subscription.get("plan_code"),
                      "amount_minor_units": subscription.get("amount_minor_units"),
                      "features": status["access"]["features"]},
        "kova_access": {name: status["access"].get(name)
                        for name in ("allowed", "reason", "valid_until")},
        "local_snapshot": asdict(local),
        "delivery": "stripe_cli_forward",
    }


def render_evidence(
    *,
    config: DrillConfig,
    preflight: dict[str, Any],
    checkout: dict[str, Any],
    records: list[dict[str, Any]],
    cleanup: dict[str, Any],
    portal_records: list[dict[str, Any]] | None = None,
    risk_records: list[dict[str, Any]] | None = None,
) -> str:
    lines = [
        "# KOV-005 — Stripe test-mode temporal convergence drill",
        "",
        f"- Executed at: `{datetime.now(UTC).isoformat().replace('+00:00', 'Z')}`",
        f"- Commit: `{config.release_sha}`",
        f"- GitHub environment: `{EXPECTED_ENVIRONMENT}`",
        "- Stripe mode: `livemode=false`",
        f"- Stripe account: `{preflight['account_id']}`",
        f"- Plan under acceptance: `{config.plan_code}`",
        f"- Stripe price: `{preflight['price_id']}` "
        f"(`MXN {Decimal(PLANS[config.plan_code].amount_minor_units) / Decimal(100):.2f}`, "
        "monthly, count 1)",
        f"- Catalog tax inclusive: `{PLANS[config.plan_code].tax_inclusive}`",
        "- Application/database: isolated GitHub runner, loopback only",
        "",
        "## Hosted Checkout",
        "",
        f"- Session: `{checkout['checkout_session_id']}`",
        f"- Provider result: `{checkout['provider_status']}/{checkout['provider_payment_status']}`",
        f"- Local result: `{checkout['local_subscription_status']}`",
        f"- Kova paid plan: `{json.dumps(checkout['kova_plan'], sort_keys=True)}`",
        f"- Kova access at actual application time: "
        f"`{json.dumps(checkout['kova_access'], sort_keys=True)}`",
        f"- Delivery: `{checkout['delivery']}`",
        "",
        "## Lifecycle and ordering evidence",
        "",
        "| Step | # | Event | Stripe object status | Event ID | Provider created | "
        "Arrived | Result | "
        "Kova status / plan / amount / features | Lifecycle watermark | Payment watermark |",
        "|---|---:|---|---|---|---|---|---|---|---|---|",
    ]
    for item in records:
        snapshot = item["subscription"]
        lifecycle = (
            f"{snapshot['lifecycle_event_type']} @ {snapshot['lifecycle_watermark_at']} "
            f"({snapshot['lifecycle_event_id']})"
        )
        payment = (
            f"{snapshot['payment_event_type']} @ {snapshot['payment_watermark_at']} "
            f"({snapshot['payment_event_id']})"
        )
        lines.append(
            f"| {item['step']} | {item['order']} | `{item['event_type']}` | "
            f"`{item.get('provider_object_status', 'not recorded')}` | "
            f"`{item['event_id']}` | {item['event_created_at']} | {item['delivered_at']} | "
            f"`{item['response']}` | `{snapshot['status']} / {snapshot['plan_code']} / "
            f"{snapshot['currency']} {snapshot['amount_minor_units']} minor / "
            f"{','.join(snapshot['features'])}` | {lifecycle} | {payment} |"
        )
    lines.extend(
        [
            "",
            "## Acceptance and boundaries",
            "",
            "- Hosted Checkout completed using Stripe's test-mode page; Kova independently "
            "confirmed the selected paid plan, amount, exact features and commercial access.",
            "- Provider Test Clocks advance Stripe only. Kova uses its actual UTC clock; "
            "recorded event/period dates do not prove that application time elapsed.",
            ("- Portal mode " + config.portal_mode + " results are recorded below; "
             "upgrades/downgrades remain blocked in basic mode. Effective downgrade, "
             "Kova frontend return, fiscal and live acceptance remain open."
             if config.include_portal
             else "- Portal, upgrades and effective downgrades are NOT accepted by this drill."),
            "- A test-clock renewal remained active and advanced the payment watermark.",
            "- A failed renewal entered `past_due` with `past_due_grace`; payment "
            "recovery returned to `active`.",
            "- Kova set `cancel_at_period_end`; the period-end event converged to `canceled`.",
            "- Newer cancellation plus older payment converged to `canceled` in both "
            "arrival orders.",
            "- Replaying the same payment event did not add audit work or another "
            "processing attempt.",
            "",
            "## Cleanup",
            "",
            f"- Test clocks deleted: `{cleanup['clocks_deleted']}`",
            f"- Standalone QA customers deleted: `{cleanup['customers_deleted']}`",
            "- Local listener and backend stopped; the GitHub PostgreSQL service is ephemeral.",
            "",
            "All Stripe identifiers are redacted to prefix plus final six characters. "
            "The artifact contains no keys, webhook signing secrets, Checkout URLs, "
            "card data, cookies, email addresses, or database URLs.",
            "",
        ]
    )
    if config.include_portal:
        if not portal_records:
            raise DrillError("Portal opt-in did not produce acceptance records")
        lines.extend(["## Portal acceptance (sandbox only)", "",
                      "Emitted by Kova API for a verified owner; "
                      "hosted Stripe UI submitted changes.",
                      "No Kova frontend return or effective downgrade is claimed.", ""])
        for record in portal_records:
            lines.append("- `" + json.dumps(record, sort_keys=True) + "`")
        lines.append("")
    if config.include_risk:
        lines.extend(_render_risk_evidence(risk_records or []))
    output = "\n".join(lines)
    if SECRET_RE.search(output):
        raise DrillError("Evidence renderer detected a credential-shaped value")
    return output


def _persist_cleanup(
    config: DrillConfig, clocks: list[str], customers: list[str]
) -> None:
    config.cleanup_path.parent.mkdir(parents=True, exist_ok=True)
    config.cleanup_path.write_text(
        json.dumps({"clocks": clocks, "customers": customers}), encoding="utf-8"
    )
    try:
        config.cleanup_path.chmod(0o600)
    except OSError:
        pass


def cleanup_provider_objects(config: DrillConfig, stripe: StripeTestClient) -> dict[str, int]:
    if not config.cleanup_path.exists():
        return {"clocks_deleted": 0, "customers_deleted": 0}
    try:
        manifest = json.loads(config.cleanup_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DrillError("The provider cleanup manifest is unreadable") from exc
    clocks = [str(value) for value in manifest.get("clocks", [])]
    customers = [str(value) for value in manifest.get("customers", [])]
    result = {"clocks_deleted": 0, "customers_deleted": 0}
    remaining_clocks = list(clocks)
    remaining_customers = list(customers)
    for clock_id in reversed(clocks):
        try:
            stripe.delete(f"/v1/test_helpers/test_clocks/{clock_id}")
        except DrillError:
            continue
        remaining_clocks.remove(clock_id)
        result["clocks_deleted"] += 1
        _persist_cleanup(config, remaining_clocks, remaining_customers)
    for customer_id in reversed(customers):
        try:
            stripe.delete(f"/v1/customers/{customer_id}")
        except DrillError:
            continue
        remaining_customers.remove(customer_id)
        result["customers_deleted"] += 1
        _persist_cleanup(config, remaining_clocks, remaining_customers)
    if remaining_clocks or remaining_customers:
        raise DrillError("One or more Stripe sandbox objects could not be deleted")
    config.cleanup_path.unlink(missing_ok=True)
    return result


def _portal_preflight(stripe: StripeTestClient, config: DrillConfig) -> dict[str, Any]:
    configuration = stripe.get(
        f"/v1/billing_portal/configurations/{config.portal_configuration_id}",
        query=[("expand[]", "features.subscription_update.products")],
    )
    _assert_test_object(configuration, object_name="Portal configuration")
    if (configuration.get("id") != config.portal_configuration_id
            or configuration.get("active") is not True):
        raise DrillError("Sandbox Portal configuration is not active or does not match")
    update = (configuration.get("features") or {}).get("subscription_update") or {}
    if config.portal_mode == "basic":
        features = configuration.get("features") or {}
        cancel = features.get("subscription_cancel") or {}
        if (update.get("enabled") is not False
                or (features.get("payment_method_update") or {}).get("enabled") is not True
                or (features.get("invoice_history") or {}).get("enabled") is not True
                or cancel.get("enabled") is not True or cancel.get("mode") != "at_period_end"):
            raise DrillError("Basic Portal must allow payment/history/deferred cancellation only")
    elif config.plan_code == "standard":
        if update.get("enabled") is not False:
            raise DrillError("Standard Portal must disable subscription changes")
    else:
        products = update.get("products") or []
        prices = {p for product in products for p in product.get("prices") or []}
        if len(products) != 1 or not isinstance(products[0].get("product"), str):
            raise DrillError("Scheduled Portal downgrades require both Prices on the same Product")
        conditions = (update.get("schedule_at_period_end") or {}).get("conditions") or []
        if (update.get("enabled") is not True
                or prices != {config.price_ids["esencial"], config.price_ids["gestion"]}
                or set(update.get("default_allowed_updates") or []) != {"price"}
                or update.get("proration_behavior") != "always_invoice"
                or any((p.get("adjustable_quantity") or {}).get("enabled") is True
                       for p in products)
                or not any(c.get("type") == "decreasing_item_amount" for c in conditions)):
            raise DrillError("Tiered Portal must restrict prices, quantities and downgrades")
    return {"configuration_id": redact_identifier(config.portal_configuration_id),
            "livemode": False, "subscription_update_enabled": update.get("enabled"),
            "proration_behavior": update.get("proration_behavior")}


def _portal_subscription(
    stripe: StripeTestClient, context: dict[str, Any],
) -> dict[str, Any]:
    session = context["stripe_session"]
    subscription_id = session.get("subscription")
    if (not isinstance(subscription_id, str)
            or not re.fullmatch(r"sub_[A-Za-z0-9]+", subscription_id)):
        raise DrillError("Checkout did not identify a subscription for Portal acceptance")
    subscription = stripe.get(
        f"/v1/subscriptions/{subscription_id}", query=[("expand[]", "latest_invoice")],
    )
    _assert_test_object(subscription, object_name="Portal subscription")
    if (subscription.get("id") != subscription_id
            or subscription.get("customer") != session["customer"]):
        raise DrillError("Portal subscription does not match the owned Checkout customer")
    return subscription


def _portal_price_id(subscription: dict[str, Any]) -> str | None:
    items = (subscription.get("items") or {}).get("data") or []
    if (len(items) != 1 or (subscription.get("items") or {}).get("has_more")
            or items[0].get("quantity") != 1):
        raise DrillError("Portal subscription must contain exactly one fixed-quantity item")
    price = items[0].get("price") or {}
    return price.get("id") if isinstance(price, dict) else price


def _portal_paid_invoice(
    subscription: dict[str, Any], price_id: str,
) -> dict[str, Any]:
    invoice = subscription.get("latest_invoice")
    if (not isinstance(invoice, dict) or invoice.get("status") != "paid"
            or invoice.get("amount_remaining") != 0 or subscription.get("pending_update")):
        raise DrillError("Portal plan is not backed by a settled current invoice")
    _assert_test_object(invoice, object_name="Portal paid invoice")
    if (not isinstance(invoice.get("id"), str)
            or not re.fullmatch(r"in_[A-Za-z0-9]+", invoice["id"])):
        raise DrillError("Portal paid invoice has no valid identity")
    related = invoice.get("subscription") or (
        (invoice.get("parent") or {}).get("subscription_details") or {}
    ).get("subscription")
    if related != subscription.get("id") or invoice.get("customer") != subscription.get("customer"):
        raise DrillError("Portal invoice does not belong to the subscription and customer")
    end = _subscription_period_end(subscription)
    for line in (invoice.get("lines") or {}).get("data") or []:
        price = line.get("price") or {}
        actual = price.get("id") if isinstance(price, dict) else price
        actual = actual or ((line.get("pricing") or {}).get("price_details") or {}).get("price")
        period = line.get("period") or {}
        if (actual == price_id and type(line.get("amount")) is int and line["amount"] > 0
                and type(period.get("end")) is int and period["end"] >= end
                and type(period.get("start")) is int and period["start"] <= int(time.time())):
            return invoice
    raise DrillError("Portal paid invoice lacks a positive current-price line covering the period")


def _submit_portal_action(
    config: DrillConfig, context: dict[str, Any], action: str,
) -> None:
    portal = context["client"].request("POST", "/api/v1/billing/portal")
    url = portal.get("portal_url")
    parsed = urlparse(url) if isinstance(url, str) else None
    # Portal session URLs are opaque; Kova already verifies the provider customer/configuration.
    if (parsed is None or parsed.scheme != "https" or parsed.netloc != "billing.stripe.com"
            or parsed.username or parsed.password):
        raise DrillError("Kova did not emit an accepted hosted Portal URL")
    fd, name = tempfile.mkstemp(prefix="kov005-portal-", suffix=".json")
    os.close(fd)
    path = Path(name)
    try:
        basic = action in {"inspect", "payment_update", "cancel"}
        current_code = config.plan_code if basic else (
            "standard" if action == "standard"
            else ("gestion" if action == "downgrade" else "esencial")
        )
        path.write_text(json.dumps({
            "portal_url": url, "plan_code": current_code,
            "provider_livemode": False, "action": action,
            "current_plan": "Standard" if current_code == "standard" else PLANS[current_code].name,
            "target_plan": "Esencial" if action == "downgrade" else "Gestión",
            "target_amount": 399 if action == "downgrade" else 699,
            "current_amount": PLANS[current_code].amount_minor_units // 100,
        }), encoding="utf-8")
        safe_names = {"PATH", "HOME", "TMPDIR", "TMP", "TEMP", "PLAYWRIGHT_BROWSERS_PATH"}
        child_env = {key: value for key, value in os.environ.items() if key in safe_names}
        child_env["KOV005_PORTAL_STATE_FILE"] = str(path)
        result = subprocess.run(
            ["node", str(config.portal_helper)], cwd=REPOSITORY_ROOT, env=child_env,
            capture_output=True, text=True, timeout=120, check=False,
        )
        if result.returncode != 0:
            match = re.search(r"KOV005_PORTAL_FAILURE_STAGE=([a-z_]+)", result.stderr)
            stage = match.group(1) if match else "unknown"
            reasons = ("control_not_found|control_not_visible|control_disabled|click_timeout|"
                       "click_failed|outside_provider|stage_timeout|unknown|field_missing|"
                       "billing_country_missing|billing_postal_missing")
            reason_match = re.search(r"^KOV005_PORTAL_FAILURE_REASON=(" + reasons + r")$",
                                     result.stderr, re.MULTILINE)
            reason = reason_match.group(1) if reason_match else "unknown"
            labels = {"save", "save_changes", "save_card", "save_payment_method", "add", "add_card",
                      "add_payment_method", "update", "update_card", "update_payment_method",
                      "continue", "confirm", "back",
                      "cancel", "cancel_subscription", "other"}
            controls_match = re.search(r"^KOV005_PORTAL_PUBLIC_CONTROLS=([^\r\n]*)$",
                                       result.stderr, re.MULTILINE)
            controls = []
            for token in (controls_match.group(1).split(",")[:32] if controls_match else []):
                label, _, enabled = token.partition(":")
                if label in labels and enabled in {"enabled", "disabled"}:
                    controls.append(label + ":" + enabled)
            summary = ",".join(controls) or "none"
            raise DrillError(f"Stripe Portal UI failed at {stage} "
                             f"(reason={reason}; controls={summary})")
        try:
            outcome = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise DrillError("Portal helper did not produce a structured outcome") from exc
        if outcome != {"action": action, "submitted": action not in {"standard", "inspect"},
                       "inspected": True}:
            raise DrillError("Portal helper did not complete the requested action")
    except subprocess.TimeoutExpired as exc:
        raise DrillError("Stripe Portal UI exceeded its bounded execution time") from exc
    finally:
        path.unlink(missing_ok=True)


def _portal_record(
    engine: Any, context: dict[str, Any], subscription: dict[str, Any],
    *, step: str, invoice: dict[str, Any] | None = None,
) -> dict[str, Any]:
    kova = context["client"].request("GET", "/api/v1/billing/subscription")
    snapshot = _snapshot(engine, context["tenant_id"])
    return {
        "step": step, "observed_at": datetime.now(UTC).isoformat(),
        "provider_subscription": {"id": redact_identifier(subscription["id"]),
                                  "status": subscription.get("status"),
                                  "price_id": redact_identifier(_portal_price_id(subscription)),
                                  "pending_update": bool(subscription.get("pending_update")),
                                  "cancel_at_period_end": bool(
                                      subscription.get("cancel_at_period_end")),
                                  "period_end": _epoch_iso(_subscription_period_end(subscription))},
        "provider_invoice": ({"id": redact_identifier(invoice.get("id")),
                              "status": invoice.get("status"),
                              "amount_remaining": invoice.get("amount_remaining")}
                             if invoice is not None else None),
        "kova": asdict(snapshot),
        "kova_access": {key: (kova.get("access") or {}).get(key)
                        for key in ("allowed", "reason", "valid_until", "plan_code", "features")},
    }


def _wait_for_portal_paid_plan(
    stripe: StripeTestClient, config: DrillConfig, context: dict[str, Any], code: str,
    *, previous_invoice_id: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        subscription = _portal_subscription(stripe, context)
        try:
            if _portal_price_id(subscription) != config.price_ids[code]:
                raise DrillError("Provider price has not converged")
            invoice = _portal_paid_invoice(subscription, config.price_ids[code])
            if invoice.get("id") == previous_invoice_id:
                raise DrillError("Provider has not issued a new plan-change invoice")
            _assert_selected_plan(config, context["client"].request(
                "GET", "/api/v1/billing/subscription",
            ), expected_code=code)
            return subscription, invoice
        except DrillError:
            time.sleep(1)
    raise DrillError("Paid Portal change did not converge to the exact plan in Stripe and Kova")


def _assert_portal_schedule(
    schedule: dict[str, Any], subscription: dict[str, Any], config: DrillConfig,
) -> int:
    _assert_test_object(schedule, object_name="Portal subscription schedule")
    if (schedule.get("subscription") != subscription["id"]
            or schedule.get("status") != "active"):
        raise DrillError("Portal schedule does not belong to the subscription")
    end = _subscription_period_end(subscription)
    if end <= int(time.time()) or _portal_price_id(subscription) != config.price_ids["gestion"]:
        raise DrillError("Scheduled downgrade changed the current paid Gestion plan")
    for phase in schedule.get("phases") or []:
        items = phase.get("items") or []
        price = (items[0].get("price") or {}) if len(items) == 1 else {}
        price_id = price.get("id") if isinstance(price, dict) else price
        if (phase.get("start_date") == end and price_id == config.price_ids["esencial"]
                and items[0].get("quantity") == 1):
            return end
    raise DrillError("Portal did not schedule Esencial at the current paid period end")


def _portal_customer(stripe: StripeTestClient, context: dict[str, Any]) -> dict[str, Any]:
    customer_id = context["stripe_session"]["customer"]
    customer = stripe.get(f"/v1/customers/{customer_id}")
    _assert_test_object(customer, object_name="Portal customer")
    if customer.get("id") != customer_id or customer.get("deleted"):
        raise DrillError("Portal customer mapping was not preserved")
    return customer


def _effective_portal_method(subscription: dict[str, Any], customer: dict[str, Any]) -> str | None:
    method = subscription.get("default_payment_method") or (
        customer.get("invoice_settings") or {}
    ).get("default_payment_method")
    return method.get("id") if isinstance(method, dict) else method


def _assert_basic_portal_plan(
    config: DrillConfig, context: dict[str, Any], subscription: dict[str, Any], period_end: int,
) -> dict[str, Any]:
    if (_portal_price_id(subscription) != config.price_id
            or _subscription_period_end(subscription) != period_end):
        raise DrillError("Basic Portal changed the preserved Price, quantity or paid period")
    kova = context["client"].request("GET", "/api/v1/billing/subscription")
    _assert_selected_plan(config, kova)
    return kova


def _run_basic_portal(
    stripe: StripeTestClient, config: DrillConfig, engine: Any, context: dict[str, Any],
) -> list[dict[str, Any]]:
    original = _portal_subscription(stripe, context)
    period_end = _subscription_period_end(original)
    if period_end <= int(time.time()):
        raise DrillError("Basic Portal requires a current paid period, not simulated elapsed time")
    entitlement_end = _snapshot(engine, context["tenant_id"]).plan_effective_until
    customer = _portal_customer(stripe, context)
    previous_method = _effective_portal_method(original, customer)
    _assert_basic_portal_plan(config, context, original, period_end)
    _submit_portal_action(config, context, "inspect")
    inspected = _portal_subscription(stripe, context)
    _assert_basic_portal_plan(config, context, inspected, period_end)
    records = [_portal_record(engine, context, inspected, step="basic_overview_no_tier_changes")]

    _submit_portal_action(config, context, "payment_update")
    deadline = time.monotonic() + 60
    method_id = None
    while time.monotonic() < deadline:
        current = _portal_subscription(stripe, context)
        customer = _portal_customer(stripe, context)
        method_id = _effective_portal_method(current, customer)
        if (isinstance(method_id, str) and re.fullmatch(r"pm_[A-Za-z0-9]+", method_id)
                and method_id != previous_method):
            method = stripe.get(f"/v1/payment_methods/{method_id}")
            _assert_test_object(method, object_name="Portal payment method")
            if (method.get("id") != method_id or method.get("customer") != original["customer"]
                    or method.get("type") != "card"):
                raise DrillError("Updated Portal payment method does not belong to the customer")
            _assert_basic_portal_plan(config, context, current, period_end)
            record = _portal_record(engine, context, current, step="basic_payment_method_updated")
            record["provider_payment_method"] = {"before": redact_identifier(previous_method),
                                                  "after": redact_identifier(method_id),
                                                  "changed": True, "livemode": False}
            if record["kova"]["plan_effective_until"] != entitlement_end:
                raise DrillError("Payment update changed the preserved paid entitlement boundary")
            records.append(record)
            break
        time.sleep(1)
    else:
        raise DrillError("Portal did not change the effective default payment method")

    _submit_portal_action(config, context, "cancel")
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        current = _portal_subscription(stripe, context)
        kova = _assert_basic_portal_plan(config, context, current, period_end)
        if (current.get("cancel_at_period_end") is True
                and (kova.get("subscription") or {}).get("cancel_at_period_end") is True):
            record = _portal_record(engine, context, current, step="basic_cancellation_scheduled")
            if record["kova"]["plan_effective_until"] != entitlement_end:
                raise DrillError("Scheduled cancellation changed the paid entitlement boundary")
            record["limits"] = {"effective_cancellation": False, "tier_changes": "blocked"}
            records.append(record)
            return records
        time.sleep(1)
    raise DrillError("Portal cancellation did not converge to period-end cancellation in Kova")


def _run_portal_acceptance(
    stripe: StripeTestClient, config: DrillConfig, engine: Any, initial: dict[str, Any],
    clocks: list[str], customers: list[str],
) -> list[dict[str, Any]]:
    if not config.include_portal:
        raise DrillError("Portal acceptance requires explicit isolated opt-in")
    if config.portal_mode == "basic":
        return _run_basic_portal(stripe, config, engine, initial)
    original = _portal_subscription(stripe, initial)
    if _portal_price_id(original) != config.price_id:
        raise DrillError("Initial owned subscription did not match the paid catalog price")
    if config.plan_code == "standard":
        _submit_portal_action(config, initial, "standard")
        after = _portal_subscription(stripe, initial)
        if (_portal_price_id(after) != config.price_id
                or after.get("cancel_at_period_end") != original.get("cancel_at_period_end")
                or _subscription_period_end(after) != _subscription_period_end(original)):
            raise DrillError("Standard Portal changed the preserved plan")
        _assert_selected_plan(config, initial["client"].request(
            "GET", "/api/v1/billing/subscription",
        ))
        return [_portal_record(engine, initial, after, step="standard_plan_change_disabled")]

    # A separate customer owns the rejected attempt: no API repair is presented as Portal recovery.
    failing = _create_payment_method(stripe, "tok_chargeCustomerFail")
    stripe.post(f"/v1/payment_methods/{failing['id']}/attach", {"customer": original["customer"]})
    stripe.post(f"/v1/subscriptions/{original['id']}", {"default_payment_method": failing["id"]})
    known = _matching_event_ids(stripe, original["id"], {"invoice.payment_failed"})
    _submit_portal_action(config, initial, "upgrade_decline")
    failed = _wait_for_event(stripe, original["id"], {"invoice.payment_failed"}, exclude_ids=known)
    failed_id = str((failed.get("data", {}).get("object") or {}).get("id") or "")
    if not re.fullmatch(r"in_[A-Za-z0-9]+", failed_id):
        raise DrillError("Portal rejection did not identify an invoice")
    invoice = stripe.get(f"/v1/invoices/{failed_id}")
    _assert_test_object(invoice, object_name="Portal rejected invoice")
    related = _related_subscription({"type": "invoice.payment_failed", "data": {"object": invoice}})
    if (invoice.get("id") != failed_id or related != original["id"]
            or invoice.get("customer") != original["customer"]
            or invoice.get("status") not in {"open", "void", "uncollectible"}
            or (invoice.get("status") == "open" and (invoice.get("amount_remaining") or 0) <= 0)):
        raise DrillError("Portal rejection did not leave a failed, unpaid or void invoice")
    _assert_selected_plan(config, initial["client"].request(
        "GET", "/api/v1/billing/subscription",
    ), expected_code="esencial", require_access=False)
    records = [_portal_record(engine, initial, _portal_subscription(stripe, initial),
                              step="upgrade_rejected_keeps_esencial", invoice=invoice)]
    success: dict[str, Any] = {}
    _run_checkout(
        stripe, config, engine, clocks, customers, label="portal-success", context=success,
    )
    before = _portal_subscription(stripe, success)
    previous_invoice_id = _portal_paid_invoice(before, config.price_ids["esencial"])["id"]
    _submit_portal_action(config, success, "upgrade_success")
    upgraded, paid = _wait_for_portal_paid_plan(
        stripe, config, success, "gestion", previous_invoice_id=previous_invoice_id,
    )
    records.append(_portal_record(
        engine, success, upgraded, step="upgrade_paid_grants_gestion", invoice=paid,
    ))
    _submit_portal_action(config, success, "downgrade")
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        current = _portal_subscription(stripe, success)
        schedule_id = current.get("schedule")
        if isinstance(schedule_id, str) and re.fullmatch(r"sub_sched_[A-Za-z0-9]+", schedule_id):
            schedule = stripe.get(f"/v1/subscription_schedules/{schedule_id}")
            end = _assert_portal_schedule(schedule, current, config)
            _assert_selected_plan(config, success["client"].request(
                "GET", "/api/v1/billing/subscription",
            ), expected_code="gestion")
            record = _portal_record(engine, success, current,
                                    step="downgrade_scheduled_keeps_gestion", invoice=paid)
            if record["kova"]["plan_effective_until"] != _epoch_iso(end):
                raise DrillError("Scheduled downgrade changed Kova paid entitlement period")
            record["provider_schedule"] = {"id": redact_identifier(schedule_id),
                                            "target_plan": "esencial", "starts_at": _epoch_iso(end)}
            records.append(record)
            return records
        time.sleep(1)
    raise DrillError("Portal downgrade did not produce a verified future schedule")


def _risk_id(value: Any, prefix: str) -> str:
    if isinstance(value, dict):
        value = value.get("id")
    if not isinstance(value, str) or re.fullmatch(prefix + r"_[A-Za-z0-9_]+", value) is None:
        raise DrillError("Risk fixture returned an invalid provider relationship")
    return value


def _risk_pages(stripe: StripeTestClient, path: str, query: list[tuple[str, str]]) -> list[dict]:
    rows: list[dict] = []
    cursor = None
    for _ in range(5):
        page = stripe.get(path, query=query + ([("starting_after", cursor)] if cursor else []))
        data = page.get("data")
        if not isinstance(data, list) or type(page.get("has_more")) is not bool:
            raise DrillError("Risk preflight received an invalid paginated list")
        if any(not isinstance(row, dict) for row in data):
            raise DrillError("Risk preflight received an invalid list item")
        rows.extend(data)
        if not page["has_more"]:
            return rows
        next_cursor = data[-1].get("id") if data else None
        if not isinstance(next_cursor, str) or next_cursor == cursor:
            raise DrillError("Risk preflight could not safely paginate")
        cursor = next_cursor
    raise DrillError("Risk preflight exceeded its pagination limit")


def _owned_risk_charge(stripe: StripeTestClient, context: dict, expected: dict) -> dict:
    """Prove Checkout/Customer/PI/Invoice/Subscription ownership before a refund."""
    checkout = context["stripe_session"]
    _assert_test_object(checkout, object_name="risk Checkout")
    customer = _risk_id(checkout.get("customer"), "cus")
    sub_id = _risk_id(checkout.get("subscription"), "sub")
    if (checkout.get("status") != "complete" or checkout.get("payment_status") != "paid"
            or expected["stripe_customer_id"] != customer
            or expected["stripe_subscription_id"] != sub_id):
        raise DrillError("Risk refund requires the owned paid Checkout subscription")
    subscription = stripe.get(f"/v1/subscriptions/{sub_id}")
    _assert_test_object(subscription, object_name="risk subscription")
    if subscription.get("id") != sub_id or subscription.get("customer") != customer:
        raise DrillError("Risk subscription ownership mismatch")
    invoice_id = _risk_id(checkout.get("invoice"), "in")
    invoice = stripe.get(f"/v1/invoices/{invoice_id}")
    _assert_test_object(invoice, object_name="risk invoice")
    parent = invoice.get("parent") or {}
    if (invoice.get("id") != invoice_id or invoice.get("customer") != customer
            or invoice.get("status") != "paid" or parent.get("type") != "subscription_details"
            or (parent.get("subscription_details") or {}).get("subscription") != sub_id):
        raise DrillError("Risk invoice does not prove Checkout subscription ownership")
    payments = _risk_pages(stripe, "/v1/invoice_payments", [
        ("invoice", invoice_id), ("status", "paid"), ("limit", "100"),
    ])
    intents = set()
    for payment in payments:
        _assert_test_object(payment, object_name="risk invoice payment")
        details = payment.get("payment") or {}
        if (payment.get("invoice") != invoice_id or payment.get("status") != "paid"
                or details.get("type") != "payment_intent"):
            raise DrillError("Risk invoice has an unsupported payment relationship")
        intents.add(_risk_id(details.get("payment_intent"), "pi"))
    if len(intents) != 1:
        raise DrillError("Risk refund requires one proven Checkout PaymentIntent")
    intent_id = intents.pop()
    intent = stripe.get(f"/v1/payment_intents/{intent_id}")
    _assert_test_object(intent, object_name="risk PaymentIntent")
    if (intent.get("id") != intent_id or intent.get("customer") != customer
            or intent.get("status") != "succeeded"):
        raise DrillError("Risk PaymentIntent ownership mismatch")
    charge_id = _risk_id(intent.get("latest_charge"), "ch")
    charge = stripe.get(f"/v1/charges/{charge_id}")
    _assert_test_object(charge, object_name="risk Charge")
    if (charge.get("id") != charge_id or charge.get("customer") != customer
            or charge.get("payment_intent") != intent_id or charge.get("paid") is not True
            or charge.get("currency") != "mxn" or type(charge.get("amount")) is not int
            or charge["amount"] <= 1 or charge.get("amount_refunded") != 0):
        raise DrillError("Risk Charge is not an owned unrefunded sandbox payment")
    related = _risk_pages(stripe, "/v1/invoice_payments", [
        ("payment[type]", "payment_intent"), ("payment[payment_intent]", intent_id),
        ("status", "paid"), ("limit", "100"),
    ])
    if not related or any(
        item.get("livemode") is not False or item.get("invoice") != invoice_id
        or item.get("status") != "paid"
        or (item.get("payment") or {}).get("type") != "payment_intent"
        or (item.get("payment") or {}).get("payment_intent") != intent_id for item in related
    ):
        raise DrillError("Risk Charge is not exclusively linked to the owned Checkout invoice")
    return charge


def _risk_local_state(engine: Any, context: dict) -> dict:
    with Session(engine) as db:
        subscription = db.scalar(select(Subscription).where(
            Subscription.tenant_id == UUID(context["tenant_id"]),
        ))
        if subscription is None:
            raise DrillError("Risk acceptance requires a local paid subscription")
        values = {column.key: getattr(subscription, column.key)
                  for column in Subscription.__table__.columns}
        payments = tuple(tuple(getattr(row, column.key) for column in Payment.__table__.columns)
                         for row in db.scalars(select(Payment).where(
                             Payment.tenant_id == subscription.tenant_id,
                         ).order_by(Payment.id)))
        refunds = tuple(tuple(getattr(row, column.key) for column in Refund.__table__.columns)
                        for row in db.scalars(select(Refund).where(
                            Refund.tenant_id == subscription.tenant_id,
                        ).order_by(Refund.id)))
    access = context["client"].request("GET", "/api/v1/billing/subscription")["access"]
    if values["status"] != "active" or not access.get("allowed"):
        raise DrillError("Risk acceptance requires current commercial access")
    return {"subscription": values, "payments": payments, "refunds": refunds, "access": access}


def _wait_risk_event(stripe: StripeTestClient, event_type: str, charge_id: str, since: int) -> dict:
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        events = _risk_pages(stripe, "/v1/events", [
            ("type", event_type), ("created[gte]", str(since)), ("limit", "100"),
        ])
        for event in events:
            obj = event.get("data", {}).get("object", {})
            related = obj.get("id") if event_type == "charge.refunded" else obj.get("charge")
            if event.get("type") == event_type and related == charge_id:
                _assert_test_object(event, object_name="risk event")
                return event
        time.sleep(1)
    raise DrillError(f"Stripe did not emit the expected sandbox risk event: {event_type}")


def _risk_delivery_state(engine: Any, event: dict, tenant_id: str | None, mapping: str) -> dict:
    with Session(engine) as db:
        row = db.scalar(select(WebhookEvent).where(WebhookEvent.stripe_event_id == event["id"]))
        if row is None or row.processing_status == "received":
            return {}
        review = (row.payload or {}).get("risk_review") or {}
        audit = db.scalars(select(AuditLog).where(
            AuditLog.resource_id == row.id, AuditLog.action == "billing.risk_review_required",
        )).all()
        projected_id = (row.payload or {}).get("data", {}).get("object", {}).get("id")
        provider_id = event.get("data", {}).get("object", {}).get("id")
        if (row.processing_status != "processed" or row.process_attempts != 1 or len(audit) != 1
                or row.event_type != event["type"] or not provider_id or projected_id != provider_id
                or row.tenant_id != (UUID(tenant_id) if tenant_id else None)
                or review.get("mapping") != mapping):
            raise DrillError("Risk webhook did not prove processing, ownership and one audit")
        return {"process_attempts": row.process_attempts, "audit_entries": len(audit)}


def _risk_ops_triage(engine: Any, event_id: str, actor_id: UUID) -> None:
    # Deliberately repository/service evidence in isolated QA, not an Ops MFA UI bypass.
    with Session(engine) as db:
        row = ops_repository.get_webhook_by_event_id(db, event_id)
        if row is None or row not in ops_repository.risk_webhooks(db):
            raise DrillError("Processed risk was not visible to Ops queries")
        incident = ops_incidents._webhook_incident(row, now=datetime.now(UTC))
        if incident.severity != "critical":
            raise DrillError("Ops did not classify the risk as critical")
        pending = ops_repository.unresolved_risk_count(db)
        ops_repository.upsert_incident_state(db, source="stripe_webhook", external_id=event_id,
                                             triage_status="acknowledged", snoozed_until=None,
                                             updated_by_user_id=actor_id)
        db.commit()
    with Session(engine) as db:
        state = ops_repository.get_incident_state(db, source="stripe_webhook", external_id=event_id)
        if state is None or state.triage_status != "acknowledged" or (
            ops_repository.unresolved_risk_count(db) != pending
        ):
            raise DrillError("Risk acknowledgement did not persist without resolving health")
        ops_repository.upsert_incident_state(db, source="stripe_webhook", external_id=event_id,
                                             triage_status="resolved", snoozed_until=None,
                                             updated_by_user_id=actor_id)
        db.commit()
    with Session(engine) as db:
        state = ops_repository.get_incident_state(db, source="stripe_webhook", external_id=event_id)
        if state is None or state.triage_status != "resolved" or (
            ops_repository.unresolved_risk_count(db) != pending - 1
        ):
            raise DrillError("Risk resolution did not persist or clear its pending health")


def _accept_risk_event(
    stripe: StripeTestClient, config: DrillConfig, engine: Any, context: dict,
    webhook_secret: str, event_type: str, charge_id: str, since: int,
    baseline: dict, *, mapping: str,
) -> dict:
    event = _wait_risk_event(stripe, event_type, charge_id, since)
    tenant_id = context["tenant_id"] if mapping == "matched" else None
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        delivery = _risk_delivery_state(engine, event, tenant_id, mapping)
        if delivery:
            break
        time.sleep(1)
    else:
        raise DrillError("Signed Stripe listener did not process the expected risk event")
    if _risk_local_state(engine, context) != baseline:
        raise DrillError("Risk event changed Kova subscription, payments, access or watermarks")
    result, _ = _deliver_event(config, webhook_secret, event)
    if result.get("status") != "processed" or (
        _risk_delivery_state(engine, event, tenant_id, mapping) != delivery
    ):
        raise DrillError("Risk duplicate was not idempotent")
    session = context["client"].request("GET", "/api/v1/auth/session")
    _risk_ops_triage(engine, event["id"], UUID(session["user"]["id"]))
    if _risk_local_state(engine, context) != baseline:
        raise DrillError("Risk duplicate or Ops triage changed Kova commercial state")
    return {"event_type": event_type, "mapping": mapping, "livemode": False,
            **delivery, "duplicate_idempotent": True, "commercial_state_unchanged": True,
            "ops_visible": True, "triage_persisted": True, "listener_received": True}


def _run_risk_acceptance(
    stripe: StripeTestClient, config: DrillConfig, engine: Any, context: dict,
    webhook_secret: str, clocks: list[str], customers: list[str],
) -> list[dict]:
    if not config.include_risk:
        return []
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        ready = _snapshot(engine, context["tenant_id"])
        if ready.status == "active" and ready.payment_watermark_at and ready.lifecycle_watermark_at:
            break
        time.sleep(1)
    else:
        raise DrillError("Risk fixture requires settled Checkout lifecycle and payment watermarks")
    baseline = _risk_local_state(engine, context)
    tag = "risk-" + config.release_sha[:12] + "-" + secrets.token_hex(8)
    charge = _owned_risk_charge(stripe, context, baseline["subscription"])
    since = int(time.time()) - 2
    refund = stripe.post("/v1/refunds", {"charge": charge["id"], "amount": 1,
                                          "metadata[kov005_risk]": tag})
    if (refund.get("charge") != charge["id"] or refund.get("amount") != 1
            or refund.get("status") != "succeeded"):
        raise DrillError("Sandbox partial refund did not succeed for exactly one minor unit")
    records = [_accept_risk_event(
        stripe, config, engine, context, webhook_secret, "charge.refunded", charge["id"], since,
        baseline, mapping="matched",
    )]
    # Official reusable test PaymentMethods; no PAN, Radar changes or subscription default mutation.
    for event_type, method in (
        ("charge.dispute.created", "pm_card_createDispute"),
        ("radar.early_fraud_warning.created", "pm_card_createIssuerFraudRecord"),
    ):
        customer = stripe.post("/v1/customers", {
            "metadata[kov005_risk]": tag, "metadata[kov005_case]": event_type,
        })
        _assert_test_object(customer, object_name="risk fixture customer")
        customer_id = _risk_id(customer.get("id"), "cus")
        customers.append(customer_id)
        _persist_cleanup(config, clocks, customers)  # Before charging; outer finally owns cleanup.
        since = int(time.time()) - 2
        intent = stripe.post("/v1/payment_intents", {
            "amount": 100, "currency": "usd", "customer": customer_id,
            "payment_method": method, "confirm": "true",
            "automatic_payment_methods[enabled]": "true",
            "automatic_payment_methods[allow_redirects]": "never",
            "metadata[kov005_risk]": tag, "metadata[kov005_case]": event_type,
        })
        _assert_test_object(intent, object_name="risk fixture PaymentIntent")
        if intent.get("customer") != customer_id or intent.get("status") != "succeeded":
            raise DrillError("Official sandbox risk PaymentMethod did not produce a paid fixture")
        charge_id = _risk_id(intent.get("latest_charge"), "ch")
        records.append(_accept_risk_event(
            stripe, config, engine, context, webhook_secret, event_type, charge_id, since,
            baseline, mapping="no_subscription",
        ))
    return records


def _render_risk_evidence(records: list[dict]) -> list[str]:
    if len(records) != 3 or {item.get("event_type") for item in records} != RISK_EVENTS:
        raise DrillError("Risk opt-in requires all three provider risk acceptance records")
    keys = ("event_type", "mapping", "livemode", "process_attempts", "audit_entries",
            "duplicate_idempotent", "commercial_state_unchanged", "ops_visible", "triage_persisted",
            "listener_received")
    lines = ["## Risk acceptance (sandbox only)", "",
             "Partial Checkout refund: 1 MXN minor unit, matched to its subscription. "
             "Dispute and early-warning fixtures: separate QA customers without invoices; "
             "global no_subscription review, never an invented tenant.",
             "Ops evidence uses isolated service/repository queries and persisted acknowledgement/"
             "resolution, not the authenticated founder MFA UI. "
             "No production risk decision is made.",
             "Signed listener received every first delivery; a signed duplicate kept one audit and "
             "one processing attempt. Full local Subscription/payment/access snapshots "
             "were unchanged.",
             "Disposable customers are deleted; successful test PaymentIntents/Charges and their "
             "risk history remain provider records "
             "(Stripe does not offer deletion of paid charges).",
             ""]
    for record in records:
        expected = "matched" if record["event_type"] == "charge.refunded" else "no_subscription"
        if (record.get("mapping") != expected or record.get("livemode") is not False
                or record.get("process_attempts") != 1 or record.get("audit_entries") != 1
                or any(record.get(key) is not True for key in keys[5:])):
            raise DrillError("Risk acceptance record is incomplete or not sandbox-safe")
        lines.append("- `" + json.dumps({key: record[key] for key in keys}, sort_keys=True) + "`")
    return lines + [""]


def run(config: DrillConfig) -> None:
    stripe = StripeTestClient(config.stripe_key)
    preflight = validate_stripe_preflight(stripe, config)
    listener: subprocess.Popen[str] | None = None
    backend: subprocess.Popen[str] | None = None
    cleanup_clocks: list[str] = []
    cleanup_customers: list[str] = []
    records: list[dict[str, Any]] = []
    checkout: dict[str, Any] | None = None
    portal_records: list[dict[str, Any]] = []
    risk_records: list[dict[str, Any]] = []
    cleanup = {"clocks_deleted": 0, "customers_deleted": 0}
    _persist_cleanup(config, cleanup_clocks, cleanup_customers)
    try:
        listener, webhook_secret = _start_stripe_listener(config)
        backend = _start_backend(config, webhook_secret)
        _wait_for_health(config, backend)
        engine = create_engine(config.database_url, pool_pre_ping=True)

        portal_context: dict[str, Any] = {}
        checkout = _run_checkout(
            stripe, config, engine, cleanup_clocks, cleanup_customers,
            context=portal_context,
        )
        if config.include_risk:
            risk_records = _run_risk_acceptance(
                StripeTestClient(config.stripe_key, api_version=StripeRiskClient.API_VERSION),
                config, engine, portal_context, webhook_secret, cleanup_clocks, cleanup_customers,
            )
        if config.include_portal:
            portal_records = _run_portal_acceptance(
                stripe, config, engine, portal_context, cleanup_clocks, cleanup_customers,
            )
        _stop_process(listener)
        listener = None

        _run_lifecycle(
            stripe,
            config,
            engine,
            webhook_secret,
            records,
            cleanup_clocks,
            cleanup_customers,
        )
        _create_cross_order_scenario(
            stripe,
            config,
            engine,
            webhook_secret,
            records,
            cleanup_clocks,
            cleanup_customers,
            label="cancel_then_old_payment",
            cancellation_first=True,
        )
        _create_cross_order_scenario(
            stripe,
            config,
            engine,
            webhook_secret,
            records,
            cleanup_clocks,
            cleanup_customers,
            label="old_payment_then_cancel",
            cancellation_first=False,
        )
    finally:
        error_in_flight = sys.exc_info()[0] is not None
        _stop_process(listener)
        _stop_process(backend)
        try:
            cleanup = cleanup_provider_objects(config, stripe)
        except DrillError:
            if not error_in_flight:
                raise

    if checkout is None:
        raise DrillError("Hosted Checkout evidence was not produced")
    if cleanup["clocks_deleted"] != len(cleanup_clocks):
        raise DrillError("One or more Stripe test clocks could not be deleted")
    if cleanup["customers_deleted"] != len(cleanup_customers):
        raise DrillError("One or more standalone Stripe customers could not be deleted")
    evidence = render_evidence(
        config=config,
        preflight=preflight,
        checkout=checkout,
        records=records,
        cleanup=cleanup,
        portal_records=portal_records,
        risk_records=risk_records,
    )
    config.evidence_path.parent.mkdir(parents=True, exist_ok=True)
    config.evidence_path.write_text(evidence, encoding="utf-8")
    print(f"KOV-005 Stripe sandbox drill passed; evidence={config.evidence_path.name}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Validate local safety guards without contacting Stripe or starting services.",
    )
    parser.add_argument(
        "--cleanup-only",
        action="store_true",
        help="Retry deletion of Stripe sandbox objects recorded in the local manifest.",
    )
    args = parser.parse_args()
    try:
        config = validate_environment(dict(os.environ))
        if args.validate_only and args.cleanup_only:
            raise DrillError("Choose only one of --validate-only or --cleanup-only")
        if args.cleanup_only:
            cleanup_provider_objects(config, StripeTestClient(config.stripe_key))
        elif not args.validate_only:
            run(config)
    except DrillError as exc:
        message = SECRET_RE.sub("[REDACTED]", str(exc))
        print(f"KOV-005 drill aborted: {message}", file=sys.stderr)
        return 1
    if args.validate_only:
        print("KOV-005 safety validation passed")
    elif args.cleanup_only:
        print("KOV-005 sandbox cleanup passed")
    else:
        print("KOV-005 complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
