import csv
import io
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

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
