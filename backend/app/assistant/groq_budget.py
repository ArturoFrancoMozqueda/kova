"""Rolling free-plan limits in the existing private control schema.

One timestamped receipt per request makes limits conservative across calendar
boundaries, replicas and restarts. No content or credentials enter this ledger.
"""

import math
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import text

from app.assistant.access import cohort
from app.config import settings


def window() -> str:
    return datetime.now(UTC).isoformat(timespec="microseconds") + "|" + uuid4().hex


def estimate(input_tokens: int, output_tokens: int) -> int:
    # Include template overhead and headroom until a verified provider tokenizer
    # is available. Completion includes reasoning, never just displayed text.
    if min(input_tokens, output_tokens) < 0:
        raise HTTPException(503, "Consumo no verificable.")
    return math.ceil((input_tokens + output_tokens + 256) * 1.15)


def _lock(db):
    db.execute(text("SELECT pg_advisory_xact_lock(69850425)"))


def allocation(db, *, initialize=False):
    key = datetime.now(UTC).date().isoformat() + "|groq"
    current = {"tenants": [str(t) for t in cohort()],
               "total": settings.assistant_groq_daily_tokens}
    if initialize:
        import json

        _lock(db)
        db.execute(text("""INSERT INTO assistant_control.allocations(period_key,data)
            VALUES (:key,CAST(:data AS jsonb)) ON CONFLICT DO NOTHING"""),
                   {"key": key, "data": json.dumps(current)})
    return db.execute(text(
        "SELECT data FROM assistant_control.allocations WHERE period_key=:key"
    ), {"key": key}).scalar() or current


def _rows(db, bucket, seconds=86400):
    cutoff = (datetime.now(UTC) - timedelta(seconds=seconds)).isoformat(timespec="microseconds")
    return db.execute(text("""SELECT period_key,used FROM assistant_control.budgets
        WHERE bucket=:bucket AND period_key>:cutoff AND used>0 ORDER BY period_key"""),
                      {"bucket": bucket, "cutoff": cutoff}).all()


def _recovery(rows, amount, ceiling, seconds):
    remaining = sum(row.used for row in rows) + amount - ceiling
    for row in rows:
        remaining -= row.used
        if remaining <= 0:
            return datetime.fromisoformat(row.period_key.split("|", 1)[0]) + timedelta(
                seconds=seconds
            )
    return datetime.now(UTC) + timedelta(seconds=seconds)


def _raise(kind, recovery):
    wait = max(1, math.ceil((recovery - datetime.now(UTC)).total_seconds()))
    message = {
        "temporary": "La IA alcanzó un límite temporal.",
        "provider_daily": "Se agotó la capacidad compartida de IA.",
        "tenant_daily": "Este negocio alcanzó su cuota de IA.",
    }[kind]
    raise HTTPException(429, message + " La ayuda y los reportes directos siguen disponibles.",
                        headers={"Retry-After": str(wait), "X-Kova-Assistant-Limit": kind})


def reserve(db, tenant: UUID, user: UUID, input_tokens, output_tokens, *, receipt_window):
    _lock(db)
    fixed = allocation(db, initialize=True)
    if str(tenant) not in fixed["tenants"]:
        raise HTTPException(503, "El asistente no está habilitado.")
    amount = estimate(input_tokens, output_tokens)
    if amount > settings.assistant_groq_minute_tokens:
        raise HTTPException(422, "El contexto es demasiado extenso. Haz una pregunta más concreta.")
    total = min(fixed["total"], settings.assistant_groq_daily_tokens)
    share = total // max(1, len(fixed["tenants"]))
    checks = [
        ("groq:tokens:account", amount, total, 86400, "provider_daily"),
        ("groq:requests:account", 1, settings.assistant_groq_daily_requests,
         86400, "provider_daily"),
        (f"groq:tokens:{tenant}", amount, share, 86400, "tenant_daily"),
        (f"groq:tokens:{tenant}:{user}", amount, share, 86400, "tenant_daily"),
        ("groq:tokens:account", amount, settings.assistant_groq_minute_tokens,
         60, "temporary"),
        ("groq:requests:account", 1, settings.assistant_groq_minute_requests,
         60, "temporary"),
    ]
    cooldown = cooldown_until(db)
    if cooldown:
        _raise("temporary", cooldown)
    for bucket, delta, ceiling, seconds, kind in checks:
        rows = _rows(db, bucket, seconds)
        if sum(row.used for row in rows) + delta > ceiling:
            _raise(kind, _recovery(rows, delta, ceiling, seconds))
    for bucket, delta, *_ in checks[:4]:
        db.execute(text("""INSERT INTO assistant_control.budgets(period_key,bucket,used)
            VALUES (:key,:bucket,:used)"""),
                   {"key": receipt_window, "bucket": bucket, "used": delta})
    return amount


