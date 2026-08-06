import csv
import io
from collections import Counter, defaultdict
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.orders.models import Order
from app.shifts.models import Shift
from app.telemetry.models import AnonymousTelemetryEvent, TelemetryEvent

CRO_EXPORT_COLUMNS = (
    "date",
    "event",
    "client_id",
    "device_class",
    "viewport_bucket",
    "source",
    "medium",
    "campaign",
    "cta",
    "section",
    "experiment_id",
    "variant",
    "conversion_state",
)

_CONVERSION_RANK = {
    "landing_viewed": 0,
    "landing_cta_clicked": 1,
    "signup_started": 2,
    "signup_completed": 3,
    "first_sale_completed": 4,
    "trial_to_paid": 5,
}
_CONVERSION_LABEL = {
    0: "landing_viewed",
    1: "cta_clicked",
    2: "signup_started",
    3: "signup_completed",
    4: "activated",
    5: "paid",
}

ANALYSIS_EVENT_NAMES = (
    "analysis_viewed",
    "analysis_recommendation_opened",
    "analysis_action_started",
    "analysis_action_completed",
    "analysis_action_reopened",
    "analysis_action_feedback",
)


def _text_property(properties: dict[str, Any], key: str) -> str:
    value = properties.get(key)
    return value if isinstance(value, str) else ""


def build_cro_export(
    db: Session, *, days: int = 30, now: datetime | None = None
) -> str:
    """Build the authorized, PII-free CRO export across both telemetry tables.

    The caller must enforce operator authorization. This function intentionally
    selects only pseudonymous ``client_id`` and coarse allowlisted dimensions;
    tenant/user IDs and arbitrary event properties never enter the CSV.
    """
    end = now or datetime.now(UTC)
    start = end - timedelta(days=days)
    anonymous = db.scalars(
        select(AnonymousTelemetryEvent)
        .where(AnonymousTelemetryEvent.created_at >= start)
        .where(AnonymousTelemetryEvent.created_at <= end)
    ).all()
    authenticated = db.scalars(
        select(TelemetryEvent)
        .where(TelemetryEvent.created_at >= start)
        .where(TelemetryEvent.created_at <= end)
    ).all()

    rows: list[tuple[datetime, str, str, dict[str, Any]]] = []
    for event in anonymous:
        rows.append((event.created_at, event.event_name, event.client_id, event.properties))
    for event in authenticated:
        client_id = _text_property(event.properties, "client_id")
        if client_id:
            rows.append((event.created_at, event.event_name, client_id, event.properties))
    rows.sort(key=lambda row: row[0])

    stages: defaultdict[str, int] = defaultdict(lambda: -1)
    for _, event_name, client_id, _ in rows:
        stages[client_id] = max(stages[client_id], _CONVERSION_RANK.get(event_name, -1))

    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=CRO_EXPORT_COLUMNS, lineterminator="\n")
    writer.writeheader()
    for created_at, event_name, client_id, properties in rows:
        writer.writerow(
            {
                "date": created_at.astimezone(UTC).isoformat(),
                "event": event_name,
                "client_id": client_id,
                "device_class": _text_property(properties, "device_class"),
                "viewport_bucket": _text_property(properties, "viewport_bucket"),
                "source": _text_property(properties, "source"),
                "medium": _text_property(properties, "medium"),
                "campaign": _text_property(properties, "campaign"),
                "cta": _text_property(properties, "cta"),
                "section": _text_property(properties, "section"),
                "experiment_id": _text_property(properties, "experiment_id"),
                "variant": _text_property(properties, "variant"),
                "conversion_state": _CONVERSION_LABEL.get(stages[client_id], "observed"),
            }
        )
    return output.getvalue()


