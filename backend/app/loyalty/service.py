"""Internal-only points, derived from immutable source records under branch serialization."""

import hashlib
from decimal import ROUND_FLOOR, Decimal
from uuid import uuid4

from sqlalchemy import exists, func, or_, text
from sqlalchemy.orm import aliased

from app.audit import service as audit
from app.auth.models import Membership, User
from app.billing.access import get_billing_access_status
from app.branches.scope import active_branch_id
from app.customers.models import Customer
from app.idempotency import service as idempotency
from app.loyalty.models import LoyaltyEntry, LoyaltyPolicyRevision
from app.loyalty.schemas import LoyaltyEntryResponse, LoyaltyPolicyResponse
from app.orders.models import Order, Refund
from app.shared.exceptions import bad_request, conflict, not_found
from app.tenants.models import Tenant


def _lock(db, tenant_id):
    branch_id = active_branch_id(db, tenant_id)
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
        {"key": f"loyalty:{tenant_id}:{branch_id}"},
    )
    return branch_id


def _customer(db, tenant_id, customer_id, *, active=False):
    customer = db.query(Customer).filter_by(tenant_id=tenant_id, id=customer_id).first()
    if customer is None or (active and not customer.is_active):
        raise not_found("Cliente activo no encontrado" if active else "Cliente no encontrado")
    return customer


def _latest(db, tenant_id):
    return (
        db.query(LoyaltyPolicyRevision)
        .filter_by(tenant_id=tenant_id, branch_id=active_branch_id(db, tenant_id))
        .order_by(LoyaltyPolicyRevision.version.desc())
        .first()
    )


def _policy_response(row):
    return (
        LoyaltyPolicyResponse(
            enabled=row.enabled,
            spend_amount=row.spend_amount,
            points_per_step=row.points_per_step,
            version=row.version,
        ).model_dump(mode="json")
        if row
        else {"enabled": False, "spend_amount": None, "points_per_step": None, "version": 0}
    )


def _claim(db, tenant_id, key, scope, body):
    if not key or len(key) > 200 or not key.strip():
        raise bad_request("Idempotency-Key debe contener de 1 a 200 caracteres")
    digest = hashlib.sha256(f"loyalty:{scope}:{body.model_dump_json()}".encode()).hexdigest()
    return digest, idempotency.claim(db, tenant_id=tenant_id, key=key, request_hash=digest)


def _finish(db, tenant_id, user_id, key, digest, row, result, action, status=200):
    audit.log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action=action,
        resource_type=row.__tablename__,
        resource_id=row.id,
        changes={"version": row.version}
        if isinstance(row, LoyaltyPolicyRevision)
        else {"points": row.points},
    )
    idempotency.store(
        db,
        tenant_id=tenant_id,
        key=key,
        request_hash=digest,
        response_status=status,
        response_body=result,
    )
    db.commit()
    return status, result


def save_policy(db, tenant_id, user_id, body, key):
    _lock(db, tenant_id)
    digest, replay = _claim(db, tenant_id, key, "policy", body)
    if replay:
        return replay.response_status, replay.response_body
    current = _latest(db, tenant_id)
    if body.expected_version != (current.version if current else 0):
        raise conflict("La política cambió; actualiza antes de guardar")
    row = LoyaltyPolicyRevision(
        tenant_id=tenant_id,
        branch_id=active_branch_id(db, tenant_id),
        version=body.expected_version + 1,
        enabled=body.enabled,
        spend_amount=body.spend_amount,
        points_per_step=body.points_per_step,
        authorized_by_user_id=user_id,
    )
    db.add(row)
    db.flush()
    return _finish(
        db, tenant_id, user_id, key, digest, row, _policy_response(row), "loyalty.policy"
    )


def _balance(db, tenant_id, customer_id):
    return int(
        db.query(func.coalesce(func.sum(LoyaltyEntry.points), 0))
        .filter_by(
            tenant_id=tenant_id, branch_id=active_branch_id(db, tenant_id), customer_id=customer_id
        )
        .scalar()
    )


