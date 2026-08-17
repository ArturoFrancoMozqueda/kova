import calendar
import csv
import hashlib
import io
import json
import logging
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.fiscal import repository as repo
from app.fiscal.models import FiscalGlobalDraftBatch, FiscalGlobalDraftSettings
from app.fiscal.schemas import FiscalGlobalDraftSettingsUpsert
from app.idempotency import service as idempotency_service
from app.shared.exceptions import bad_request, conflict, not_found
from app.tenants import repository as tenant_repo

logger = logging.getLogger(__name__)

FISCAL_TIMEZONE_NAME = "America/Mexico_City"
FISCAL_TIMEZONE = ZoneInfo(FISCAL_TIMEZONE_NAME)


def _request_hash(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode()).hexdigest()


def _money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _settings_body(settings: FiscalGlobalDraftSettings) -> dict[str, Any]:
    return {
        "frequency": settings.frequency,
        "weekly_close_day": settings.weekly_close_day,
        "monthly_close_day": settings.monthly_close_day,
        "auto_close_enabled": settings.auto_close_enabled,
        "timezone": FISCAL_TIMEZONE_NAME,
        "scheduler_status": "active",
    }


def get_settings(db: Session, *, tenant_id: UUID) -> dict[str, Any]:
    settings = repo.get_settings(db, tenant_id=tenant_id)
    if not settings:
        return {
            "frequency": "monthly",
            "weekly_close_day": 7,
            "monthly_close_day": 31,
            "auto_close_enabled": False,
            "timezone": FISCAL_TIMEZONE_NAME,
            "scheduler_status": "active",
        }
    return _settings_body(settings)


def upsert_settings(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    body: FiscalGlobalDraftSettingsUpsert,
) -> dict[str, Any]:
    settings = repo.upsert_settings(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        frequency=body.frequency,
        weekly_close_day=body.weekly_close_day,
        monthly_close_day=body.monthly_close_day,
        auto_close_enabled=body.auto_close_enabled,
    )
    response = _settings_body(settings)
    audit_service.log(
        db,
        action="fiscal.global_draft.settings_updated",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="fiscal_global_draft_settings",
        resource_id=tenant_id,
        changes=response,
    )
    db.commit()
    return response


def _month_close(year: int, month: int, configured_day: int) -> date:
    return date(year, month, min(configured_day, calendar.monthrange(year, month)[1]))


def _previous_month(value: date) -> tuple[int, int]:
    if value.month == 1:
        return value.year - 1, 12
    return value.year, value.month - 1


def resolve_period(
    *,
    frequency: str,
    period_end: date,
    weekly_close_day: int,
    monthly_close_day: int,
) -> tuple[date, date]:
    if frequency == "daily":
        return period_end, period_end
    if frequency == "weekly":
        if period_end.isoweekday() != weekly_close_day:
            raise bad_request("period_end must match the configured weekly closing day")
        return period_end - timedelta(days=6), period_end
    if frequency == "monthly":
        expected = _month_close(period_end.year, period_end.month, monthly_close_day)
        if period_end != expected:
            raise bad_request("period_end must match the configured monthly closing day")
        previous_year, previous_month = _previous_month(period_end)
        previous_close = _month_close(previous_year, previous_month, monthly_close_day)
        return previous_close + timedelta(days=1), period_end
    raise bad_request("Unsupported global draft frequency")


def _utc_bounds(period_start: date, period_end: date) -> tuple[datetime, datetime]:
    local_start = datetime.combine(period_start, datetime.min.time(), tzinfo=FISCAL_TIMEZONE)
    local_end = datetime.combine(
        period_end + timedelta(days=1), datetime.min.time(), tzinfo=FISCAL_TIMEZONE
    )
    return local_start.astimezone(UTC), local_end.astimezone(UTC)


def _totals(snapshots, *, refund_totals: dict[UUID, Decimal]) -> dict[str, Decimal | int]:
    total = _money(sum((row.total_amount for row in snapshots), Decimal("0.00")))
    refunded = _money(sum(refund_totals.values(), Decimal("0.00")))
    return {
        "gross_amount": _money(sum((row.gross_amount for row in snapshots), Decimal("0.00"))),
        "discount_total_amount": _money(
            sum((row.discount_total_amount for row in snapshots), Decimal("0.00"))
        ),
        "tax_total_amount": _money(
            sum((row.tax_total_amount for row in snapshots), Decimal("0.00"))
        ),
        "total_amount": total,
        "refund_total_amount": refunded,
        "net_total_amount": _money(total - refunded),
        "order_count": len(snapshots),
    }


