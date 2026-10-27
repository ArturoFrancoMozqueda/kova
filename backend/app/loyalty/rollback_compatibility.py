"""Fail closed when a prior release cannot reverse a later POS reward safely."""

from sqlalchemy import text

from app.shared.exceptions import conflict


def guard_reward_reversal(db, *, tenant_id, order):
    # Call only after the existing source-order row lock and idempotent replay.
    # A reward sale and redemption commit together. Checking after that lock
    # cannot miss a redemption committed while the reversal was waiting.
    # No advisory lock is acquired here: later code locks loyalty before order.
    if db.scalar(text("SELECT to_regclass('public.loyalty_reward_redemptions')")) is None:
        return
    reward = db.scalar(
        text(
            "SELECT 1 FROM public.loyalty_reward_redemptions "
            "WHERE tenant_id=:tenant AND branch_id=:branch AND sale_order_id=:sale LIMIT 1"
        ),
        {"tenant": tenant_id, "branch": order.branch_id, "sale": order.id},
    )
    if reward:
        raise conflict(
            "La devolución o anulación de esta venta con recompensa no está disponible "
            "por el momento. Contacta a soporte para restituir los puntos. "
            "No se realizó ningún cambio."
        )
