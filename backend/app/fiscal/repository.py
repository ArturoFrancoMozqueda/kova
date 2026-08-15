from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.fiscal.models import (
    FiscalGlobalDraftBatch,
    FiscalGlobalDraftOrder,
    FiscalGlobalDraftSettings,
    OrderFiscalSnapshot,
    OrderItemFiscalSnapshot,
)
from app.orders.models import Order, OrderItem, Refund


def capture_baseline_snapshot(
    db: Session,
    *,
    tenant_id: UUID,
    order: Order,
    pricing_engine_version: str = "baseline-v1",
) -> OrderFiscalSnapshot:
    """Freeze the existing no-tax calculation without inferring fiscal rules."""
    existing = get_order_snapshot(db, tenant_id=tenant_id, order_id=order.id)
    if existing:
        return existing

    snapshot = OrderFiscalSnapshot(
        tenant_id=tenant_id,
        order_id=order.id,
        gross_amount=order.subtotal_amount,
        discount_total_amount=Decimal("0.00"),
        tax_total_amount=Decimal("0.00"),
        total_amount=order.total_amount,
        pricing_engine_version=pricing_engine_version,
        tax_catalog_version=None,
        currency="MXN",
        individual_fiscal_status="none",
    )
    db.add(snapshot)
    db.flush()
    items = (
        db.query(OrderItem)
        .filter(OrderItem.tenant_id == tenant_id, OrderItem.order_id == order.id)
        .order_by(OrderItem.id)
        .all()
    )
    line_sum = sum((item.line_total_amount for item in items), Decimal("0.00"))
    if line_sum != order.subtotal_amount or order.subtotal_amount != order.total_amount:
        raise ValueError("baseline fiscal snapshot does not reconcile with persisted order totals")
    for item in items:
        db.add(
            OrderItemFiscalSnapshot(
                tenant_id=tenant_id,
                order_id=order.id,
                order_item_id=item.id,
                product_id=item.product_id,
                product_name=item.product_name,
                quantity=item.quantity,
                unit_price_amount=item.unit_price_amount,
                gross_line_amount=item.line_total_amount,
                line_discount_amount=Decimal("0.00"),
                order_discount_allocated_amount=Decimal("0.00"),
                net_before_tax_amount=item.line_total_amount,
                tax_total_amount=Decimal("0.00"),
                line_total_amount=item.line_total_amount,
                tax_object_code_snapshot=None,
                product_service_code_snapshot=None,
                unit_code_snapshot=None,
            )
        )
    db.flush()
    return snapshot


def get_order_snapshot(
    db: Session, *, tenant_id: UUID, order_id: UUID
) -> OrderFiscalSnapshot | None:
    return (
        db.query(OrderFiscalSnapshot)
        .filter(
            OrderFiscalSnapshot.tenant_id == tenant_id,
            OrderFiscalSnapshot.order_id == order_id,
        )
        .first()
    )


def get_settings(db: Session, *, tenant_id: UUID) -> FiscalGlobalDraftSettings | None:
    return db.get(FiscalGlobalDraftSettings, tenant_id)


def upsert_settings(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    frequency: str,
    weekly_close_day: int,
    monthly_close_day: int,
    auto_close_enabled: bool,
) -> FiscalGlobalDraftSettings:
    settings = get_settings(db, tenant_id=tenant_id)
    if not settings:
        settings = FiscalGlobalDraftSettings(
            tenant_id=tenant_id,
            created_by_user_id=user_id,
        )
    settings.frequency = frequency
    settings.weekly_close_day = weekly_close_day
    settings.monthly_close_day = monthly_close_day
    settings.auto_close_enabled = auto_close_enabled
    settings.updated_by_user_id = user_id
    settings.updated_at = datetime.now(UTC)
    db.add(settings)
    db.flush()
    return settings


