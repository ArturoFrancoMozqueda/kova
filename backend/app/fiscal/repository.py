from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Date, cast, func, text
from sqlalchemy.orm import Session

from app.fiscal.models import (
    FiscalGlobalDraftAdjustment,
    FiscalGlobalDraftBatch,
    FiscalGlobalDraftOrder,
    FiscalGlobalDraftSettings,
    FiscalIndividualInvoiceEvent,
    OrderFiscalSnapshot,
    OrderItemFiscalSnapshot,
)
from app.orders.models import Order, OrderItem, Payment, Refund, Void


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
        tax_calculation_status="not_calculated",
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
                tax_calculation_status="not_calculated",
            )
        )
    db.flush()
    return snapshot


def get_order_snapshot(
    db: Session, *, tenant_id: UUID, order_id: UUID, lock: bool = False
) -> OrderFiscalSnapshot | None:
    query = (
        db.query(OrderFiscalSnapshot)
        .filter(
            OrderFiscalSnapshot.tenant_id == tenant_id,
            OrderFiscalSnapshot.order_id == order_id,
        )
    )
    if lock:
        query = query.with_for_update()
    return query.first()


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
    latest_status = (
        db.query(FiscalIndividualInvoiceEvent.status)
        .filter(
            FiscalIndividualInvoiceEvent.tenant_id == tenant_id,
            FiscalIndividualInvoiceEvent.order_id == Order.id,
        )
        .order_by(
            FiscalIndividualInvoiceEvent.created_at.desc(),
            FiscalIndividualInvoiceEvent.id.desc(),
        )
        .limit(1)
        .scalar_subquery()
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
            func.coalesce(latest_status, OrderFiscalSnapshot.individual_fiscal_status)
            != "confirmed",
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
    latest_status = (
        db.query(FiscalIndividualInvoiceEvent.status)
        .filter(
            FiscalIndividualInvoiceEvent.tenant_id == tenant_id,
            FiscalIndividualInvoiceEvent.order_id == Order.id,
        )
        .order_by(
            FiscalIndividualInvoiceEvent.created_at.desc(),
            FiscalIndividualInvoiceEvent.id.desc(),
        )
        .limit(1)
        .scalar_subquery()
    )
    return (
        db.query(func.count(OrderFiscalSnapshot.id))
        .join(
            Order,
            (Order.tenant_id == OrderFiscalSnapshot.tenant_id)
            & (Order.id == OrderFiscalSnapshot.order_id),
        )
        .filter(
            OrderFiscalSnapshot.tenant_id == tenant_id,
            func.coalesce(latest_status, OrderFiscalSnapshot.individual_fiscal_status)
            == "confirmed",
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
    business_name: str,
    adjustments: list[dict],
) -> FiscalGlobalDraftBatch:
    total_amount = sum((row.total_amount for row in snapshots), Decimal("0.00"))
    refund_total_amount = sum(refund_totals.values(), Decimal("0.00"))
    adjustment_total = sum(
        (
            -row["amount"]
            if row["adjustment_type"]
            in {"late_refund", "late_exclusion", "late_void"}
            else row["amount"]
            for row in adjustments
        ),
        Decimal("0.00"),
    )
    net_total = total_amount - refund_total_amount
    batch = FiscalGlobalDraftBatch(
        tenant_id=tenant_id,
        frequency=frequency,
        period_start=period_start,
        period_end=period_end,
        timezone="America/Mexico_City",
        status="closed",
        document_kind="operational_draft",
        fiscal_status="not_issued",
        business_name_snapshot=business_name,
        package_schema_version="accountant-package-v2",
        tax_calculation_status="not_calculated",
        gross_amount=sum((row.gross_amount for row in snapshots), Decimal("0.00")),
        discount_total_amount=sum(
            (row.discount_total_amount for row in snapshots), Decimal("0.00")
        ),
        tax_total_amount=sum((row.tax_total_amount for row in snapshots), Decimal("0.00")),
        total_amount=total_amount,
        refund_total_amount=refund_total_amount,
        net_total_amount=net_total,
        adjustment_total_amount=adjustment_total,
        adjusted_net_amount=net_total + adjustment_total,
        adjustment_count=len(adjustments),
        data_quality_warnings=["TAXES_NOT_CALCULATED"],
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
    for row in adjustments:
        db.add(
            FiscalGlobalDraftAdjustment(
                tenant_id=tenant_id,
                batch_id=batch.id,
                original_batch_id=row["original_batch_id"],
                order_id=row["order_id"],
                source_refund_id=row.get("source_refund_id"),
                source_event_id=row.get("source_event_id"),
                adjustment_type=row["adjustment_type"],
                amount=row["amount"],
                occurred_at=row["occurred_at"],
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


def accountant_report_rows(
    db: Session, *, tenant_id: UUID, batch_id: UUID
) -> list[tuple[FiscalGlobalDraftOrder, OrderFiscalSnapshot]]:
    """Return only immutable batch assignments and sale snapshots."""
    return (
        db.query(FiscalGlobalDraftOrder, OrderFiscalSnapshot)
        .join(
            OrderFiscalSnapshot,
            (OrderFiscalSnapshot.tenant_id == FiscalGlobalDraftOrder.tenant_id)
            & (OrderFiscalSnapshot.order_id == FiscalGlobalDraftOrder.order_id),
        )
        .filter(
            FiscalGlobalDraftOrder.tenant_id == tenant_id,
            FiscalGlobalDraftOrder.batch_id == batch_id,
        )
        .order_by(FiscalGlobalDraftOrder.order_id)
        .all()
    )


def accountant_operation_rows(db: Session, *, tenant_id: UUID, batch_id: UUID):
    return (
        db.query(FiscalGlobalDraftOrder, OrderFiscalSnapshot, Order)
        .join(
            OrderFiscalSnapshot,
            (OrderFiscalSnapshot.tenant_id == FiscalGlobalDraftOrder.tenant_id)
            & (OrderFiscalSnapshot.order_id == FiscalGlobalDraftOrder.order_id),
        )
        .join(
            Order,
            (Order.tenant_id == FiscalGlobalDraftOrder.tenant_id)
            & (Order.id == FiscalGlobalDraftOrder.order_id),
        )
        .filter(
            FiscalGlobalDraftOrder.tenant_id == tenant_id,
            FiscalGlobalDraftOrder.batch_id == batch_id,
        )
        .order_by(func.coalesce(Order.occurred_at, Order.created_at), Order.id)
        .all()
    )


def accountant_item_rows(db: Session, *, tenant_id: UUID, batch_id: UUID):
    return (
        db.query(OrderItemFiscalSnapshot)
        .join(
            FiscalGlobalDraftOrder,
            (FiscalGlobalDraftOrder.tenant_id == OrderItemFiscalSnapshot.tenant_id)
            & (FiscalGlobalDraftOrder.order_id == OrderItemFiscalSnapshot.order_id),
        )
        .filter(
            FiscalGlobalDraftOrder.tenant_id == tenant_id,
            FiscalGlobalDraftOrder.batch_id == batch_id,
        )
        .order_by(OrderItemFiscalSnapshot.order_id, OrderItemFiscalSnapshot.order_item_id)
        .all()
    )


def accountant_adjustment_rows(
    db: Session, *, tenant_id: UUID, batch_id: UUID
) -> list[FiscalGlobalDraftAdjustment]:
    return (
        db.query(FiscalGlobalDraftAdjustment)
        .filter(
            FiscalGlobalDraftAdjustment.tenant_id == tenant_id,
            FiscalGlobalDraftAdjustment.batch_id == batch_id,
        )
        .order_by(
            FiscalGlobalDraftAdjustment.occurred_at,
            FiscalGlobalDraftAdjustment.id,
        )
        .all()
    )


def payment_methods_by_order(
    db: Session, *, tenant_id: UUID, order_ids: list[UUID]
) -> dict[UUID, list[str]]:
    if not order_ids:
        return {}
    rows = (
        db.query(Payment.order_id, Payment.method)
        .filter(Payment.tenant_id == tenant_id, Payment.order_id.in_(order_ids))
        .order_by(Payment.order_id, Payment.method)
        .all()
    )
    result: dict[UUID, list[str]] = {}
    for order_id, method in rows:
        result.setdefault(order_id, []).append(method)
    return result


def auto_close_candidates(db: Session, *, limit: int) -> list[FiscalGlobalDraftSettings]:
    from app.tenants.models import Tenant

    return (
        db.query(FiscalGlobalDraftSettings)
        .join(Tenant, Tenant.id == FiscalGlobalDraftSettings.tenant_id)
        .filter(
            FiscalGlobalDraftSettings.auto_close_enabled.is_(True),
            Tenant.is_active.is_(True),
            # Default-on: absent/malformed values remain enabled. Only the
            # exact JSON boolean false is a tenant-level opt-out.
            ~Tenant.feature_overrides.contains({"fiscal_global_drafts": False}),
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
    db: Session, *, tenant_id: UUID, order_ids: list[UUID], before: datetime
) -> dict[UUID, Decimal]:
    if not order_ids:
        return {}
    rows = (
        db.query(Refund.order_id, func.sum(Refund.refunded_amount))
        .filter(
            Refund.tenant_id == tenant_id,
            Refund.order_id.in_(order_ids),
            Refund.created_at < before,
        )
        .group_by(Refund.order_id)
        .all()
    )
    return {order_id: Decimal(amount or 0) for order_id, amount in rows}


def latest_individual_invoice_event(
    db: Session, *, tenant_id: UUID, order_id: UUID
) -> FiscalIndividualInvoiceEvent | None:
    return (
        db.query(FiscalIndividualInvoiceEvent)
        .filter(
            FiscalIndividualInvoiceEvent.tenant_id == tenant_id,
            FiscalIndividualInvoiceEvent.order_id == order_id,
        )
        .order_by(
            FiscalIndividualInvoiceEvent.created_at.desc(),
            FiscalIndividualInvoiceEvent.id.desc(),
        )
        .first()
    )


def create_individual_invoice_event(
    db: Session,
    *,
    tenant_id: UUID,
    order_id: UUID,
    user_id: UUID,
    status: str,
    external_reference: str | None,
    issued_at: datetime | None,
) -> FiscalIndividualInvoiceEvent:
    event = FiscalIndividualInvoiceEvent(
        tenant_id=tenant_id,
        order_id=order_id,
        status=status,
        external_reference=external_reference,
        issued_at=issued_at,
        created_by_user_id=user_id,
    )
    db.add(event)
    db.flush()
    return event


def due_adjustments(
    db: Session,
    *,
    tenant_id: UUID,
    start_utc: datetime,
    end_utc: datetime,
) -> list[dict]:
    sale_time = func.coalesce(Order.occurred_at, Order.created_at)
    sale_local_date = cast(func.timezone("America/Mexico_City", sale_time), Date)

    already_batched = (
        db.query(FiscalGlobalDraftOrder.id)
        .filter(
            FiscalGlobalDraftOrder.tenant_id == tenant_id,
            FiscalGlobalDraftOrder.order_id == Order.id,
        )
        .exists()
    )
    already_late_included = (
        db.query(FiscalGlobalDraftAdjustment.id)
        .filter(
            FiscalGlobalDraftAdjustment.tenant_id == tenant_id,
            FiscalGlobalDraftAdjustment.order_id == Order.id,
            FiscalGlobalDraftAdjustment.adjustment_type == "late_inclusion",
            FiscalGlobalDraftAdjustment.source_refund_id.is_(None),
            FiscalGlobalDraftAdjustment.source_event_id.is_(None),
        )
        .exists()
    )
    late_orders = (
        db.query(Order, OrderFiscalSnapshot, FiscalGlobalDraftBatch.id)
        .join(
            OrderFiscalSnapshot,
            (OrderFiscalSnapshot.tenant_id == Order.tenant_id)
            & (OrderFiscalSnapshot.order_id == Order.id),
        )
        .join(
            FiscalGlobalDraftBatch,
            (FiscalGlobalDraftBatch.tenant_id == Order.tenant_id)
            & (FiscalGlobalDraftBatch.period_start <= sale_local_date)
            & (FiscalGlobalDraftBatch.period_end >= sale_local_date),
        )
        .filter(
            Order.tenant_id == tenant_id,
            Order.created_at >= start_utc,
            Order.created_at < end_utc,
            sale_time < start_utc,
            ~already_batched,
            ~already_late_included,
        )
        .order_by(Order.created_at, Order.id)
        .all()
    )

    already_refund_adjusted = (
        db.query(FiscalGlobalDraftAdjustment.id)
        .filter(
            FiscalGlobalDraftAdjustment.tenant_id == tenant_id,
            FiscalGlobalDraftAdjustment.source_refund_id == Refund.id,
        )
        .exists()
    )
    late_refunds = (
        db.query(Refund, OrderFiscalSnapshot, FiscalGlobalDraftBatch.id)
        .join(
            Order,
            (Order.tenant_id == Refund.tenant_id) & (Order.id == Refund.order_id),
        )
        .join(
            OrderFiscalSnapshot,
            (OrderFiscalSnapshot.tenant_id == Refund.tenant_id)
            & (OrderFiscalSnapshot.order_id == Refund.order_id),
        )
        .join(
            FiscalGlobalDraftBatch,
            (FiscalGlobalDraftBatch.tenant_id == Refund.tenant_id)
            & (FiscalGlobalDraftBatch.period_start <= sale_local_date)
            & (FiscalGlobalDraftBatch.period_end >= sale_local_date),
        )
        .filter(
            Refund.tenant_id == tenant_id,
            Refund.created_at >= start_utc,
            Refund.created_at < end_utc,
            sale_time < start_utc,
            ~already_refund_adjusted,
        )
        .order_by(Refund.created_at, Refund.id)
        .all()
    )

    already_event_adjusted = (
        db.query(FiscalGlobalDraftAdjustment.id)
        .filter(
            FiscalGlobalDraftAdjustment.tenant_id == tenant_id,
            FiscalGlobalDraftAdjustment.source_event_id == FiscalIndividualInvoiceEvent.id,
        )
        .exists()
    )
    sale_time = func.coalesce(Order.occurred_at, Order.created_at)
    sale_local_date = cast(func.timezone("America/Mexico_City", sale_time), Date)
    corrected_events = (
        db.query(
            FiscalIndividualInvoiceEvent,
            OrderFiscalSnapshot,
            FiscalGlobalDraftBatch.id,
        )
        .join(
            OrderFiscalSnapshot,
            (OrderFiscalSnapshot.tenant_id == FiscalIndividualInvoiceEvent.tenant_id)
            & (OrderFiscalSnapshot.order_id == FiscalIndividualInvoiceEvent.order_id),
        )
        .join(
            Order,
            (Order.tenant_id == FiscalIndividualInvoiceEvent.tenant_id)
            & (Order.id == FiscalIndividualInvoiceEvent.order_id),
        )
        .join(
            FiscalGlobalDraftBatch,
            (FiscalGlobalDraftBatch.tenant_id == FiscalIndividualInvoiceEvent.tenant_id)
            & (FiscalGlobalDraftBatch.period_start <= sale_local_date)
            & (FiscalGlobalDraftBatch.period_end >= sale_local_date),
        )
        .filter(
            FiscalIndividualInvoiceEvent.tenant_id == tenant_id,
            FiscalIndividualInvoiceEvent.created_at >= start_utc,
            FiscalIndividualInvoiceEvent.created_at < end_utc,
            sale_time < start_utc,
            ~already_event_adjusted,
        )
        .order_by(FiscalIndividualInvoiceEvent.created_at, FiscalIndividualInvoiceEvent.id)
        .all()
    )

    already_void_adjusted = (
        db.query(FiscalGlobalDraftAdjustment.id)
        .filter(
            FiscalGlobalDraftAdjustment.tenant_id == tenant_id,
            FiscalGlobalDraftAdjustment.order_id == Void.order_id,
            FiscalGlobalDraftAdjustment.adjustment_type == "late_void",
            FiscalGlobalDraftAdjustment.source_refund_id.is_(None),
            FiscalGlobalDraftAdjustment.source_event_id.is_(None),
        )
        .exists()
    )
    late_voids = (
        db.query(Void, OrderFiscalSnapshot, FiscalGlobalDraftBatch.id)
        .join(
            Order,
            (Order.tenant_id == Void.tenant_id) & (Order.id == Void.order_id),
        )
        .join(
            OrderFiscalSnapshot,
            (OrderFiscalSnapshot.tenant_id == Void.tenant_id)
            & (OrderFiscalSnapshot.order_id == Void.order_id),
        )
        .join(
            FiscalGlobalDraftBatch,
            (FiscalGlobalDraftBatch.tenant_id == Void.tenant_id)
            & (FiscalGlobalDraftBatch.period_start <= sale_local_date)
            & (FiscalGlobalDraftBatch.period_end >= sale_local_date),
        )
        .filter(
            Void.tenant_id == tenant_id,
            Void.created_at >= start_utc,
            Void.created_at < end_utc,
            sale_time < start_utc,
            ~already_void_adjusted,
        )
        .order_by(Void.created_at, Void.id)
        .all()
    )

    pending: list[dict] = []
    for order, snapshot, original_batch_id in late_orders:
        pending.append(
            {
                "kind": "late_order",
                "order_id": order.id,
                "snapshot": snapshot,
                "original_batch_id": original_batch_id,
                "occurred_at": order.created_at,
                "source_id": order.id,
            }
        )
    for refund, snapshot, original_batch_id in late_refunds:
        pending.append(
            {
                "kind": "refund",
                "order_id": refund.order_id,
                "snapshot": snapshot,
                "original_batch_id": original_batch_id,
                "occurred_at": refund.created_at,
                "source_id": refund.id,
                "source_refund_id": refund.id,
                "refund_amount": Decimal(refund.refunded_amount),
            }
        )
    for event, snapshot, original_batch_id in corrected_events:
        pending.append(
            {
                "kind": event.status,
                "order_id": event.order_id,
                "snapshot": snapshot,
                "original_batch_id": original_batch_id,
                "occurred_at": event.created_at,
                "source_id": event.id,
                "source_event_id": event.id,
            }
        )
    for void, snapshot, original_batch_id in late_voids:
        pending.append(
            {
                "kind": "void",
                "order_id": void.order_id,
                "snapshot": snapshot,
                "original_batch_id": original_batch_id,
                "occurred_at": void.created_at,
                "source_id": void.id,
            }
        )
    pending.sort(key=lambda row: (row["occurred_at"], row["source_id"]))

    order_ids = {row["order_id"] for row in pending}
    states: dict[UUID, dict[str, Decimal | bool]] = {
        order_id: {"balance": Decimal("0.00"), "included": False, "voided": False}
        for order_id in order_ids
    }
    if order_ids:
        assignments = (
            db.query(FiscalGlobalDraftOrder)
            .filter(
                FiscalGlobalDraftOrder.tenant_id == tenant_id,
                FiscalGlobalDraftOrder.order_id.in_(order_ids),
            )
            .all()
        )
        for assignment in assignments:
            state = states[assignment.order_id]
            state["balance"] = Decimal(state["balance"]) + Decimal(
                assignment.net_total_amount
            )
            state["included"] = True
        prior_adjustments = (
            db.query(FiscalGlobalDraftAdjustment)
            .filter(
                FiscalGlobalDraftAdjustment.tenant_id == tenant_id,
                FiscalGlobalDraftAdjustment.order_id.in_(order_ids),
            )
            .order_by(
                FiscalGlobalDraftAdjustment.occurred_at,
                FiscalGlobalDraftAdjustment.id,
            )
            .all()
        )
        for adjustment in prior_adjustments:
            state = states[adjustment.order_id]
            amount = Decimal(adjustment.amount)
            if adjustment.adjustment_type == "late_inclusion":
                state["balance"] = Decimal(state["balance"]) + amount
                state["included"] = True
            else:
                state["balance"] = Decimal(state["balance"]) - amount
                if adjustment.adjustment_type in {"late_exclusion", "late_void"}:
                    state["included"] = False
                if adjustment.adjustment_type == "late_void":
                    state["voided"] = True

    def net_at(row: dict) -> Decimal:
        refunded = (
            db.query(func.coalesce(func.sum(Refund.refunded_amount), 0))
            .filter(
                Refund.tenant_id == tenant_id,
                Refund.order_id == row["order_id"],
                Refund.created_at <= row["occurred_at"],
            )
            .scalar()
        )
        return max(
            Decimal("0.00"),
            Decimal(row["snapshot"].total_amount) - Decimal(refunded or 0),
        )

    result: list[dict] = []
    for row in pending:
        state = states[row["order_id"]]
        balance = max(Decimal("0.00"), Decimal(state["balance"]))
        kind = row["kind"]
        if kind == "late_order":
            adjustment_type = "late_inclusion"
            amount = net_at(row) if not state["included"] else Decimal("0.00")
            state["balance"] = balance + amount
            state["included"] = True
        elif kind == "refund":
            adjustment_type = "late_refund"
            amount = (
                min(balance, Decimal(row["refund_amount"]))
                if state["included"]
                else Decimal("0.00")
            )
            state["balance"] = balance - amount
        elif kind == "confirmed":
            adjustment_type = "late_exclusion"
            amount = balance if state["included"] else Decimal("0.00")
            state["balance"] = balance - amount
            state["included"] = False
        elif kind == "reopened":
            adjustment_type = "late_inclusion"
            amount = (
                net_at(row)
                if not state["included"] and not state["voided"]
                else Decimal("0.00")
            )
            state["balance"] = balance + amount
            if not state["voided"]:
                state["included"] = True
        else:
            adjustment_type = "late_void"
            amount = balance if state["included"] else Decimal("0.00")
            state["balance"] = balance - amount
            state["included"] = False
            state["voided"] = True
        result.append(
            {
                "adjustment_type": adjustment_type,
                "order_id": row["order_id"],
                "original_batch_id": row["original_batch_id"],
                "source_refund_id": row.get("source_refund_id"),
                "source_event_id": row.get("source_event_id"),
                "amount": amount,
                "occurred_at": row["occurred_at"],
            }
        )
    return result


def mark_auto_processed(
    db: Session, *, settings: FiscalGlobalDraftSettings, period_end: date
) -> None:
    settings.auto_processed_through = period_end
    settings.updated_at = datetime.now(UTC)
    db.add(settings)
    db.flush()