def preview(db: Session, *, tenant_id: UUID, period_end: date) -> dict[str, Any]:
    settings = repo.get_settings(db, tenant_id=tenant_id)
    if not settings:
        raise bad_request("Configure global draft settings before preparing a preview")
    period_start, resolved_end = resolve_period(
        frequency=settings.frequency,
        period_end=period_end,
        weekly_close_day=settings.weekly_close_day,
        monthly_close_day=settings.monthly_close_day,
    )
    if resolved_end >= datetime.now(FISCAL_TIMEZONE).date():
        raise bad_request("Only completed local calendar periods can be previewed")
    start_utc, end_utc = _utc_bounds(period_start, resolved_end)
    snapshots = repo.eligible_order_snapshots(
        db,
        tenant_id=tenant_id,
        start_utc=start_utc,
        end_utc=end_utc,
    )
    refund_totals = repo.refund_totals_by_order(
        db, tenant_id=tenant_id, order_ids=[row.order_id for row in snapshots]
    )
    return {
        "frequency": settings.frequency,
        "period_start": period_start,
        "period_end": resolved_end,
        "timezone": FISCAL_TIMEZONE_NAME,
        "document_kind": "operational_draft",
        "fiscal_status": "not_issued",
        **_totals(snapshots, refund_totals=refund_totals),
        "excluded_individually_confirmed_count": repo.individually_confirmed_count(
            db,
            tenant_id=tenant_id,
            start_utc=start_utc,
            end_utc=end_utc,
        ),
    }


def _batch_body(db: Session, *, tenant_id: UUID, batch: FiscalGlobalDraftBatch) -> dict[str, Any]:
    return {
        "id": batch.id,
        "frequency": batch.frequency,
        "period_start": batch.period_start,
        "period_end": batch.period_end,
        "timezone": batch.timezone,
        "status": batch.status,
        "document_kind": batch.document_kind,
        "fiscal_status": batch.fiscal_status,
        "gross_amount": batch.gross_amount,
        "discount_total_amount": batch.discount_total_amount,
        "tax_total_amount": batch.tax_total_amount,
        "total_amount": batch.total_amount,
        "refund_total_amount": batch.refund_total_amount,
        "net_total_amount": batch.net_total_amount,
        "order_count": batch.order_count,
        "excluded_individually_confirmed_count": batch.excluded_individually_confirmed_count,
        "order_ids": repo.batch_order_ids(db, tenant_id=tenant_id, batch_id=batch.id),
        "closed_at": batch.closed_at,
    }


def close_period(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID | None,
    period_end: date,
    idempotency_key: str,
    skip_empty: bool = False,
) -> tuple[int, dict[str, Any]]:
    payload = {"period_end": period_end.isoformat(), "operation": "fiscal_global_draft_close"}
    request_hash = _request_hash(payload)
    stored = idempotency_service.get(db, tenant_id=tenant_id, key=idempotency_key)
    if stored:
        if stored.request_hash != request_hash:
            raise bad_request("Idempotency key reused with different request body")
        return stored.response_status or 200, stored.response_body or {}

    settings = repo.get_settings(db, tenant_id=tenant_id)
    if not settings:
        raise bad_request("Configure global draft settings before closing a period")
    period_start, resolved_end = resolve_period(
        frequency=settings.frequency,
        period_end=period_end,
        weekly_close_day=settings.weekly_close_day,
        monthly_close_day=settings.monthly_close_day,
    )
    if resolved_end >= datetime.now(FISCAL_TIMEZONE).date():
        raise bad_request("Only completed local calendar periods can be closed")

    repo.acquire_tenant_close_lock(db, tenant_id=tenant_id)
    overlapping = repo.find_overlapping_batch(
        db,
        tenant_id=tenant_id,
        period_start=period_start,
        period_end=resolved_end,
    )
    if overlapping:
        if overlapping.period_start != period_start or overlapping.period_end != resolved_end:
            raise conflict("The requested period overlaps an existing global draft")
        response_body = _json_safe(_batch_body(db, tenant_id=tenant_id, batch=overlapping))
        idempotency_service.store(
            db,
            tenant_id=tenant_id,
            key=idempotency_key,
            request_hash=request_hash,
            response_status=200,
            response_body=response_body,
        )
        db.commit()
        return 200, response_body

    start_utc, end_utc = _utc_bounds(period_start, resolved_end)
    snapshots = repo.eligible_order_snapshots(
        db,
        tenant_id=tenant_id,
        start_utc=start_utc,
        end_utc=end_utc,
        lock=True,
    )
    if not snapshots:
        if skip_empty:
            return 204, {}
        raise HTTPException(
            status_code=422,
            detail={
                "code": "EMPTY_GLOBAL_DRAFT_PERIOD",
                "message": "No hay ventas elegibles para cerrar en este periodo.",
            },
        )
    refund_totals = repo.refund_totals_by_order(
        db, tenant_id=tenant_id, order_ids=[row.order_id for row in snapshots]
    )
    excluded_count = repo.individually_confirmed_count(
        db,
        tenant_id=tenant_id,
        start_utc=start_utc,
        end_utc=end_utc,
    )
    batch = repo.create_batch(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        frequency=settings.frequency,
        period_start=period_start,
        period_end=resolved_end,
        snapshots=snapshots,
        refund_totals=refund_totals,
        excluded_individually_confirmed_count=excluded_count,
    )
    response_body = _json_safe(_batch_body(db, tenant_id=tenant_id, batch=batch))
    audit_service.log(
        db,
        action="fiscal.global_draft.closed",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="fiscal_global_draft_batch",
        resource_id=batch.id,
        changes={
            "period_start": period_start.isoformat(),
            "period_end": resolved_end.isoformat(),
            "order_count": batch.order_count,
            "document_kind": "operational_draft",
            "fiscal_status": "not_issued",
        },
    )
    idempotency_service.store(
        db,
        tenant_id=tenant_id,
        key=idempotency_key,
        request_hash=request_hash,
        response_status=201,
        response_body=response_body,
    )
    db.commit()
    return 201, response_body


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, (date, datetime, Decimal, UUID)):
        return str(value)
    return value