def cooldown_until(db):
    result = db.execute(text("""SELECT max(period_key) FROM assistant_control.budgets
        WHERE bucket='groq:cooldown' AND period_key>:now"""),
                        {"now": datetime.now(UTC).isoformat(timespec="microseconds")}).scalar()
    return datetime.fromisoformat(result) if result else None


def cooldown(db, seconds):
    _lock(db)
    until = datetime.now(UTC) + timedelta(seconds=min(86400, max(1, int(seconds))))
    db.execute(text("""INSERT INTO assistant_control.budgets(period_key,bucket,used)
        VALUES (:until,'groq:cooldown',1) ON CONFLICT DO NOTHING"""),
               {"until": until.isoformat(timespec="microseconds")})


def verified_usage(reported, receipt):
    if not isinstance(reported, dict):
        return None
    counts = [reported.get(k) for k in ("prompt_tokens", "completion_tokens", "total_tokens")]
    if not (all(type(v) is int and v >= 0 for v in counts) and counts[0] > 0
            and counts[2] == counts[0] + counts[1]):
        return None
    details = reported.get("completion_tokens_details")
    # Groq's completion total includes hidden reasoning. Reject ambiguous totals
    # or malformed detail fields; never add reasoning again or subtract it.
    if not isinstance(details, dict) or type(details.get("reasoning_tokens")) is not int:
        return None
    if not 0 <= details["reasoning_tokens"] <= counts[1]:
        return None
    if counts[0] > receipt["input_tokens"] + 256 or counts[1] > receipt["output_tokens"]:
        raise HTTPException(503, "El consumo reportado excedió la reserva verificada.")
    return counts[2]


def refund(db, tenant, user, receipt, retained):
    released = receipt["amount"] - retained
    if released < 0:
        raise HTTPException(503, "El consumo reportado excedió la reserva verificada.")
    if released:
        for bucket in ("groq:tokens:account", f"groq:tokens:{tenant}",
                       f"groq:tokens:{tenant}:{user}"):
            result = db.execute(text("""UPDATE assistant_control.budgets SET used=used-:amount
                WHERE period_key=:key AND bucket=:bucket AND used>=:amount"""),
                                {"amount": released, "key": receipt["window"], "bucket": bucket})
            if result.rowcount != 1:
                raise HTTPException(503, "No se pudo verificar el consumo del asistente.")
    return released


def usage(db, tenant, user):
    fixed = allocation(db)
    total = min(fixed["total"], settings.assistant_groq_daily_tokens)
    share = total // max(1, len(fixed["tenants"])) if str(tenant) in fixed["tenants"] else 0
    tenant_rows = _rows(db, f"groq:tokens:{tenant}")
    user_rows = _rows(db, f"groq:tokens:{tenant}:{user}")
    kind = "available"
    reset = min((datetime.fromisoformat(row.period_key.split("|", 1)[0])
                 + timedelta(days=1) for row in tenant_rows), default=datetime.now(UTC))
    checks = [
        ("groq:tokens:account", total, 86400, "provider_daily"),
        ("groq:requests:account", settings.assistant_groq_daily_requests, 86400, "provider_daily"),
        (f"groq:tokens:{tenant}", share, 86400, "tenant_daily"),
        (f"groq:tokens:{tenant}:{user}", share, 86400, "tenant_daily"),
        ("groq:tokens:account", settings.assistant_groq_minute_tokens, 60, "temporary"),
        ("groq:requests:account", settings.assistant_groq_minute_requests, 60, "temporary"),
    ]
    for bucket, ceiling, seconds, reason in checks:
        rows = _rows(db, bucket, seconds)
        if sum(row.used for row in rows) >= ceiling:
            kind = reason
            reset = _recovery(rows, 1, ceiling, seconds)
            break
    cooldown = cooldown_until(db)
    if cooldown and kind == "available":
        kind, reset = "temporary", cooldown
    return {
        "tenant_used": sum(row.used for row in tenant_rows), "tenant_limit": share,
        "user_used": sum(row.used for row in user_rows), "user_limit": share,
        "reset_at": reset.isoformat(), "unit": "tokens", "provider": "groq",
        "limit_kind": kind, "window": "rolling_24h",
    }
