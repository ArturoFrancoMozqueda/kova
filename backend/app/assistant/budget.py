"""Atomic shared reservations; only verified Llama usage releases unused capacity."""

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


def charge(
    db, limits: list[tuple[str, int, int]], *, window: str | None = None,
    detail: str = "Se alcanzó el límite del asistente. Intenta después.",
    retry_after: int | None = None,
) -> None:
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
                detail,
                headers={
                    "Retry-After": str(
                        retry_after or max(1, int((reset_at() - datetime.now(UTC)).total_seconds()))
                    )
                },
            )
        db.execute(
            text("""UPDATE assistant_control.budgets SET used=used+:amount
            WHERE period_key=:window AND bucket=:bucket"""),
            {"window": window, "bucket": bucket, "amount": amount},
        )


def turn(db, tenant: UUID, user: UUID) -> None:
    # Daily inference capacity already bounds cost. Keep the burst guard without
    # an unrelated message cap that blocks testing even with capacity remaining.
    charge(
        db, [(f"rate:{tenant}:{user}", 1, 3)], window=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M"),
        detail="Estás enviando consultas muy rápido. Espera un minuto y vuelve a intentar.",
        retry_after=60,
    )


def chat_capacity() -> int:
    if settings.assistant_chat_uses_total_budget and not any((
        settings.assistant_documents_enabled, settings.assistant_email_enabled,
        settings.assistant_mutations_enabled,
    )):
        return settings.assistant_daily_budget
    return min(settings.assistant_chat_budget, settings.assistant_daily_budget)


def allocation(db, *, initialize=False, window: str | None = None):
    import json

    today = now_day = window or datetime.now(UTC).date().isoformat()
    configured = {
        "tenants": [str(t) for t in cohort()],
        "chat": chat_capacity(),
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
    fixed = (
        db.execute(
            text("SELECT data FROM assistant_control.allocations WHERE period_key=:day"),
            {"day": now_day},
        ).scalar()
        or configured
    )
    # Raise capacity for the same frozen cohort without resetting any usage.
    # Adding or removing tenants still waits for the next UTC day.
    if fixed["tenants"] == configured["tenants"]:
        expanded = {
            **fixed,
            "chat": max(fixed["chat"], configured["chat"]),
            "total": max(fixed["total"], configured["total"]),
        }
        if initialize and expanded != fixed:
            db.execute(
                text("UPDATE assistant_control.allocations SET data=CAST(:data AS jsonb) "
                     "WHERE period_key=:day"),
                {"day": today, "data": json.dumps(expanded)},
            )
        return expanded
    return fixed


def reserve(
    db,
    tenant: UUID,
    user: UUID,
    *,
    model: str,
    input_tokens: int,
    output_tokens: int,
    background: bool = False,
    window: str | None = None,
) -> int:
    if model == "openai/gpt-oss-120b" and settings.assistant_generation_provider == "openrouter":
        from app.assistant import openrouter_budget

        if background:
            raise HTTPException(503, "Modelo o consumo no verificable.")
        return openrouter_budget.reserve(db, tenant, user, input_tokens, output_tokens,
                                        window or datetime.now(UTC).date().isoformat())
    if model in {"openai/gpt-oss-20b", "openai/gpt-oss-120b"}:
        from app.assistant import groq_budget

        if background or settings.assistant_generation_provider != "groq":
            raise HTTPException(503, "Modelo o consumo no verificable.")
        return groq_budget.reserve(db, tenant, user, input_tokens, output_tokens,
                                   receipt_window=window or groq_budget.window())
    window = window or datetime.now(UTC).date().isoformat()
    amount = estimate(model, input_tokens, output_tokens)
    fixed = allocation(db, initialize=True, window=window)
    tenants = fixed["tenants"]
    if str(tenant) not in tenants:
        raise HTTPException(503, "El asistente no está habilitado.")
    chat = min(chat_capacity(), fixed["chat"])
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
            (f"{category}:{tenant}:{user}", amount, share),
        ],
        window=window,
        detail=(
            "No queda suficiente cuota diaria de IA para esta consulta. "
            "Se renueva al final del día UTC."
        ),
    )
    return amount


