"""Incident computation.

Incidents are derived on read from their sources of truth (webhook_events,
subscriptions, and the external connectors). Only the human triage state is
persisted (ops_incident_states), keyed by the natural key (source, external_id).

Severity rules are conservative and live as pure functions so they're trivially
testable. A source that's merely unreachable never invents an incident — it's
reported as a degraded source instead.
"""
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from app.billing.models import Subscription, WebhookEvent
from app.ops import deep_links
from app.ops.schemas import IncidentSeverity


@dataclass
class ComputedIncident:
    source: str
    external_id: str
    severity: IncidentSeverity
    title: str
    detected_at: datetime
    last_seen_at: datetime | None = None
    correlation: dict = field(default_factory=dict)
    deep_links: list[tuple[str, str]] = field(default_factory=list)

    @property
    def key(self) -> str:
        return f"{self.source}:{self.external_id}"


def _now() -> datetime:
    return datetime.now(UTC)


# ── Pure severity rules ───────────────────────────────────────────────────────


def webhook_severity(event: WebhookEvent, *, now: datetime) -> IncidentSeverity:
    if event.processing_status == "received":
        return "warning"  # stuck, unprocessed
    # failed:
    age = now - _aware(event.created_at)
    if event.process_attempts >= 3 or age > timedelta(hours=24):
        return "critical"
    return "warning"


def subscription_severity(sub: Subscription, *, now: datetime) -> IncidentSeverity:
    if (
        sub.grace_period_ends_at is not None
        and _aware(sub.grace_period_ends_at) < now
    ):
        return "critical"
    return "warning"


def sentry_issue_severity(*, level: str | None, count_24h: int) -> IncidentSeverity:
    if level == "fatal" or count_24h >= 50:
        return "critical"
    return "warning"


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


# ── Builders per source ───────────────────────────────────────────────────────


def _webhook_incident(event: WebhookEvent, *, now: datetime) -> ComputedIncident:
    return ComputedIncident(
        source="stripe_webhook",
        external_id=event.stripe_event_id,
        severity=webhook_severity(event, now=now),
        title=f"Webhook {event.event_type} {event.processing_status}",
        detected_at=_aware(event.created_at),
        last_seen_at=_aware(event.processed_at) if event.processed_at else None,
        correlation={
            "tenant_id": event.tenant_id,
            "stripe_event_id": event.stripe_event_id,
        },
        deep_links=[("Stripe event", deep_links.stripe_event(event.stripe_event_id))],
    )


def _subscription_incident(
    sub: Subscription, tenant_name: str, *, now: datetime
) -> ComputedIncident:
    links: list[tuple[str, str]] = []
    if sub.stripe_customer_id:
        links.append(("Stripe customer", deep_links.stripe_customer(sub.stripe_customer_id)))
    if sub.stripe_subscription_id:
        links.append(
            ("Stripe subscription", deep_links.stripe_subscription(sub.stripe_subscription_id))
        )
    return ComputedIncident(
        source="subscription",
        external_id=str(sub.tenant_id),
        severity=subscription_severity(sub, now=now),
        title=f"Suscripción {tenant_name} en past_due",
        detected_at=_aware(sub.past_due_at) if sub.past_due_at else now,
        correlation={"tenant_id": sub.tenant_id},
        deep_links=links,
    )


def _connector_incidents(connectors: dict, *, now: datetime) -> list[ComputedIncident]:
    incidents: list[ComputedIncident] = []

    sentry_result = connectors.get("sentry")
    if sentry_result and sentry_result.status in ("warning", "critical"):
        for issue in (sentry_result.data or {}).get("issues", []):
            issue_id = str(issue.get("issue_id"))
            last_seen = _parse_iso(issue.get("last_seen")) or now
            incidents.append(
                ComputedIncident(
                    source="sentry",
                    external_id=issue_id,
                    severity=sentry_issue_severity(
                        level=issue.get("level"), count_24h=issue.get("count_24h", 0)
                    ),
                    title=issue.get("title") or "Sentry issue",
                    detected_at=last_seen,
                    last_seen_at=last_seen,
                    correlation={},
                    deep_links=[("Sentry issue", issue["permalink"])]
                    if issue.get("permalink")
                    else [],
                )
            )

    uptime_result = connectors.get("uptimerobot")
    if uptime_result and uptime_result.status == "critical":
        for monitor in (uptime_result.data or {}).get("monitors", []):
            if monitor.get("monitor_status") in (8, 9):
                name = monitor.get("name") or "monitor"
                incidents.append(
                    ComputedIncident(
                        source="uptimerobot",
                        external_id=name,
                        severity="critical",
                        title=f"UptimeRobot: {name} caído",
                        detected_at=now,
                        deep_links=[("UptimeRobot", monitor["deep_link"])]
                        if monitor.get("deep_link")
                        else [],
                    )
                )

    fly_result = connectors.get("fly")
    if fly_result and fly_result.status == "critical":
        for machine in (fly_result.data or {}).get("machines", []):
            if machine.get("state") != "started":
                incidents.append(
                    ComputedIncident(
                        source="fly",
                        external_id=str(machine.get("machine_id")),
                        severity="critical",
                        title=f"Fly machine {machine.get('state')}",
                        detected_at=now,
                        deep_links=[("Fly app", deep_links.fly_app())],
                    )
                )

    vercel_result = connectors.get("vercel")
    if vercel_result and vercel_result.status == "warning":
        dep = (vercel_result.data or {}).get("latest_production_deployment")
        if dep and dep.get("state") == "ERROR":
            incidents.append(
                ComputedIncident(
                    source="vercel",
                    external_id=str(dep.get("deployment_id")),
                    severity="warning",
                    title="Deploy de Vercel en ERROR",
                    detected_at=now,
                    deep_links=[("Vercel deployment", dep["deep_link"])]
                    if dep.get("deep_link")
                    else [],
                )
            )

    return incidents


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return _aware(datetime.fromisoformat(value.replace("Z", "+00:00")))
    except ValueError:
        return None