def _pending_reversal_query(db, tenant_id, customer_id=None):
    branch_id = active_branch_id(db, tenant_id)
    adjustment = aliased(LoyaltyEntry)
    missing_refund = exists().where(
        Refund.tenant_id == tenant_id,
        Refund.branch_id == branch_id,
        Refund.order_id == Order.id,
        ~exists()
        .where(
            adjustment.tenant_id == tenant_id,
            adjustment.branch_id == branch_id,
            adjustment.kind == "refund",
            adjustment.source_id == Refund.id,
        )
        .correlate(Refund),
    )
    missing_void = (Order.status == "voided") & ~exists().where(
        adjustment.tenant_id == tenant_id,
        adjustment.branch_id == branch_id,
        adjustment.kind == "void",
        adjustment.source_id == Order.id,
    )
    query = (
        db.query(LoyaltyEntry)
        .join(
            Order,
            (Order.id == LoyaltyEntry.sale_order_id)
            & (Order.tenant_id == LoyaltyEntry.tenant_id)
            & (Order.branch_id == LoyaltyEntry.branch_id),
        )
        .filter(
            LoyaltyEntry.tenant_id == tenant_id,
            LoyaltyEntry.branch_id == branch_id,
            LoyaltyEntry.kind == "accrual",
            or_(missing_refund, missing_void),
        )
    )
    if customer_id is not None:
        query = query.filter(LoyaltyEntry.customer_id == customer_id)
    return query.order_by(LoyaltyEntry.created_at, LoyaltyEntry.id)