def settle(db, tenant: UUID, user: UUID, job_id: UUID, reservation_id: str, reported) -> int:
    from app.assistant import repository as repo

    # Same lock ordering as reserve: shared counters, then private job. Settlement
    # and the receipt transition commit together, preventing replayed refunds.
    db.execute(text("SELECT pg_advisory_xact_lock(69850425)"))
    job = repo.get(db, tenant, user, "run", job_id, lock=True)
    receipt = job.data.get("pending_reservation")
    if not receipt or receipt["id"] != reservation_id:
        return 0
    retained = receipt["amount"]
    if receipt.get("provider") == "openrouter":
        from app.assistant import openrouter_budget

        released = openrouter_budget.refund(db, tenant, user, receipt, reported)
        repo.update(job, remote_started=False, pending_reservation=None,
                    reserved=job.data["reserved"] - released)
        return released
    if receipt["model"] in {"openai/gpt-oss-20b", "openai/gpt-oss-120b"}:
        from app.assistant import groq_budget

        actual = groq_budget.verified_usage(reported, receipt)
        retained = actual if actual is not None else retained
        released = groq_budget.refund(db, tenant, user, receipt, retained)
        repo.update(job, remote_started=False, pending_reservation=None,
                    reserved=job.data["reserved"] - released)
        return released
    # Llama has no separate reasoning budget. Do not infer billable usage for
    # reasoning models, missing usage, partial responses or ambiguous requests.
    if receipt["model"] == "@cf/meta/llama-3.3-70b-instruct-fp8-fast" and isinstance(
        reported, dict
    ):
        counts = [reported.get(k) for k in ("prompt_tokens", "completion_tokens", "total_tokens")]
        if (
            all(type(v) is int and v >= 0 for v in counts)
            and counts[0] > 0
            and counts[2] == counts[0] + counts[1]
            and set(reported) <= {"prompt_tokens", "completion_tokens", "total_tokens"}
        ):
            if counts[0] > receipt["input_tokens"] or counts[1] > receipt["output_tokens"]:
                raise HTTPException(503, "El consumo reportado excedió la reserva verificada.")
            retained = estimate(receipt["model"], counts[0], counts[1])
    released = receipt["amount"] - retained
    if released:
        for bucket in ("account", "chat", f"chat:{tenant}", f"chat:{tenant}:{user}"):
            result = db.execute(
                text("""UPDATE assistant_control.budgets SET used=used-:amount
                WHERE period_key=:window AND bucket=:bucket AND used>=:amount"""),
                {"amount": released, "window": receipt["window"], "bucket": bucket},
            )
            if result.rowcount != 1:
                raise HTTPException(503, "No se pudo verificar el consumo del asistente.")
    repo.update(
        job,
        remote_started=False,
        pending_reservation=None,
        reserved=job.data["reserved"] - released,
    )
    return released


def usage(db, tenant: UUID, user: UUID) -> dict:
    if settings.assistant_generation_provider == "openrouter":
        from app.assistant import openrouter_budget

        return openrouter_budget.usage(db, tenant, user)
    if settings.assistant_generation_provider == "groq":
        from app.assistant import groq_budget

        return groq_budget.usage(db, tenant, user)
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
        min(chat_capacity(), fixed["chat"])
        // max(1, len(fixed["tenants"]))
        if str(tenant) in fixed["tenants"]
        else 0
    )
    return {
        "tenant_used": used.get(bucket, 0),
        "tenant_limit": share,
        "user_used": used.get(own, 0),
        "user_limit": share,
        "reset_at": reset_at().isoformat(),
        "unit": "neurons", "provider": "cloudflare", "window": "utc_day",
        "limit_kind": "tenant_daily" if used.get(bucket, 0) >= share else "available",
    }