def get_batch(db: Session, *, tenant_id: UUID, batch_id: UUID) -> dict[str, Any]:
    batch = repo.get_batch(db, tenant_id=tenant_id, batch_id=batch_id)
    if not batch:
        raise not_found("Global draft not found")
    return _batch_body(db, tenant_id=tenant_id, batch=batch)


def list_batches(db: Session, *, tenant_id: UUID, limit: int, offset: int) -> dict[str, Any]:
    batches = repo.list_batches(db, tenant_id=tenant_id, limit=limit, offset=offset)
    return {
        "items": [_batch_body(db, tenant_id=tenant_id, batch=batch) for batch in batches],
        "total": repo.count_batches(db, tenant_id=tenant_id),
    }


ACCOUNTANT_REPORT_COLUMNS = (
    "folio_venta",
    "id_venta",
    "nombre_negocio",
    "id_negocio",
    "zona_horaria",
    "periodo_inicio",
    "periodo_fin",
    "cerrado_en",
    "importe_bruto",
    "descuentos",
    "impuestos",
    "total",
    "reembolsos",
    "neto",
    "moneda",
    "version_motor_precios",
    "version_catalogo_impuestos",
    "tipo_documento",
    "origen_documento",
    "estado_fiscal",
    "estado_impuestos",
    "aviso",
    "nota",
)


def _csv_safe(value: object) -> str:
    """Prevent spreadsheet formula execution while preserving CSV semantics."""
    rendered = "" if value is None else str(value)
    if rendered.lstrip(" \t\r\n").startswith(("=", "+", "-", "@")):
        return f"'{rendered}"
    return rendered


def accountant_report_csv(db: Session, *, tenant_id: UUID, batch_id: UUID) -> tuple[bytes, str]:
    batch = repo.get_batch(db, tenant_id=tenant_id, batch_id=batch_id)
    if not batch:
        raise not_found("Global draft not found")
    if batch.status != "closed":
        raise conflict("Only closed global drafts can be exported")

    rows = repo.accountant_report_rows(db, tenant_id=tenant_id, batch_id=batch.id)
    tenant = tenant_repo.get_by_id(db, tenant_id)
    reconciled = {
        "gross_amount": _money(sum((row.gross_amount for _, row in rows), Decimal("0"))),
        "discount_total_amount": _money(
            sum((row.discount_total_amount for _, row in rows), Decimal("0"))
        ),
        "tax_total_amount": _money(sum((row.tax_total_amount for _, row in rows), Decimal("0"))),
        "total_amount": _money(sum((row.total_amount for _, row in rows), Decimal("0"))),
        "refund_total_amount": _money(
            sum((assignment.refund_total_amount for assignment, _ in rows), Decimal("0"))
        ),
        "net_total_amount": _money(
            sum((assignment.net_total_amount for assignment, _ in rows), Decimal("0"))
        ),
    }
    if len(rows) != batch.order_count or any(
        value != _money(getattr(batch, field)) for field, value in reconciled.items()
    ):
        raise conflict("Global draft rows do not reconcile with the closed batch")

    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(ACCOUNTANT_REPORT_COLUMNS)
    closed_at = batch.closed_at
    if closed_at.tzinfo is None:
        closed_at = closed_at.replace(tzinfo=UTC)
    closed_at = closed_at.astimezone(FISCAL_TIMEZONE)
    for assignment, snapshot in rows:
        order_id = assignment.order_id
        writer.writerow(
            [
                _csv_safe(order_id.hex[-8:].upper()),
                _csv_safe(order_id),
                _csv_safe(tenant.name if tenant else ""),
                _csv_safe(tenant_id),
                FISCAL_TIMEZONE_NAME,
                batch.period_start.isoformat(),
                batch.period_end.isoformat(),
                closed_at.isoformat(),
                _csv_safe(_money(snapshot.gross_amount)),
                _csv_safe(_money(snapshot.discount_total_amount)),
                _csv_safe(_money(snapshot.tax_total_amount)),
                _csv_safe(_money(snapshot.total_amount)),
                _csv_safe(_money(assignment.refund_total_amount)),
                _csv_safe(_money(assignment.net_total_amount)),
                _csv_safe(snapshot.currency),
                _csv_safe(snapshot.pricing_engine_version),
                _csv_safe(snapshot.tax_catalog_version),
                "BORRADOR_INTERNO",
                "RECIBO_OPERATIVO",
                "NO_EMITIDO",
                "BASELINE_IMPUESTOS_NO_CALCULADOS",
                "NO_ES_CFDI",
                "Control interno: no es CFDI, no está timbrado ni emitido fiscalmente.",
            ]
        )

    filename = (
        f"kova-reporte-contador-{batch.period_start.isoformat()}_{batch.period_end.isoformat()}.csv"
    )
    return b"\xef\xbb\xbf" + output.getvalue().encode("utf-8"), filename