def acquire_tenant_close_lock(db: Session, *, tenant_id: UUID) -> None:
    db.execute(
        text(
            "SELECT pg_advisory_xact_lock(hashtextextended("
            "'fiscal_global_drafts:' || CAST(:tenant_id AS text), 0))"
        ),
        {"tenant_id": str(tenant_id)},
    )


def find_overlapping_batch(
    db: Session, *, tenant_id: UUID, period_start: date, period_end: date
) -> FiscalGlobalDraftBatch | None:
    return (
        db.query(FiscalGlobalDraftBatch)
        .filter(
            FiscalGlobalDraftBatch.tenant_id == tenant_id,
            FiscalGlobalDraftBatch.period_start <= period_end,
            FiscalGlobalDraftBatch.period_end >= period_start,
        )
        .with_for_update()
        .first()
    )


def eligible_order_snapshots(
    db: Session,
    *,
    tenant_id: UUID,
    start_utc: datetime,
    end_utc: datetime,
    lock: bool = False,
) -> list[OrderFiscalSnapshot]:
    sale_time = func.coalesce(Order.occurred_at, Order.created_at)
    already_batched = (
        db.query(FiscalGlobalDraftOrder.id)
        .filter(
            FiscalGlobalDraftOrder.tenant_id == tenant_id,
            FiscalGlobalDraftOrder.order_id == Order.id,
        )
        .exists()
    )
    query = (
        db.query(OrderFiscalSnapshot)
        .join(
            Order,
            (Order.tenant_id == OrderFiscalSnapshot.tenant_id)
            & (Order.id == OrderFiscalSnapshot.order_id),
        )
        .filter(
            OrderFiscalSnapshot.tenant_id == tenant_id,
            OrderFiscalSnapshot.individual_fiscal_status == "none",
            Order.status == "completed",
            sale_time >= start_utc,
            sale_time < end_utc,
            ~already_batched,
        )
        .order_by(sale_time, Order.id)
    )
    if lock:
        query = query.with_for_update(of=OrderFiscalSnapshot)
    return query.all()


def individually_confirmed_count(
    db: Session,
    *,
    tenant_id: UUID,
    start_utc: datetime,
    end_utc: datetime,
) -> int:
    sale_time = func.coalesce(Order.occurred_at, Order.created_at)
    return (
        db.query(func.count(OrderFiscalSnapshot.id))
        .join(
            Order,
            (Order.tenant_id == OrderFiscalSnapshot.tenant_id)
            & (Order.id == OrderFiscalSnapshot.order_id),
        )
        .filter(
            OrderFiscalSnapshot.tenant_id == tenant_id,
            OrderFiscalSnapshot.individual_fiscal_status == "confirmed",
            Order.status == "completed",
            sale_time >= start_utc,
            sale_time < end_utc,
        )
        .scalar()
        or 0
    )


def create_batch(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID | None,
    frequency: str,
    period_start: date,
    period_end: date,
    snapshots: list[OrderFiscalSnapshot],
    refund_totals: dict[UUID, Decimal],
    excluded_individually_confirmed_count: int,
) -> FiscalGlobalDraftBatch:
    total_amount = sum((row.total_amount for row in snapshots), Decimal("0.00"))
    refund_total_amount = sum(refund_totals.values(), Decimal("0.00"))
    batch = FiscalGlobalDraftBatch(
        tenant_id=tenant_id,
        frequency=frequency,
        period_start=period_start,
        period_end=period_end,
        timezone="America/Mexico_City",
        status="closed",
        document_kind="operational_draft",
        fiscal_status="not_issued",
        gross_amount=sum((row.gross_amount for row in snapshots), Decimal("0.00")),
        discount_total_amount=sum(
            (row.discount_total_amount for row in snapshots), Decimal("0.00")
        ),
        tax_total_amount=sum((row.tax_total_amount for row in snapshots), Decimal("0.00")),
        total_amount=total_amount,
        refund_total_amount=refund_total_amount,
        net_total_amount=total_amount - refund_total_amount,
        order_count=len(snapshots),
        excluded_individually_confirmed_count=excluded_individually_confirmed_count,
        created_by_user_id=user_id,
    )
    db.add(batch)
    db.flush()
    for snapshot in snapshots:
        db.add(
            FiscalGlobalDraftOrder(
                tenant_id=tenant_id,
                batch_id=batch.id,
                order_id=snapshot.order_id,
                refund_total_amount=refund_totals.get(snapshot.order_id, Decimal("0.00")),
                net_total_amount=(
                    snapshot.total_amount - refund_totals.get(snapshot.order_id, Decimal("0.00"))
                ),
            )
        )
    db.flush()
    return batch


