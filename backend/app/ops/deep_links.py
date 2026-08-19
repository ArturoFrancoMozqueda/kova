"""Builders for deep links into external dashboards.

These produce plain URLs the frontend renders as anchors. They never embed
tokens or secrets — only public resource identifiers (event ids, customer ids,
deployment ids) that are safe to show an internal admin.
"""
from app.config import settings


def _stripe_base() -> str:
    # Test-mode dashboards live under /test; detect from the secret key prefix
    # exactly like app.main does for the live/test guard.
    key = settings.stripe_secret_key or ""
    prefix = "https://dashboard.stripe.com"
    if key.startswith(("sk_test_", "rk_test_")):
        return f"{prefix}/test"
    return prefix


def stripe_event(event_id: str) -> str:
    return f"{_stripe_base()}/events/{event_id}"


def stripe_customer(customer_id: str) -> str:
    return f"{_stripe_base()}/customers/{customer_id}"


def stripe_subscription(subscription_id: str) -> str:
    return f"{_stripe_base()}/subscriptions/{subscription_id}"


def sentry_issue(issue_id: str) -> str | None:
    org = settings.sentry_org_slug
    if not org:
        return None
    return f"https://{org}.sentry.io/issues/{issue_id}/"


def sentry_search(query: str) -> str | None:
    from urllib.parse import quote

    org = settings.sentry_org_slug
    if not org:
        return None
    return f"https://{org}.sentry.io/issues/?query={quote(query)}"


def fly_app() -> str:
    return f"https://fly.io/apps/{settings.fly_app_name}"


def fly_monitoring() -> str:
    return f"https://fly.io/apps/{settings.fly_app_name}/monitoring"


def vercel_deployment(deployment_id: str) -> str | None:
    team = settings.vercel_team_id
    project = settings.vercel_project_id
    if not (team and project):
        return None
    return f"https://vercel.com/{team}/{project}/{deployment_id}"


def uptimerobot_dashboard() -> str:
    return "https://dashboard.uptimerobot.com/monitors"
