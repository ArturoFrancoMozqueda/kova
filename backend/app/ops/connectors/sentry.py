"""Sentry connector — unresolved issues for the technical panel and issue
search by request_id for tracing.

Uses the Issues API (available on all plans). Event-level Discover search is a
paid feature and is deliberately not used.
"""
from app.config import settings
from app.ops import deep_links
from app.ops.connectors.base import (
    ConnectorError,
    ConnectorResult,
    degraded,
    http_get_json,
    not_configured,
)

_BASE = "https://sentry.io/api/0"


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.sentry_api_token}"}


def _configured() -> bool:
    return bool(
        settings.sentry_api_token
        and settings.sentry_org_slug
        and settings.sentry_project_slug
    )


def fetch_unresolved_issues(*, timeout: float, limit: int = 10) -> ConnectorResult:
    if not _configured():
        return not_configured()
    org = settings.sentry_org_slug
    proj = settings.sentry_project_slug
    url = (
        f"{_BASE}/projects/{org}/{proj}/issues/"
        f"?query=is:unresolved&statsPeriod=24h&sort=freq&limit={limit}"
    )
    try:
        raw = http_get_json(url, headers=_headers(), timeout=timeout)
    except ConnectorError as exc:
        return degraded(str(exc))
    issues = []
    for item in raw if isinstance(raw, list) else []:
        count = int(item.get("count", 0) or 0)
        issues.append(
            {
                "issue_id": item.get("id"),
                "title": item.get("title"),
                "culprit": item.get("culprit"),
                "level": item.get("level"),
                "count_24h": count,
                "last_seen": item.get("lastSeen"),
                "permalink": item.get("permalink")
                or deep_links.sentry_issue(item.get("id", "")),
            }
        )
    status = "ok"
    for issue in issues:
        if issue["level"] == "fatal" or issue["count_24h"] >= 50:
            status = "critical"
            break
        status = "warning"
    return ConnectorResult(status=status, data={"unresolved_24h": len(issues), "issues": issues})


def search_issues_by_request_id(request_id: str, *, timeout: float) -> ConnectorResult:
    if not _configured():
        return not_configured()
    org = settings.sentry_org_slug
    proj = settings.sentry_project_slug
    from urllib.parse import quote

    query = quote(f"request_id:{request_id}")
    url = f"{_BASE}/projects/{org}/{proj}/issues/?query={query}&limit=25"
    try:
        raw = http_get_json(url, headers=_headers(), timeout=timeout)
    except ConnectorError as exc:
        return degraded(str(exc))
    issues = [
        {
            "issue_id": item.get("id"),
            "title": item.get("title"),
            "level": item.get("level"),
            "last_seen": item.get("lastSeen"),
            "permalink": item.get("permalink"),
        }
        for item in (raw if isinstance(raw, list) else [])
    ]
    return ConnectorResult(status="ok", data={"issues": issues})
