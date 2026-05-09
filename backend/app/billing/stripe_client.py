import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


class StripeCheckoutError(Exception):
    pass


class StripeSubscriptionError(Exception):
    pass


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
    ) -> dict[str, Any]:
        payload = {
            "mode": "subscription",
            "line_items[0][price]": price_id,
            "line_items[0][quantity]": "1",
            "success_url": success_url,
            "cancel_url": cancel_url,
            "client_reference_id": tenant_id,
            "metadata[tenant_id]": tenant_id,
            "metadata[user_id]": user_id,
        }
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


class StripeSubscriptionClient:
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
