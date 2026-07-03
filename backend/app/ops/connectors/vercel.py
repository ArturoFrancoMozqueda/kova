"""Vercel connector — latest production deployment for the technical panel."""
from app.config import settings
from app.ops import deep_links
from app.ops.connectors.base import (
    ConnectorError,
    ConnectorResult,
    degraded,
    http_get_json,
    not_configured,
)

_BASE = "https://api.vercel.com"


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.vercel_api_token}"}


def fetch_latest_deployment(*, timeout: float) -> ConnectorResult:
    if not (settings.vercel_api_token and settings.vercel_project_id):
        return not_configured()
    params = f"projectId={settings.vercel_project_id}&target=production&limit=1"
    if settings.vercel_team_id:
        params += f"&teamId={settings.vercel_team_id}"
    url = f"{_BASE}/v6/deployments?{params}"
    try:
        raw = http_get_json(url, headers=_headers(), timeout=timeout)
    except ConnectorError as exc:
        return degraded(str(exc))
    deployments = raw.get("deployments", []) if isinstance(raw, dict) else []
    if not deployments:
        return ConnectorResult(status="warning", data={"latest_production_deployment": None})
    dep = deployments[0]
    state = dep.get("state") or dep.get("readyState")
    meta = dep.get("meta") or {}
    deployment_id = dep.get("uid") or dep.get("id")
    # READY → ok, BUILDING/QUEUED → warning, ERROR/CANCELED → warning (the prior
    # deploy keeps serving; a truly down site is reported by UptimeRobot).
    status = "ok" if state == "READY" else "warning"
    data = {
        "latest_production_deployment": {
            "deployment_id": deployment_id,
            "state": state,
            "created_at": dep.get("createdAt") or dep.get("created"),
            "commit_sha": meta.get("githubCommitSha"),
            "commit_message": meta.get("githubCommitMessage"),
            "url": dep.get("url"),
            "deep_link": deep_links.vercel_deployment(deployment_id) if deployment_id else None,
        }
    }
    return ConnectorResult(status=status, data=data)
