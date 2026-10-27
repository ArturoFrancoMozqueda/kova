"""One explicit points reward, atomically delivered through the existing POS pricing."""

from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.audit import service as audit
from app.branches.scope import active_branch_id
from app.idempotency import service as idempotency
from app.loyalty import service
from app.loyalty.models import LoyaltyEntry, LoyaltyRewardRedemption, LoyaltyRewardRevision
from app.loyalty.schemas import LoyaltyRewardOffer, LoyaltyRewardResponse
from app.orders import service as orders
from app.orders.models import Order, OrderItem, Refund, RefundItem
from app.shared.exceptions import bad_request, conflict


def latest(db: Session, tenant_id: UUID):
    return (
        db.query(LoyaltyRewardRevision)
        .filter_by(
            tenant_id=tenant_id,
            branch_id=active_branch_id(db, tenant_id),
        )
        .order_by(LoyaltyRewardRevision.version.desc())
        .first()
    )


def describe(row):
    return (
        None
        if row is None
        else LoyaltyRewardResponse(
            **{name: getattr(row, name) for name in LoyaltyRewardResponse.model_fields},
        ).model_dump(mode="json")
    )


def available(db: Session, tenant_id: UUID):
    row = latest(db, tenant_id)
    if (
        row is None
        or not row.enabled
        or not service._authorized(
            db,
            tenant_id,
            active_branch_id(db, tenant_id),
            row,
        )
    ):
        return None
    return row


def save(db, tenant_id, user_id, body, key):
    service._lock(db, tenant_id)
    digest, replay = service._claim(db, tenant_id, key, "reward-policy", body)
    if replay:
        return replay.response_status, replay.response_body
    current = latest(db, tenant_id)
    if body.expected_version != (current.version if current else 0):
        raise conflict("La recompensa cambió. Actualiza antes de guardar")
    row = LoyaltyRewardRevision(
        tenant_id=tenant_id,
        branch_id=active_branch_id(db, tenant_id),
        version=body.expected_version + 1,
        enabled=body.enabled,
        title=body.title,
        points_cost=body.points_cost,
        discount_amount=body.discount_amount,
        authorized_by_user_id=user_id,
    )
    db.add(row)
    db.flush()
    result = describe(row)
    audit.log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="loyalty.reward.policy",
        resource_type=row.__tablename__,
        resource_id=row.id,
        changes={
            "version": row.version,
            "points_cost": row.points_cost,
            "discount_amount": str(row.discount_amount),
            "enabled": row.enabled,
        },
    )
    idempotency.store(
        db,
        tenant_id=tenant_id,
        key=key,
        request_hash=digest,
        response_status=200,
        response_body=result,
    )
    db.commit()
    return 200, result


def offer(db, tenant_id, customer_id):
    service._customer(db, tenant_id, customer_id, active=True)
    return LoyaltyRewardOffer(
        customer_id=customer_id,
        balance=service._balance(db, tenant_id, customer_id),
        adjustments_pending=service._pending_reversal_query(db, tenant_id, customer_id).first()
        is not None,
        reward=describe(available(db, tenant_id)),
    )


def _lock_sources(db, tenant_id, customer_id):
    # Same source locks as manual redemption; refund/void cannot change earned
    # purchasing power between the pending-adjustment check and the debit.
    db.query(Order.id).join(
        LoyaltyEntry,
        (LoyaltyEntry.sale_order_id == Order.id)
        & (LoyaltyEntry.tenant_id == Order.tenant_id)
        & (LoyaltyEntry.branch_id == Order.branch_id),
    ).filter(
        Order.tenant_id == tenant_id,
        Order.branch_id == active_branch_id(db, tenant_id),
        LoyaltyEntry.customer_id == customer_id,
        LoyaltyEntry.kind == "accrual",
    ).order_by(Order.id).with_for_update(of=Order).all()


