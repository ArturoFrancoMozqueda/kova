"""Fly.io connector — machine states and current release for the tech panel.

Fly's public API exposes machine state (Machines API) and app/release metadata
(GraphQL). It does NOT expose historical log querying — live logs stream over
NATS via `fly logs`. So the trace view only offers a deep link to the Fly
monitoring dashboard; it never claims to have searched Fly logs.
"""
from app.config import settings
from app.ops.connectors.base import (
    ConnectorError,
    ConnectorResult,
    degraded,
    http_get_json,
    not_configured,
)

_MACHINES_BASE = "https://api.machines.dev/v1"
_GRAPHQL_URL = "https://api.fly.io/graphql"


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.fly_api_token}",
        "Content-Type": "application/json",
    }


def fetch_status(*, timeout: float) -> ConnectorResult:
    if not settings.fly_api_token:
        return not_configured()
    app_name = settings.fly_app_name
    url = f"{_MACHINES_BASE}/apps/{app_name}/machines"
    try:
        raw = http_get_json(url, headers=_headers(), timeout=timeout)
    except ConnectorError as exc:
        return degraded(str(exc))
    machines = []
    status = "ok"
    for item in raw if isinstance(raw, list) else []:
        state = item.get("state")
        machines.append(
            {
                "machine_id": item.get("id"),
                "region": item.get("region"),
                "state": state,
                "updated_at": item.get("updated_at"),
            }
        )
        if state != "started":
            status = "critical"
    if not machines:
        # Reachable but no machines is itself a critical signal.
        status = "critical"
    return ConnectorResult(status=status, data={"machines": machines})
