"""Atomic paid capacity, separate from Cloudflare neurons and Groq free tokens."""

import math
from datetime import UTC, datetime
from decimal import ROUND_CEILING, Decimal

from fastapi import HTTPException
from sqlalchemy import text

from app.assistant import budget, openrouter
from app.config import settings


def estimate(input_tokens, output_tokens):
    if min(input_tokens, output_tokens) < 0 or input_tokens > 8000 or output_tokens > 1024:
        raise HTTPException(503, "Modelo o consumo no verificable.")
    prompt = math.ceil((input_tokens + 256) * 1.15)
    return prompt + output_tokens, prompt * openrouter.INPUT_NANOUSD + (
        output_tokens * openrouter.OUTPUT_NANOUSD
    )


def cost_window():
    return datetime.now(UTC).strftime("%Y-%m-01")


def monthly_reset_at():
    current = datetime.now(UTC)
    return current.replace(year=current.year + (current.month == 12),
                           month=current.month % 12 + 1, day=1,
                           hour=0, minute=0, second=0, microsecond=0)


def pause_until(db):
    return db.execute(text(
        "SELECT coalesce(max(used),0) FROM assistant_control.budgets WHERE bucket='or:pause'"
    )).scalar_one()


def cooldown(db, seconds):
    try:
        delay = max(1, min(3600, int(seconds)))
    except (ValueError, TypeError):
        delay = 60
    db.execute(text("SELECT pg_advisory_xact_lock(69850425)"))
    recovery = math.ceil(datetime.now(UTC).timestamp()) + delay
    db.execute(text("""INSERT INTO assistant_control.budgets(period_key,bucket,used)
        VALUES (:period,'or:pause',:recovery) ON CONFLICT (period_key,bucket)
        DO UPDATE SET used=greatest(assistant_control.budgets.used,excluded.used)"""),
               {"period": cost_window(), "recovery": recovery})


def require_available(db):
    wait = math.ceil(pause_until(db) - datetime.now(UTC).timestamp())
    if wait > 0:
        raise HTTPException(429, "La IA tiene una pausa temporal. "
                            "La ayuda y los reportes directos siguen disponibles.",
                            headers={"Retry-After": str(wait),
                                     "X-Kova-Assistant-Limit": "temporary"})


def reserve(db, tenant, user, input_tokens, output_tokens, window):
    db.execute(text("SELECT pg_advisory_xact_lock(69850425)"))
    require_available(db)
    tokens, cost = estimate(input_tokens, output_tokens)
    fixed = budget.allocation(db, initialize=True, window=window)
    if str(tenant) not in fixed["tenants"] or settings.assistant_openrouter_monthly_usd <= 0:
        raise HTTPException(503, "El presupuesto de inferencia no está habilitado.")
    share = settings.assistant_openrouter_tenant_daily_tokens
    try:
        budget.charge(
            db,
            [("or:usd", cost, settings.assistant_openrouter_monthly_usd * 1_000_000_000)],
            window=window[:7] + "-01",
            detail="Se alcanzó la capacidad mensual de IA.",
            retry_after=max(1, math.ceil((monthly_reset_at()
                                         - datetime.now(UTC)).total_seconds())),
        )
    except HTTPException as exc:
        if exc.status_code == 429:
            exc.headers = {**(exc.headers or {}), "X-Kova-Assistant-Limit": "provider_monthly"}
        raise
    budget.charge(
        db,
        [
            ("or:tokens", tokens, settings.assistant_openrouter_daily_tokens),
            (f"or:tokens:{tenant}", tokens, share),
            (f"or:tokens:{tenant}:{user}", tokens, share),
        ],
        window=window,
    )
    return tokens


def metadata(input_tokens, output_tokens, window):
    _, cost = estimate(input_tokens, output_tokens)
    return {
        "cost_window": window[:7] + "-01",
        "cost_nanousd": cost,
        "provider": "openrouter",
        "route": openrouter.ROUTE,
    }


