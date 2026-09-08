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
from app.config import sqlalchemy_database_url  # noqa: E402

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


@dataclass(frozen=True)
class SubscriptionSnapshot:
    status: str
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
    required = {
        "KOV005_STRIPE_SECRET_KEY",
        "KOV005_STRIPE_STANDARD_PRICE_ID",
        "KOV005_STRIPE_ACCOUNT_ID",
        "DATABASE_URL",
        "KOV005_EVIDENCE_PATH",
        "KOV005_CLEANUP_PATH",
    }
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
    if not environ["KOV005_STRIPE_STANDARD_PRICE_ID"].startswith("price_"):
        raise DrillError("KOV005_STRIPE_STANDARD_PRICE_ID must be a Stripe Price id")
    if not environ["KOV005_STRIPE_ACCOUNT_ID"].startswith("acct_"):
        raise DrillError("KOV005_STRIPE_ACCOUNT_ID must be a Stripe account id")

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
        price_id=environ["KOV005_STRIPE_STANDARD_PRICE_ID"],
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
    def __init__(self, key: str) -> None:
        self._key = key

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
            },
        )
        try:
            with urlopen(request, timeout=20) as response:
                payload = json.loads(response.read())
        except HTTPError as exc:
            exc.read()
            raise DrillError(f"Stripe API request failed with HTTP {exc.code} at {path}") from exc
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise DrillError(f"Stripe API request failed at {path}: {type(exc).__name__}") from exc
        if not isinstance(payload, dict):
            raise DrillError(f"Stripe API returned an invalid object at {path}")
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
    price = stripe.get(f"/v1/prices/{config.price_id}")
    recurring = price.get("recurring") or {}
    if (
        price.get("livemode") is not False
        or price.get("active") is not True
        or price.get("unit_amount") != 29_900
        or str(price.get("currency", "")).lower() != "mxn"
        or recurring.get("interval") != "month"
    ):
        raise DrillError(
            "Sandbox price must be active, test mode, MXN 299.00, and recurring monthly"
        )
    return {
        "account_id": redact_identifier(str(account.get("id") or "")),
        "price_id": redact_identifier(str(price.get("id") or "")),
        "livemode": False,
        "amount_minor_units": 29_900,
        "currency": "MXN",
        "interval": "month",
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
        signup = self.request(
            "POST",
            "/api/v1/auth/signup",
            {
                "email": email,
                "password": password,
                "tenant_name": f"KOV-005 Stripe Sandbox {suffix}",
                "accepted_terms": True,
            },
        )
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
            ",".join(sorted(EVENT_TYPES)),
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


def _start_backend(config: DrillConfig, webhook_secret: str) -> subprocess.Popen[str]:
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
            "STRIPE_STANDARD_PRICE_ID": config.price_id,
            "STRIPE_CHECKOUT_SUCCESS_URL": f"{config.app_base_url}/health",
            "STRIPE_CHECKOUT_CANCEL_URL": f"{config.app_base_url}/health",
            "STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION": "false",
            "RESEND_API_KEY": "",
            "INTERNAL_ADMIN_EMAILS": "",
        }
    )
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
    _record_event(
        records,
        step=step,
        order=order,
        event=event,
        delivered_at=delivered_at,
        response=response,
        snapshot=_snapshot(engine, tenant_id),
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
        raise DrillError("Stripe hosted Checkout automation failed")


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


def _run_checkout(
    stripe: StripeTestClient,
    config: DrillConfig,
    engine: Any,
    cleanup_clocks: list[str],
    cleanup_customers: list[str],
) -> dict[str, Any]:
    client = KovaClient(config.app_base_url, config.frontend_origin)
    tenant_id = client.create_verified_owner("checkout")
    checkout = client.request(
        "POST",
        "/api/v1/billing/checkout",
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
            customer_id = str(stripe_session.get("customer") or "")
            if customer_id and customer_id not in cleanup_customers:
                cleanup_customers.append(customer_id)
                _persist_cleanup(config, cleanup_clocks, cleanup_customers)
        except DrillError:
            pass
    status = _wait_for_subscription_status(client, {"active", "trialing"})
    stripe_session = stripe_session or stripe.get(f"/v1/checkout/sessions/{checkout_id}")
    _assert_test_object(stripe_session, object_name="Checkout Session")
    subscription = status.get("subscription") or {}
    local = _snapshot(engine, tenant_id)
    if local.status not in {"active", "trialing"} or local.lifecycle_watermark_at is None:
        raise DrillError("Hosted Checkout did not establish a lifecycle watermark")
    return {
        "checkout_session_id": redact_identifier(checkout_id),
        "provider_status": stripe_session.get("status"),
        "provider_payment_status": stripe_session.get("payment_status"),
        "livemode": False,
        "local_subscription_status": subscription.get("status"),
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
) -> str:
    lines = [
        "# KOV-005 — Stripe test-mode temporal convergence drill",
        "",
        f"- Executed at: `{datetime.now(UTC).isoformat().replace('+00:00', 'Z')}`",
        f"- Commit: `{config.release_sha}`",
        f"- GitHub environment: `{EXPECTED_ENVIRONMENT}`",
        "- Stripe mode: `livemode=false`",
        f"- Stripe account: `{preflight['account_id']}`",
        f"- Stripe price: `{preflight['price_id']}` (`MXN 299.00`, monthly)",
        "- Application/database: isolated GitHub runner, loopback only",
        "",
        "## Hosted Checkout",
        "",
        f"- Session: `{checkout['checkout_session_id']}`",
        f"- Provider result: `{checkout['provider_status']}/{checkout['provider_payment_status']}`",
        f"- Local result: `{checkout['local_subscription_status']}`",
        f"- Delivery: `{checkout['delivery']}`",
        "",
        "## Lifecycle and ordering evidence",
        "",
        "| Step | # | Event | Event ID | Provider created | Arrived | Result | "
        "Local status | Lifecycle watermark | Payment watermark |",
        "|---|---:|---|---|---|---|---|---|---|---|",
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
            f"`{item['event_id']}` | {item['event_created_at']} | {item['delivered_at']} | "
            f"`{item['response']}` | `{snapshot['status']}` | {lifecycle} | {payment} |"
        )
    lines.extend(
        [
            "",
            "## Acceptance",
            "",
            "- Hosted Checkout completed using Stripe's test-mode page.",
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
            f"- Standalone Checkout customers deleted: `{cleanup['customers_deleted']}`",
            "- Local listener and backend stopped; the GitHub PostgreSQL service is ephemeral.",
            "",
            "All Stripe identifiers are redacted to prefix plus final six characters. "
            "The artifact contains no keys, webhook signing secrets, Checkout URLs, "
            "card data, cookies, email addresses, or database URLs.",
            "",
        ]
    )
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


def run(config: DrillConfig) -> None:
    stripe = StripeTestClient(config.stripe_key)
    preflight = validate_stripe_preflight(stripe, config)
    listener: subprocess.Popen[str] | None = None
    backend: subprocess.Popen[str] | None = None
    cleanup_clocks: list[str] = []
    cleanup_customers: list[str] = []
    records: list[dict[str, Any]] = []
    checkout: dict[str, Any] | None = None
    cleanup = {"clocks_deleted": 0, "customers_deleted": 0}
    _persist_cleanup(config, cleanup_clocks, cleanup_customers)
    try:
        listener, webhook_secret = _start_stripe_listener(config)
        backend = _start_backend(config, webhook_secret)
        _wait_for_health(config, backend)
        engine = create_engine(config.database_url, pool_pre_ping=True)

        checkout = _run_checkout(
            stripe, config, engine, cleanup_clocks, cleanup_customers
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
