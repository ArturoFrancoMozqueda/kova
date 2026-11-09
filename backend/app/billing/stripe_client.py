import json
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

if sys.platform == "emscripten":
    from app.workers.http import urlopen


class StripeCheckoutError(Exception):
    pass


class StripePriceError(Exception):
    pass


class StripeSubscriptionError(Exception):
    pass


class StripePortalError(Exception):
    pass


class StripePortalClient:
    """Only the server selects the customer, return URL and cohort configuration."""

    def retrieve_configuration(self, *, secret_key: str, configuration_id: str) -> dict[str, Any]:
        path = quote(configuration_id, safe="")
        query = urlencode({"expand[]": "features.subscription_update.products"})
        request = Request(
            f"https://api.stripe.com/v1/billing_portal/configurations/{path}?{query}",
            headers={"Authorization": f"Bearer {secret_key}"}, method="GET",
        )
        return self._request(request)

    def create_session(
        self, *, secret_key: str, customer_id: str, configuration_id: str, return_url: str,
    ) -> dict[str, Any]:
        request = Request(
            "https://api.stripe.com/v1/billing_portal/sessions",
            data=urlencode({"customer": customer_id, "configuration": configuration_id,
                            "return_url": return_url, "locale": "es-419"}).encode(),
            headers={"Authorization": f"Bearer {secret_key}",
                     "Content-Type": "application/x-www-form-urlencoded"}, method="POST",
        )
        return self._request(request)

    @staticmethod
    def _request(request: Request) -> dict[str, Any]:
        try:
            with urlopen(request, timeout=10) as response:
                parsed = json.loads(response.read().decode())
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise StripePortalError("Stripe portal request failed") from exc
        if not isinstance(parsed, dict):
            raise StripePortalError("Unexpected Stripe portal response")
        return parsed


STRIPE_READ_TIMEOUT_SECONDS = 3
STRIPE_READ_MAX_ATTEMPTS = 2


def _retryable_http_error(exc: HTTPError) -> bool:
    return exc.code == 429 or 500 <= exc.code < 600


class StripePriceClient:
    def retrieve_price(self, *, secret_key: str, price_id: str) -> dict[str, Any]:
        encoded_price_id = quote(str(price_id), safe="")
        request = Request(
            f"https://api.stripe.com/v1/prices/{encoded_price_id}",
            headers={"Authorization": f"Bearer {secret_key}"},
            method="GET",
        )
        try:
            with urlopen(request, timeout=10) as response:
                body = response.read().decode()
        except HTTPError as exc:
            detail = exc.read().decode(errors="replace")
            raise StripePriceError(detail) from exc
        except URLError as exc:
            raise StripePriceError(str(exc.reason)) from exc

        parsed = json.loads(body)
        if not isinstance(parsed, dict):
            raise StripePriceError("Unexpected Stripe response")
        return parsed


def _with_session_id_placeholder(success_url: str) -> str:
    """Append Stripe's ``{CHECKOUT_SESSION_ID}`` template to the return URL.

    The billing success page self-heals a lost ``checkout.session.completed``
    webhook by reconciling against the Stripe session, so it needs the session
    id in the query string. Stripe substitutes the placeholder on redirect.
    Idempotent: a URL that already carries the placeholder is left untouched.
    """
    if "{CHECKOUT_SESSION_ID}" in success_url:
        return success_url
    separator = "&" if "?" in success_url else "?"
    return f"{success_url}{separator}session_id={{CHECKOUT_SESSION_ID}}"