def verified_usage(reported, receipt):
    if not isinstance(reported, dict):
        return None
    counts = [reported.get(k) for k in ("prompt_tokens", "completion_tokens", "total_tokens")]
    details = reported.get("completion_tokens_details")
    if (
        not all(type(v) is int and v >= 0 for v in counts)
        or counts[0] == 0
        or counts[2] != counts[0] + counts[1]
        or not isinstance(details, dict)
        or type(details.get("reasoning_tokens")) is not int
        or not 0 <= details["reasoning_tokens"] <= counts[1]
    ):
        return None
    try:
        value = Decimal(str(reported.get("cost")))
        if not value.is_finite() or value < 0:
            return None
        cost = int((value * 1_000_000_000).to_integral_value(rounding=ROUND_CEILING))
    except ArithmeticError:
        return None
    if (
        counts[0] > receipt["amount"] - receipt["output_tokens"]
        or counts[1] > receipt["output_tokens"]
        or cost > receipt["cost_nanousd"]
    ):
        raise HTTPException(503, "El consumo reportado excedió la reserva verificada.")
    return counts[2], cost


def refund(db, tenant, user, receipt, reported):
    verified = verified_usage(reported, receipt)
    if verified is None:
        return 0
    tokens, cost = verified
    releases = [(receipt["cost_window"], "or:usd", receipt["cost_nanousd"] - cost)]
    released = receipt["amount"] - tokens
    releases.extend(
        (receipt["window"], key, released)
        for key in (
            "or:tokens",
            f"or:tokens:{tenant}",
            f"or:tokens:{tenant}:{user}",
        )
    )
    for window, bucket, amount in releases:
        if (
            amount
            and db.execute(
                text("""UPDATE assistant_control.budgets SET used=used-:amount
            WHERE period_key=:window AND bucket=:bucket AND used>=:amount"""),
                {"window": window, "bucket": bucket, "amount": amount},
            ).rowcount
            != 1
        ):
            raise HTTPException(503, "No se pudo verificar el consumo del asistente.")
    return released


def usage(db, tenant, user):
    day = datetime.now(UTC).date().isoformat()
    keys = ("or:tokens", f"or:tokens:{tenant}", f"or:tokens:{tenant}:{user}")
    used = dict(
        db.execute(
            text("""SELECT bucket,used FROM assistant_control.budgets
        WHERE period_key=:day AND bucket IN (:account,:tenant,:user)"""),
            {"day": day, "account": keys[0], "tenant": keys[1], "user": keys[2]},
        ).all()
    )
    cap = settings.assistant_openrouter_tenant_daily_tokens
    pause = pause_until(db)
    paused = pause > datetime.now(UTC).timestamp()
    monthly_used = db.execute(text("SELECT used FROM assistant_control.budgets "
                                   "WHERE period_key=:period AND bucket='or:usd'"),
                             {"period": cost_window()}).scalar() or 0
    monthly_exhausted = monthly_used >= settings.assistant_openrouter_monthly_usd * 1_000_000_000
    return {
        "tenant_used": used.get(keys[1], 0),
        "tenant_limit": cap,
        "user_used": used.get(keys[2], 0),
        "user_limit": cap,
        "reset_at": budget.reset_at().isoformat(),
        "retry_at": (datetime.fromtimestamp(pause, UTC).isoformat() if paused
                     else monthly_reset_at().isoformat() if monthly_exhausted
                     else budget.reset_at().isoformat()),
        "unit": "tokens",
        "provider": "openrouter",
        "window": "utc_day",
        "limit_kind": (
            "temporary" if paused else "provider_monthly" if monthly_exhausted else "provider_daily"
            if used.get(keys[0], 0) >= settings.assistant_openrouter_daily_tokens
            else "tenant_daily"
            if used.get(keys[1], 0) >= cap
            else "available"
        ),
    }