def batch_order_ids(db: Session, *, tenant_id: UUID, batch_id: UUID) -> list[UUID]:
    rows = (
        db.query(FiscalGlobalDraftOrder.order_id)
        .filter(
            FiscalGlobalDraftOrder.tenant_id == tenant_id,
            FiscalGlobalDraftOrder.batch_id == batch_id,
        )
        .order_by(FiscalGlobalDraftOrder.order_id)
        .all()
    )
    return [row[0] for row in rows]


def get_batch(db: Session, *, tenant_id: UUID, batch_id: UUID) -> FiscalGlobalDraftBatch | None:
    return (
        db.query(FiscalGlobalDraftBatch)
        .filter(
            FiscalGlobalDraftBatch.tenant_id == tenant_id,
            FiscalGlobalDraftBatch.id == batch_id,
        )
        .first()
    )


def list_batches(
    db: Session, *, tenant_id: UUID, limit: int, offset: int
) -> list[FiscalGlobalDraftBatch]:
    return (
        db.query(FiscalGlobalDraftBatch)
        .filter(FiscalGlobalDraftBatch.tenant_id == tenant_id)
        .order_by(FiscalGlobalDraftBatch.period_end.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )


def count_batches(db: Session, *, tenant_id: UUID) -> int:
    return (
        db.query(FiscalGlobalDraftBatch)
        .filter(FiscalGlobalDraftBatch.tenant_id == tenant_id)
        .count()
    )


def auto_close_candidates(db: Session, *, limit: int) -> list[FiscalGlobalDraftSettings]:
    from app.tenants.models import Tenant

    return (
        db.query(FiscalGlobalDraftSettings)
        .join(Tenant, Tenant.id == FiscalGlobalDraftSettings.tenant_id)
        .filter(
            FiscalGlobalDraftSettings.auto_close_enabled.is_(True),
            Tenant.is_active.is_(True),
            Tenant.feature_overrides["fiscal_global_drafts"].as_boolean().is_(True),
        )
        .order_by(
            func.coalesce(
                FiscalGlobalDraftSettings.auto_processed_through,
                func.date(FiscalGlobalDraftSettings.created_at),
            ),
            FiscalGlobalDraftSettings.tenant_id,
        )
        .limit(limit)
        .all()
    )


def latest_batch_end(db: Session, *, tenant_id: UUID) -> date | None:
    return (
        db.query(func.max(FiscalGlobalDraftBatch.period_end))
        .filter(FiscalGlobalDraftBatch.tenant_id == tenant_id)
        .scalar()
    )


def refund_totals_by_order(
    db: Session, *, tenant_id: UUID, order_ids: list[UUID]
) -> dict[UUID, Decimal]:
    if not order_ids:
        return {}
    rows = (
        db.query(Refund.order_id, func.sum(Refund.refunded_amount))
        .filter(Refund.tenant_id == tenant_id, Refund.order_id.in_(order_ids))
        .group_by(Refund.order_id)
        .all()
    )
    return {order_id: Decimal(amount or 0) for order_id, amount in rows}


def mark_auto_processed(
    db: Session, *, settings: FiscalGlobalDraftSettings, period_end: date
) -> None:
    settings.auto_processed_through = period_end
    settings.updated_at = datetime.now(UTC)
    db.add(settings)
    db.flush()
