import time
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.ops.schemas import (
    OpsStatus,
    OverviewHealth,
    OverviewResponse,
    SourceHealth,
    VersionInfo,
)

# Only observed states elevate the overall status; degraded/not_configured are
# reported per-source but never page the CEO on their own.
_OVERALL_RANK: dict[OpsStatus, int] = {"ok": 0, "warning": 1, "critical": 2}


def db_health(db: Session) -> SourceHealth:
    started = time.perf_counter()
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        return SourceHealth(status="critical", detail="database unreachable", checked_at=_now())
    latency_ms = round((time.perf_counter() - started) * 1000, 2)
    return SourceHealth(status="ok", latency_ms=latency_ms, checked_at=_now())


def _now() -> datetime:
    return datetime.now(UTC)


def _configured_or_not(token: str | None) -> SourceHealth:
    if not token:
        return SourceHealth(status="not_configured")
    # Real connector checks land with the connectors module; until then a
    # configured token is reported as degraded (unknown state), never fake-ok.
    return SourceHealth(status="degraded", detail="connector not implemented yet")


def overall_status(sources: dict[str, SourceHealth]) -> OpsStatus:
    worst: OpsStatus = "ok"
    for source in sources.values():
        rank = _OVERALL_RANK.get(source.status)
        if rank is not None and rank > _OVERALL_RANK[worst]:
            worst = source.status
    return worst


def build_overview(db: Session) -> OverviewResponse:
    sources: dict[str, SourceHealth] = {
        "db": db_health(db),
        "sentry": _configured_or_not(settings.sentry_api_token),
        "fly": _configured_or_not(settings.fly_api_token),
        "vercel": _configured_or_not(settings.vercel_api_token),
        "uptimerobot": _configured_or_not(settings.uptimerobot_api_key),
    }
    return OverviewResponse(
        generated_at=_now(),
        environment=settings.app_env,
        version=VersionInfo(git_sha=settings.git_sha),
        health=OverviewHealth(overall=overall_status(sources), sources=sources),
    )
