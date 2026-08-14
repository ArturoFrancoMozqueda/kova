from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from app.config import settings
from app.db import engine

router = APIRouter(prefix="/health", tags=["health"])


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
        raise HTTPException(status_code=503, detail="database unreachable") from exc
    return {"status": "ok", "db": "reachable"}


@router.head("/db")
def health_db_head() -> None:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="database unreachable") from exc
    return None