def account(db, tenant_id, customer_id, limit=100, offset=0):
    customer = _customer(db, tenant_id, customer_id)
    rows = (
        db.query(LoyaltyEntry)
        .filter_by(
            tenant_id=tenant_id, branch_id=active_branch_id(db, tenant_id), customer_id=customer_id
        )
        .order_by(LoyaltyEntry.created_at.desc(), LoyaltyEntry.id)
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    return {
        "customer_id": str(customer.id),
        "customer_name": customer.name,
        "balance": _balance(db, tenant_id, customer_id),
        "entries": [
            LoyaltyEntryResponse(
                **{k: getattr(row, k) for k in LoyaltyEntryResponse.model_fields}
            ).model_dump(mode="json")
            for row in rows[:limit]
        ],
        "has_more": len(rows) > limit,
        "adjustments_pending": _pending_reversal_query(db, tenant_id, customer_id).first()
        is not None,
    }


def overview(db, tenant_id, limit=100, offset=0):
    totals = (
        db.query(
            LoyaltyEntry.customer_id.label("customer_id"),
            func.sum(LoyaltyEntry.points).label("balance"),
        )
        .filter_by(tenant_id=tenant_id, branch_id=active_branch_id(db, tenant_id))
        .group_by(LoyaltyEntry.customer_id)
        .subquery()
    )
    rows = (
        db.query(Customer, totals.c.balance)
        .join(totals, totals.c.customer_id == Customer.id)
        .filter(Customer.tenant_id == tenant_id)
        .order_by(Customer.name, Customer.id)
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    return {
        "policy": _policy_response(_latest(db, tenant_id)),
        "accounts": [
            {
                "customer_id": str(customer.id),
                "customer_name": customer.name,
                "balance": int(balance),
            }
            for customer, balance in rows[:limit]
        ],
        "accounts_has_more": len(rows) > limit,
    }


def _points(amount, revision):
    return (
        int(
            (max(Decimal("0"), amount) / revision.spend_amount).to_integral_value(
                rounding=ROUND_FLOOR
            )
        )
        * revision.points_per_step
    )


def _authorized(db, tenant_id, branch_id, revision):
    return (
        db.query(Membership)
        .join(User, User.id == Membership.user_id)
        .filter(
            Membership.tenant_id == tenant_id,
            Membership.user_id == revision.authorized_by_user_id,
            Membership.role == "owner",
            Membership.is_active.is_(True),
            User.is_active.is_(True),
            or_(Membership.allowed_branch_id.is_(None), Membership.allowed_branch_id == branch_id),
        )
        .first()
        is not None
    )


def _adjust_sale(db, tenant_id, accrual, *, limit=100):
    branch_id = active_branch_id(db, tenant_id)
    sale = (
        db.query(Order)
        .filter_by(tenant_id=tenant_id, branch_id=branch_id, id=accrual.sale_order_id)
        .with_for_update()
        .one()
    )
    revision = (
        db.query(LoyaltyPolicyRevision)
        .filter_by(tenant_id=tenant_id, branch_id=branch_id, id=accrual.policy_revision_id)
        .one()
    )
    # Window totals include previously materialized refunds while the outer query stays bounded.
    scope = (
        Refund.tenant_id == tenant_id,
        Refund.branch_id == branch_id,
        Refund.order_id == sale.id,
    )
    refunds = (
        db.query(
            Refund.id.label("id"),
            Refund.created_at.label("created_at"),
            Refund.refunded_amount.label("amount"),
            func.coalesce(
                func.sum(Refund.refunded_amount).over(
                    order_by=(Refund.created_at, Refund.id), rows=(None, -1)
                ),
                0,
            ).label("previous_amount"),
        )
        .filter(*scope)
        .subquery()
    )
    applied = aliased(LoyaltyEntry)
    missing = ~exists().where(
        applied.tenant_id == tenant_id,
        applied.branch_id == branch_id,
        applied.kind == "refund",
        applied.source_id == refunds.c.id,
    )
    pending = (
        db.query(refunds)
        .filter(missing)
        .order_by(refunds.c.created_at, refunds.c.id)
        .limit(limit)
        .all()
    )
    created = 0
    for refund in pending:
        previous = _points(sale.total_amount - refund.previous_amount, revision)
        current = _points(sale.total_amount - refund.previous_amount - refund.amount, revision)
        db.add(
            LoyaltyEntry(
                tenant_id=tenant_id,
                branch_id=branch_id,
                customer_id=accrual.customer_id,
                sale_order_id=sale.id,
                policy_revision_id=revision.id,
                kind="refund",
                source_id=refund.id,
                points=current - previous,
            )
        )
        created += 1
    db.flush()
    if (
        sale.status == "voided"
        and created < limit
        and not db.query(LoyaltyEntry.id)
        .filter_by(tenant_id=tenant_id, branch_id=branch_id, kind="void", source_id=sale.id)
        .first()
    ):
        # All missing refunds fit this pass because fewer than limit rows were returned.
        total_refunded = (
            db.query(func.coalesce(func.sum(Refund.refunded_amount), 0)).filter(*scope).scalar()
        )
        db.add(
            LoyaltyEntry(
                tenant_id=tenant_id,
                branch_id=branch_id,
                customer_id=accrual.customer_id,
                sale_order_id=sale.id,
                policy_revision_id=revision.id,
                kind="void",
                source_id=sale.id,
                points=-_points(sale.total_amount - total_refunded, revision),
            )
        )
        created += 1
    db.flush()
    return created


def process(db, tenant_id, *, limit=100):
    """Ordinary RLS session, explicit tenant+branch; no network. Caller owns commit."""
    branch_id = _lock(db, tenant_id)
    if (
        not db.query(Tenant.id).filter_by(id=tenant_id, is_active=True).first()
        or not get_billing_access_status(db, tenant_id=tenant_id).allowed
    ):
        return 0
    budget = min(max(limit, 1), 100)
    created = 0
    # Earned-balance reversals also apply to paused policies and inactive customers.
    for accrual in _pending_reversal_query(db, tenant_id).limit(budget).all():
        created += _adjust_sale(db, tenant_id, accrual, limit=budget - created)
        if created >= budget:
            return created
    revision = aliased(LoyaltyPolicyRevision)
    later = aliased(LoyaltyPolicyRevision)
    missing = ~exists().where(
        LoyaltyEntry.tenant_id == tenant_id,
        LoyaltyEntry.branch_id == branch_id,
        LoyaltyEntry.kind == "accrual",
        LoyaltyEntry.source_id == Order.id,
    )
    latest_for_sale = ~exists().where(
        later.tenant_id == tenant_id,
        later.branch_id == branch_id,
        later.version > revision.version,
        later.effective_at <= Order.created_at,
    ).correlate(Order, revision)
    rows = (
        db.query(Order, revision)
        .join(
            revision,
            (revision.tenant_id == Order.tenant_id)
            & (revision.branch_id == Order.branch_id)
            & (revision.effective_at <= Order.created_at),
        )
        .join(
            Customer, (Customer.id == Order.customer_id) & (Customer.tenant_id == Order.tenant_id)
        )
        .join(
            Membership,
            (Membership.tenant_id == revision.tenant_id)
            & (Membership.user_id == revision.authorized_by_user_id),
        )
        .join(User, User.id == Membership.user_id)
        .filter(
            Membership.role == "owner",
            Membership.is_active.is_(True),
            User.is_active.is_(True),
            or_(Membership.allowed_branch_id.is_(None), Membership.allowed_branch_id == branch_id),
            Order.tenant_id == tenant_id,
            Order.branch_id == branch_id,
            Order.status.in_(["completed", "voided"]),
            Customer.is_active.is_(True),
            revision.enabled.is_(True),
            missing,
            latest_for_sale,
        )
        .order_by(Order.created_at, Order.id)
        .limit(budget - created)
        .all()
    )
    for sale, policy in rows:
        if not _authorized(db, tenant_id, branch_id, policy):
            continue
        # Match refund/void service lock order; source changes cannot race the points snapshot.
        db.query(Order).filter_by(
            tenant_id=tenant_id, branch_id=branch_id, id=sale.id
        ).with_for_update().one()
        row = LoyaltyEntry(
            tenant_id=tenant_id,
            branch_id=branch_id,
            customer_id=sale.customer_id,
            sale_order_id=sale.id,
            policy_revision_id=policy.id,
            kind="accrual",
            source_id=sale.id,
            points=_points(sale.total_amount, policy),
        )
        db.add(row)
        db.flush()
        created += 1
        # Pending adjustments remain discoverable if this pass exhausted its bounded ledger budget.
        if created < budget:
            created += _adjust_sale(db, tenant_id, row, limit=budget - created)
        if created >= budget:
            break
    return created


def redeem(db, tenant_id, user_id, customer_id, body, key):
    _lock(db, tenant_id)
    digest, replay = _claim(db, tenant_id, key, f"redeem:{customer_id}", body)
    if replay:
        return replay.response_status, replay.response_body
    _customer(db, tenant_id, customer_id, active=True)
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
    if _pending_reversal_query(db, tenant_id, customer_id).first() is not None:
        raise conflict("Procesa primero las devoluciones o anulaciones pendientes de lealtad")
    balance = _balance(db, tenant_id, customer_id)
    if balance != body.expected_balance:
        raise conflict("El saldo cambió. Actualiza antes de confirmar el canje")
    if body.points > balance:
        raise conflict("Puntos insuficientes para este canje")
    row = LoyaltyEntry(
        tenant_id=tenant_id,
        branch_id=active_branch_id(db, tenant_id),
        customer_id=customer_id,
        kind="redemption",
        source_id=uuid4(),
        points=-body.points,
        benefit=body.benefit,
        recorded_by_user_id=user_id,
    )
    db.add(row)
    db.flush()
    return _finish(
        db,
        tenant_id,
        user_id,
        key,
        digest,
        row,
        account(db, tenant_id, customer_id),
        "loyalty.redeem",
        201,
    )
