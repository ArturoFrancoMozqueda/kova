"""Atomic shared reservations. An uncertain remote outcome keeps its full charge."""

import math
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text

from app.assistant.access import cohort
from app.config import settings

RATES = {
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast": (26668, 204805),
    "@cf/qwen/qwen3.8-27b": (40909, 290909),
    "@cf/qwen/qwen3-30b-a3b-fp8": (4625, 30475),
    "@cf/qwen/qwen3-embedding-0.6b": (1075, 0),
}


def estimate(model: str, input_tokens: int, output_tokens: int) -> int:
    if model not in RATES or min(input_tokens, output_tokens) < 0:
        raise HTTPException(503, "Modelo o consumo no verificable.")
    a, b = RATES[model]
    return math.ceil((a * input_tokens + b * output_tokens) / 1_000_000 * 1.15)


def reset_at() -> datetime:
    return datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)


def charge(db, limits: list[tuple[str, int, int]], *, window: str | None = None) -> None:
    window = window or datetime.now(UTC).date().isoformat()
    # All counters are metadata only in a non-exposed control schema. The lock
    # lasts only through reservation commit, never over a network call.
    db.execute(text("SELECT pg_advisory_xact_lock(69850425)"))
    for bucket, amount, ceiling in limits:
        db.execute(
            text("""INSERT INTO assistant_control.budgets (period_key, bucket, used)
            VALUES (:window, :bucket, 0) ON CONFLICT DO NOTHING"""),
            {"window": window, "bucket": bucket},
        )
        used = db.execute(
            text("""SELECT used FROM assistant_control.budgets
            WHERE period_key=:window AND bucket=:bucket FOR UPDATE"""),
            {"window": window, "bucket": bucket},
        ).scalar_one()
        if used + amount > ceiling:
            raise HTTPException(
                429,
                "Se alcanzó el límite del asistente. Intenta después.",
                headers={
                    "Retry-After": str(
                        max(1, int((reset_at() - datetime.now(UTC)).total_seconds()))
                    )
                },
            )
        db.execute(
            text("""UPDATE assistant_control.budgets SET used=used+:amount
            WHERE period_key=:window AND bucket=:bucket"""),
            {"window": window, "bucket": bucket, "amount": amount},
        )


def turn(db, tenant: UUID, user: UUID) -> None:
    charge(db, [(f"turn:{tenant}:{user}", 1, 30)])
    charge(
        db, [(f"rate:{tenant}:{user}", 1, 3)], window=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M")
    )


def allocation(db, *, initialize=False):
    import json

    today = now_day = datetime.now(UTC).date().isoformat()
    configured = {
        "tenants": [str(t) for t in cohort()],
        "chat": min(settings.assistant_chat_budget, settings.assistant_daily_budget),
        "total": settings.assistant_daily_budget,
    }
    if initialize:
        db.execute(text("SELECT pg_advisory_xact_lock(69850425)"))
        db.execute(
            text(
                "INSERT INTO assistant_control.allocations(period_key,data) "
                "VALUES (:day,CAST(:data AS jsonb)) ON CONFLICT DO NOTHING"
            ),
            {"day": today, "data": json.dumps(configured)},
        )
    return (
        db.execute(
            text("SELECT data FROM assistant_control.allocations WHERE period_key=:day"),
            {"day": now_day},
        ).scalar()
        or configured
    )


def reserve(
    db,
    tenant: UUID,
    user: UUID,
    *,
    model: str,
    input_tokens: int,
    output_tokens: int,
    background: bool = False,
) -> int:
    amount = estimate(model, input_tokens, output_tokens)
    fixed = allocation(db, initialize=True)
    tenants = fixed["tenants"]
    if str(tenant) not in tenants:
        raise HTTPException(503, "El asistente no está habilitado.")
    chat = min(settings.assistant_chat_budget, settings.assistant_daily_budget, fixed["chat"])
    total = min(settings.assistant_daily_budget, fixed["total"])
    pool = max(0, total - chat) if background else chat
    share = pool // max(1, len(tenants))
    category = "background" if background else "chat"
    charge(
        db,
        [
            ("account", amount, total),
            (category, amount, pool),
            (f"{category}:{tenant}", amount, share),
            (f"{category}:{tenant}:{user}", amount, int(share * 0.75)),
        ],
    )
    return amount


def usage(db, tenant: UUID, user: UUID) -> dict:
    today = datetime.now(UTC).date().isoformat()
    bucket = f"chat:{tenant}"
    own = f"chat:{tenant}:{user}"
    rows = db.execute(
        text("""SELECT bucket, used FROM assistant_control.budgets
        WHERE period_key=:day AND bucket IN (:tenant, :user)"""),
        {"day": today, "tenant": bucket, "user": own},
    ).all()
    used = dict(rows)
    fixed = allocation(db)
    share = (
        min(settings.assistant_chat_budget, settings.assistant_daily_budget, fixed["chat"])
        // max(1, len(fixed["tenants"]))
        if str(tenant) in fixed["tenants"]
        else 0
    )
    return {
        "tenant_used": used.get(bucket, 0),
        "tenant_limit": share,
        "user_used": used.get(own, 0),
        "user_limit": int(share * 0.75),
        "reset_at": reset_at().isoformat(),
    }