class StripeCheckoutClient:
    def create_checkout_session(
        self,
        *,
        secret_key: str,
        price_id: str,
        success_url: str,
        cancel_url: str,
        tenant_id: str,
        user_id: str,
        idempotency_key: str,
        customer: str | None = None,
    ) -> dict[str, Any]:
        payload = {
            "mode": "subscription",
            "line_items[0][price]": price_id,
            "line_items[0][quantity]": "1",
            "success_url": _with_session_id_placeholder(success_url),
            "cancel_url": cancel_url,
            "client_reference_id": tenant_id,
            "metadata[tenant_id]": tenant_id,
            "metadata[user_id]": user_id,
            # Stripe does not copy checkout-session metadata onto the created
            # subscription, so stamp the tenant onto the subscription too. This
            # is what lets production customer.subscription.* events resolve to
            # a tenant and converge status (e.g. cancellation removes access).
            "subscription_data[metadata][tenant_id]": tenant_id,
        }
        # Reuse the tenant's existing Stripe customer so a re-subscription does
        # not mint a duplicate customer (which could double-bill).
        if customer:
            payload["customer"] = customer
        data = urlencode(payload).encode()
        request = Request(
            "https://api.stripe.com/v1/checkout/sessions",
            data=data,
            headers={
                "Authorization": f"Bearer {secret_key}",
                "Content-Type": "application/x-www-form-urlencoded",
                "Idempotency-Key": idempotency_key,
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=10) as response:
                body = response.read().decode()
        except HTTPError as exc:
            detail = exc.read().decode(errors="replace")
            raise StripeCheckoutError(detail) from exc
        except URLError as exc:
            raise StripeCheckoutError(str(exc.reason)) from exc

        parsed = json.loads(body)
        if not isinstance(parsed, dict):
            raise StripeCheckoutError("Unexpected Stripe response")
        return parsed

    def retrieve_session(
        self,
        *,
        secret_key: str,
        session_id: str,
    ) -> dict[str, Any]:
        encoded_session_id = quote(str(session_id), safe="")
        request = Request(
            f"https://api.stripe.com/v1/checkout/sessions/{encoded_session_id}",
            headers={"Authorization": f"Bearer {secret_key}"},
            method="GET",
        )
        try:
            with urlopen(request, timeout=10) as response:
                body = response.read().decode()
        except HTTPError as exc:
            detail = exc.read().decode(errors="replace")
            raise StripeCheckoutError(detail) from exc
        except URLError as exc:
            raise StripeCheckoutError(str(exc.reason)) from exc

        parsed = json.loads(body)
        if not isinstance(parsed, dict):
            raise StripeCheckoutError("Unexpected Stripe response")
        return parsed


class StripeSubscriptionClient:
    def retrieve(
        self,
        *,
        secret_key: str,
        stripe_subscription_id: str,
    ) -> dict[str, Any]:
        subscription_id = quote(stripe_subscription_id, safe="")
        body: str | None = None
        for attempt in range(STRIPE_READ_MAX_ATTEMPTS):
            request = Request(
                f"https://api.stripe.com/v1/subscriptions/{subscription_id}?expand[]=latest_invoice",
                headers={"Authorization": f"Bearer {secret_key}"},
                method="GET",
            )
            try:
                with urlopen(request, timeout=STRIPE_READ_TIMEOUT_SECONDS) as response:
                    body = response.read().decode()
                break
            except HTTPError as exc:
                if not _retryable_http_error(exc) or attempt == STRIPE_READ_MAX_ATTEMPTS - 1:
                    detail = exc.read().decode(errors="replace")
                    raise StripeSubscriptionError(detail) from exc
            except URLError as exc:
                if attempt == STRIPE_READ_MAX_ATTEMPTS - 1:
                    raise StripeSubscriptionError(str(exc.reason)) from exc
            time.sleep(0.1 * (attempt + 1))

        if body is None:  # Defensive: the bounded loop either returns a body or raises.
            raise StripeSubscriptionError("Stripe subscription lookup failed")

        parsed = json.loads(body)
        if not isinstance(parsed, dict):
            raise StripeSubscriptionError("Unexpected Stripe response")
        return parsed

    def update_cancel_at_period_end(
        self,
        *,
        secret_key: str,
        stripe_subscription_id: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        data = urlencode({"cancel_at_period_end": "true"}).encode()
        subscription_id = quote(stripe_subscription_id, safe="")
        request = Request(
            f"https://api.stripe.com/v1/subscriptions/{subscription_id}",
            data=data,
            headers={
                "Authorization": f"Bearer {secret_key}",
                "Content-Type": "application/x-www-form-urlencoded",
                "Idempotency-Key": idempotency_key,
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=10) as response:
                body = response.read().decode()
        except HTTPError as exc:
            detail = exc.read().decode(errors="replace")
            raise StripeSubscriptionError(detail) from exc
        except URLError as exc:
            raise StripeSubscriptionError(str(exc.reason)) from exc

        parsed = json.loads(body)
        if not isinstance(parsed, dict):
            raise StripeSubscriptionError("Unexpected Stripe response")
        return parsed


class StripeRiskError(Exception):
    """A read-only risk lookup failed; never retain Stripe response bodies."""


class StripePaymentMethodClient:
    """Billing-only operations; never changes a price, charge, or entitlement."""

    def retrieve_customer(self, *, secret_key: str, customer_id: str) -> dict[str, Any]:
        path = quote(customer_id, safe="")
        return self._request(
            Request(
                f"https://api.stripe.com/v1/customers/{path}?expand[]=invoice_settings.default_payment_method",
                headers={"Authorization": f"Bearer {secret_key}"},
                method="GET",
            )
        )

    def clear_subscription_override(
        self,
        *,
        secret_key: str,
        subscription_id: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        path = quote(subscription_id, safe="")
        return self._request(
            Request(
                f"https://api.stripe.com/v1/subscriptions/{path}",
                data=urlencode({"default_payment_method": ""}).encode(),
                headers={
                    "Authorization": f"Bearer {secret_key}",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Idempotency-Key": idempotency_key,
                },
                method="POST",
            )
        )

    @staticmethod
    def _request(request: Request) -> dict[str, Any]:
        try:
            with urlopen(request, timeout=10) as response:
                body = response.read(1_048_577)
            if len(body) > 1_048_576:
                raise StripeSubscriptionError("Stripe payment method response exceeds limit")
            result = json.loads(body)
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError):
            raise StripeSubscriptionError("Stripe payment method operation unavailable") from None
        if not isinstance(result, dict):
            raise StripeSubscriptionError("Unexpected Stripe payment method response")
        return result


class StripeRiskClient:
    # Isolated read contract (InvoicePayments object graph, Basil and later).
    API_VERSION = "2026-09-30.endive"

    def retrieve(self, *, secret_key: str, resource: str, object_id: str) -> dict[str, Any]:
        if resource not in {"charges", "invoices", "subscriptions"}:
            raise StripeRiskError("Unsupported risk resource")
        return self._get(secret_key, f"/{resource}/{quote(object_id, safe='')}")

    def invoice_payments(self, *, secret_key: str, payment_intent: str,
                         starting_after: str | None = None) -> dict[str, Any]:
        params = {"payment[type]": "payment_intent", "payment[payment_intent]": payment_intent,
                  "status": "paid", "limit": "100"}
        if starting_after:
            params["starting_after"] = starting_after
        return self._get(secret_key, "/invoice_payments?" + urlencode(params))

    @staticmethod
    def _get(secret_key: str, path: str) -> dict[str, Any]:
        for attempt in range(STRIPE_READ_MAX_ATTEMPTS):
            request = Request("https://api.stripe.com/v1" + path, method="GET", headers={
                "Authorization": f"Bearer {secret_key}",
                "Stripe-Version": StripeRiskClient.API_VERSION,
            })
            try:
                with urlopen(request, timeout=STRIPE_READ_TIMEOUT_SECONDS) as response:
                    body = response.read(1_048_577)
                if len(body) > 1_048_576:
                    raise StripeRiskError("Risk response exceeds limit")
                parsed = json.loads(body)
                if not isinstance(parsed, dict):
                    raise StripeRiskError("Unexpected risk response")
                return parsed
            except HTTPError as exc:
                if not _retryable_http_error(exc) or attempt == STRIPE_READ_MAX_ATTEMPTS - 1:
                    raise StripeRiskError("Risk lookup unavailable") from None
            except (URLError, TimeoutError):
                if attempt == STRIPE_READ_MAX_ATTEMPTS - 1:
                    raise StripeRiskError("Risk lookup unavailable") from None
            except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
                raise StripeRiskError("Invalid risk response") from None
            time.sleep(0.1 * (attempt + 1))
        raise StripeRiskError("Risk lookup unavailable")
