import logging

from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from app.config import settings
from app.db import engine

router = APIRouter(prefix="/health", tags=["health"])
logger = logging.getLogger(__name__)


def _log_database_failure(exc):
    # Keep operational failures diagnosable without URLs, SQL, credentials or
    # customer values. Only classify known transport conditions and types.
    reason = "database"
    current = exc
    seen = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        description = str(current).lower()
        for marker, code in (
            ("different request", "request_context"),
            ("network error", "network"),
            ("timed out", "timeout"),
        ):
            if marker in description:
                reason = code
        current = current.__cause__ or current.__context__
    logger.warning("database_health_unavailable type=%s reason=%s", type(exc).__name__, reason)


@router.get("")
def health() -> dict[str, str]:
    return {"status": "ok", "release_sha": settings.kova_release_sha}


@router.head("")
def health_head() -> None:
    return None


@router.get("/db")
def health_db() -> dict[str, str]:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:
        _log_database_failure(exc)
        raise HTTPException(status_code=503, detail="database unreachable") from exc
    return {"status": "ok", "db": "reachable"}


@router.head("/db")
def health_db_head() -> None:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:
        _log_database_failure(exc)
        raise HTTPException(status_code=503, detail="database unreachable") from exc
    return None
