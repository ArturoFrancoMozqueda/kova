import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


class StripeCheckoutError(Exception):
    pass


class StripePriceError(Exception):
    pass


class StripeSubscriptionError(Exception):
    pass


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
        request = Request(
            f"https://api.stripe.com/v1/subscriptions/{subscription_id}",
            headers={"Authorization": f"Bearer {secret_key}"},
            method="GET",
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