def checkout(db, tenant_id, user_id, body, key):
    """Own the transaction, idempotency and branch ledger serialization together."""
    try:
        branch_id = service._lock(db, tenant_id)
        digest, replay = service._claim(db, tenant_id, key, "reward-checkout", body)
        if replay:
            return replay.response_status, replay.response_body
        if body.order.customer_id is None:
            raise bad_request("Selecciona el cliente de esta recompensa antes de cobrar")
        if body.order.discount_amount:
            raise bad_request("La recompensa no se combina con otro descuento")
        customer_id = body.order.customer_id
        service._customer(db, tenant_id, customer_id, active=True)
        reward = available(db, tenant_id)
        if reward is None or reward.id != body.reward_id or reward.version != body.reward_version:
            raise conflict("La recompensa cambió o no está disponible. Revisa antes de cobrar")
        _lock_sources(db, tenant_id, customer_id)
        if service._pending_reversal_query(db, tenant_id, customer_id).first() is not None:
            raise conflict("Procesa primero las devoluciones o anulaciones pendientes de lealtad")
        balance = service._balance(db, tenant_id, customer_id)
        if body.expected_balance != balance:
            raise conflict("El saldo cambió. Actualiza antes de confirmar el canje")
        if balance < reward.points_cost:
            raise conflict("Puntos insuficientes para esta recompensa")
        priced_body = body.order.model_copy(update={"discount_amount": reward.discount_amount})
        _, result = orders.create_order(
            db,
            tenant_id=tenant_id,
            user_id=user_id,
            body=priced_body,
            idempotency_key=key,
            external_transaction=True,
        )
        sale_id = UUID(result["id"])
        debit = LoyaltyEntry(
            tenant_id=tenant_id,
            branch_id=branch_id,
            customer_id=customer_id,
            kind="redemption",
            source_id=sale_id,
            points=-reward.points_cost,
            benefit=reward.title,
            recorded_by_user_id=user_id,
        )
        db.add(debit)
        db.flush()
        redemption = LoyaltyRewardRedemption(
            tenant_id=tenant_id,
            branch_id=branch_id,
            customer_id=customer_id,
            sale_order_id=sale_id,
            reward_revision_id=reward.id,
            ledger_entry_id=debit.id,
            title=reward.title,
            points_cost=reward.points_cost,
            discount_amount=reward.discount_amount,
            created_by_user_id=user_id,
        )
        db.add(redemption)
        db.flush()
        result["loyalty_reward"] = order_reward(db, tenant_id, sale_id)
        audit.log(
            db,
            tenant_id=tenant_id,
            user_id=user_id,
            action="loyalty.reward.checkout",
            resource_type=redemption.__tablename__,
            resource_id=redemption.id,
            changes={
                "order_id": str(sale_id),
                "reward_revision_id": str(reward.id),
                "points_cost": reward.points_cost,
                "discount_amount": str(reward.discount_amount),
            },
        )
        idempotency.store(
            db,
            tenant_id=tenant_id,
            key=key,
            request_hash=digest,
            response_status=201,
            response_body=result,
        )
        db.commit()
        return 201, result
    except Exception:
        db.rollback()
        raise


def order_reward(db, tenant_id, order_id):
    row = (
        db.query(LoyaltyRewardRedemption)
        .filter_by(
            tenant_id=tenant_id,
            branch_id=active_branch_id(db, tenant_id),
            sale_order_id=order_id,
        )
        .first()
    )
    return (
        None
        if row is None
        else {
            "id": str(row.reward_revision_id),
            "title": row.title,
            "points_cost": row.points_cost,
            "discount_amount": str(row.discount_amount),
        }
    )


def lock_reward_reversal(db, tenant_id, order_id):
    # Refunds acquire source-order then product locks. For reward sales, acquire
    # the loyalty lock before either so checkout/process/refund/void never invert
    # branch -> order -> product lock order. Ordinary sales keep their old path.
    if order_reward(db, tenant_id, order_id) is not None:
        service._lock(db, tenant_id)


def return_reward(db, tenant_id, user_id, order_id, *, void=False):
    """Caller holds branch + source-order locks and owns the refund/void transaction."""
    branch_id = active_branch_id(db, tenant_id)
    redemption = (
        db.query(LoyaltyRewardRedemption)
        .filter_by(
            tenant_id=tenant_id,
            branch_id=branch_id,
            sale_order_id=order_id,
        )
        .first()
    )
    if (
        redemption is None
        or db.query(LoyaltyEntry.id)
        .filter_by(
            tenant_id=tenant_id,
            branch_id=branch_id,
            kind="reward_return",
            source_id=order_id,
        )
        .first()
    ):
        return
    if not void:
        quantities = (
            db.query(OrderItem.id, OrderItem.quantity)
            .filter_by(
                tenant_id=tenant_id,
                order_id=order_id,
            )
            .all()
        )
        returned = dict(
            db.query(RefundItem.order_item_id, func.sum(RefundItem.quantity))
            .join(
                Refund,
                (Refund.id == RefundItem.refund_id) & (Refund.tenant_id == RefundItem.tenant_id),
            )
            .filter(
                Refund.tenant_id == tenant_id,
                Refund.branch_id == branch_id,
                Refund.order_id == order_id,
            )
            .group_by(RefundItem.order_item_id)
            .all()
        )
        if not quantities or any(returned.get(item.id, 0) < item.quantity for item in quantities):
            return
    row = LoyaltyEntry(
        tenant_id=tenant_id,
        branch_id=branch_id,
        customer_id=redemption.customer_id,
        sale_order_id=order_id,
        kind="reward_return",
        source_id=order_id,
        points=redemption.points_cost,
        benefit=redemption.title,
        recorded_by_user_id=user_id,
    )
    db.add(row)
    db.flush()
    audit.log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="loyalty.reward.return",
        resource_type=row.__tablename__,
        resource_id=row.id,
        changes={
            "order_id": str(order_id),
            "points": row.points,
            "reason": "void" if void else "full_refund",
        },
    )