def _rate(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


def summarize_analysis_adoption(
    events: Iterable[TelemetryEvent],
    first_sales: Iterable[tuple[Any, datetime]],
    closed_shifts: Iterable[tuple[Any, datetime]],
    *,
    days: int,
    now: datetime,
) -> dict[str, Any]:
    """Build an identity-free tracker summary from already bounded observations."""
    end = now or datetime.now(UTC)
    start = end - timedelta(days=days)
    previous_start = start - timedelta(days=days)
    all_events = list(events)
    sale_observations = list(first_sales)
    shift_observations = list(closed_shifts)
    current_events = [event for event in all_events if start <= event.created_at <= end]
    previous_events = [
        event for event in all_events if previous_start <= event.created_at < start
    ]

    viewed_tenants = {
        event.tenant_id
        for event in current_events
        if event.event_name == "analysis_viewed"
    }
    previous_viewed_tenants = {
        event.tenant_id
        for event in previous_events
        if event.event_name == "analysis_viewed"
    }
    completed_tenants = {
        event.tenant_id
        for event in current_events
        if event.event_name == "analysis_action_completed"
    }
    helpful_tenants = {
        event.tenant_id
        for event in current_events
        if event.event_name == "analysis_action_feedback"
        and event.properties.get("helpfulness") == "helpful"
    }
    not_yet_tenants = {
        event.tenant_id
        for event in current_events
        if event.event_name == "analysis_action_feedback"
        and event.properties.get("helpfulness") == "not_yet"
    }
    active_tenants = {tenant_id for tenant_id, _ in sale_observations}
    active_viewers = active_tenants & viewed_tenants
    completed_viewers = viewed_tenants & completed_tenants
    helpful_viewers = completed_viewers & helpful_tenants
    not_yet_viewers = completed_viewers & not_yet_tenants
    active_completed = active_tenants & completed_viewers
    active_helpful = active_tenants & helpful_viewers
    returning_viewers = previous_viewed_tenants & viewed_tenants

    view_times: defaultdict[Any, list[datetime]] = defaultdict(list)
    for event in current_events:
        if event.event_name == "analysis_viewed":
            view_times[event.tenant_id].append(event.created_at)
    first_sale_times = {
        tenant_id: first_sale_at for tenant_id, first_sale_at in sale_observations
    }
    shift_times: defaultdict[Any, list[datetime]] = defaultdict(list)
    for tenant_id, closed_at in shift_observations:
        shift_times[tenant_id].append(closed_at)
    closed_tenants = set(shift_times)
    sale_close_analysis_tenants = {
        tenant_id
        for tenant_id in active_tenants & closed_tenants & viewed_tenants
        if any(
            first_sale_times[tenant_id] <= closed_at <= viewed_at
            for closed_at in shift_times[tenant_id]
            for viewed_at in view_times[tenant_id]
        )
    }

    event_counts = Counter(event.event_name for event in current_events)
    decision_area_counts = Counter(
        area
        for event in current_events
        if isinstance((area := event.properties.get("decision_area")), str)
    )
    completed_area_counts = Counter(
        event.properties["decision_area"]
        for event in current_events
        if event.event_name == "analysis_action_completed"
        and isinstance(event.properties.get("decision_area"), str)
    )
    return {
        "window": {
            "days": days,
            "start": start.astimezone(UTC).isoformat(),
            "end": end.astimezone(UTC).isoformat(),
        },
        "tenants": {
            "active": len(active_tenants),
            "viewed": len(viewed_tenants),
            "active_viewed": len(active_viewers),
            "completed_action": len(completed_viewers),
            "helpful_action": len(helpful_viewers),
            "not_yet_action": len(not_yet_viewers),
            "active_completed_action": len(active_completed),
            "active_helpful_action": len(active_helpful),
        },
        "rates": {
            "active_view_rate": _rate(len(active_viewers), len(active_tenants)),
            "viewer_completion_rate": _rate(len(completed_viewers), len(viewed_tenants)),
            "viewer_helpful_rate": _rate(len(helpful_viewers), len(viewed_tenants)),
            "active_completion_rate": _rate(len(active_completed), len(active_tenants)),
            "active_helpful_rate": _rate(len(active_helpful), len(active_tenants)),
        },
        "retention": {
            "previous_viewed": len(previous_viewed_tenants),
            "returning_viewed": len(returning_viewers),
            "return_rate": _rate(len(returning_viewers), len(previous_viewed_tenants)),
        },
        "journey": {
            "sold": len(active_tenants),
            "closed_shift": len(closed_tenants),
            "sale_close_analysis": len(sale_close_analysis_tenants),
            "sale_close_analysis_rate": _rate(
                len(sale_close_analysis_tenants), len(active_tenants)
            ),
        },
        "events": {name: event_counts.get(name, 0) for name in ANALYSIS_EVENT_NAMES},
        "decision_areas": dict(sorted(decision_area_counts.items())),
        "completed_decision_areas": dict(sorted(completed_area_counts.items())),
    }


def build_analysis_adoption_report(
    db: Session, *, days: int = 7, now: datetime | None = None
) -> dict[str, Any]:
    """Return business-level analysis adoption without exposing tenant identities."""
    end = now or datetime.now(UTC)
    start = end - timedelta(days=days)
    previous_start = start - timedelta(days=days)
    events = db.scalars(
        select(TelemetryEvent)
        .where(TelemetryEvent.created_at >= previous_start)
        .where(TelemetryEvent.created_at <= end)
        .where(TelemetryEvent.event_name.in_(ANALYSIS_EVENT_NAMES))
    ).all()
    sale_at = func.coalesce(Order.occurred_at, Order.created_at)
    first_sales = db.execute(
        select(Order.tenant_id, func.min(sale_at).label("first_sale_at"))
        .where(Order.status == "completed")
        .where(sale_at >= start)
        .where(sale_at <= end)
        .group_by(Order.tenant_id)
    ).all()
    closed_shifts = db.execute(
        select(Shift.tenant_id, Shift.closed_at)
        .where(Shift.status == "closed")
        .where(Shift.closed_at.is_not(None))
        .where(Shift.closed_at >= start)
        .where(Shift.closed_at <= end)
    ).all()
    return summarize_analysis_adoption(
        events,
        first_sales,
        closed_shifts,
        days=days,
        now=end,
    )