def _is_close_day(settings: FiscalGlobalDraftSettings, candidate: date) -> bool:
    if settings.frequency == "daily":
        return True
    if settings.frequency == "weekly":
        return candidate.isoweekday() == settings.weekly_close_day
    return candidate == _month_close(candidate.year, candidate.month, settings.monthly_close_day)


def _due_period_ends(
    settings: FiscalGlobalDraftSettings, *, today: date, limit: int, latest_end: date | None
) -> list[date]:
    processed = settings.auto_processed_through
    high_watermark = (
        max(value for value in (latest_end, processed) if value is not None)
        if (latest_end is not None or processed is not None)
        else None
    )
    created_at = settings.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=UTC)
    anchor = (
        high_watermark + timedelta(days=1)
        if high_watermark
        else created_at.astimezone(FISCAL_TIMEZONE).date()
    )
    candidate = anchor
    due: list[date] = []
    while candidate < today and len(due) < limit:
        if _is_close_day(settings, candidate):
            due.append(candidate)
        candidate += timedelta(days=1)
    return due


def auto_close_due_periods(
    db: Session,
    *,
    tenant_limit: int,
    periods_per_tenant: int,
    now: datetime | None = None,
) -> dict[str, int]:
    from app.tenants.feature_flags import FISCAL_GLOBAL_DRAFTS, is_feature_killed

    if is_feature_killed(FISCAL_GLOBAL_DRAFTS):
        raise HTTPException(status_code=403, detail="Fiscal global drafts are disabled")
    current = (now or datetime.now(UTC)).astimezone(FISCAL_TIMEZONE)
    candidates = repo.auto_close_candidates(db, limit=tenant_limit)
    created = replayed = skipped = failures = 0
    for settings in candidates:
        latest_end = repo.latest_batch_end(db, tenant_id=settings.tenant_id)
        for period_end in _due_period_ends(
            settings,
            today=current.date(),
            limit=periods_per_tenant,
            latest_end=latest_end,
        ):
            key = f"auto:fiscal-global-draft:{period_end.isoformat()}"
            try:
                status, _ = close_period(
                    db,
                    tenant_id=settings.tenant_id,
                    user_id=None,
                    period_end=period_end,
                    idempotency_key=key,
                    skip_empty=True,
                )
                if status == 201:
                    created += 1
                elif status == 204:
                    skipped += 1
                else:
                    replayed += 1
                repo.mark_auto_processed(db, settings=settings, period_end=period_end)
                audit_service.log(
                    db,
                    action="fiscal.global_draft.auto_processed",
                    tenant_id=settings.tenant_id,
                    resource_type="fiscal_global_draft_settings",
                    resource_id=settings.tenant_id,
                    changes={"period_end": period_end.isoformat(), "result_status": status},
                )
                db.commit()
            except HTTPException:
                db.rollback()
                failures += 1
                logger.exception(
                    "fiscal global draft auto-close rejected tenant=%s period_end=%s",
                    settings.tenant_id,
                    period_end,
                )
            except Exception:  # noqa: BLE001 - one tenant must not block the catch-up batch
                db.rollback()
                failures += 1
                logger.exception(
                    "fiscal global draft auto-close failed tenant=%s period_end=%s",
                    settings.tenant_id,
                    period_end,
                )
    return {
        "tenants_examined": len(candidates),
        "batches_created": created,
        "batches_replayed": replayed,
        "periods_skipped_empty": skipped,
        "failures": failures,
    }
