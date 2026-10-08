import csv
import io
import json
import logging
import tempfile
import zipfile
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import BinaryIO
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.account_lifecycle.models import AccountDeletionRequest
from app.audit import service as audit_service
from app.auth.models import User
from app.auth.service import verify_password
from app.billing import repository as billing_repository
from app.billing import service as billing_service
from app.config import settings
from app.tenants.models import Tenant

logger = logging.getLogger(__name__)


class AccountPurgeBatchError(RuntimeError):
    """Signals a partial purge after successful accounts were committed."""

    def __init__(self, *, purged: int, failed: int) -> None:
        super().__init__("one or more account purges failed")
        self.purged = purged
        self.failed = failed


@dataclass(frozen=True)
class ExportTable:
    """Public account-export contract for one directly-owned tenant table."""

    name: str
    columns: tuple[str, ...]


# Account exports are a public portability surface. Keep this allowlist explicit:
# adding a tenant_id column to an internal table must never publish it implicitly.
def _columns(value: str) -> tuple[str, ...]:
    return tuple(value.split())


_EXPORT_TABLES = (
    ExportTable(
        "inventory_lots",
        _columns(
            "id tenant_id product_id code is_unknown manufactured_on "
            "rotation_on expires_on rotation_label created_at"
        ),
    ),
    ExportTable(
        "inventory_lot_allocations",
        _columns("id tenant_id branch_id product_id movement_id lot_id quantity_delta"),
    ),
    ExportTable(
        "inventory_lot_reservations",
        _columns("id tenant_id branch_id product_id reservation_id lot_id quantity"),
    ),
    ExportTable(
        "cfdi_connections",
        _columns(
            "id tenant_id environment organization_id issuer_rfc production_ready "
            "certificate_expires_at refreshed_at"
        ),
    ),
    ExportTable(
        "cfdi_documents",
        _columns(
            "id tenant_id branch_id order_id request_id connection_id environment organization_id "
            "state external_id provider_id uuid payload total_amount last_error_code "
            "cancellation_status cancellation_payload confirmed_at canceled_at "
            "created_by_user_id created_at updated_at"
        ),
    ),
    ExportTable(
        "customers",
        _columns("id tenant_id name email phone is_active created_at updated_at"),
    ),
    ExportTable(
        "suppliers",
        _columns("id tenant_id name contact is_active created_at"),
    ),
    ExportTable(
        "purchase_orders",
        _columns(
            "id tenant_id branch_id supplier_id supplier_name status notes "
            "created_by_user_id created_at"
        ),
    ),
    ExportTable(
        "purchase_order_items",
        _columns(
            "id tenant_id purchase_order_id product_id product_name quantity "
            "received_quantity unit_cost"
        ),
    ),
    ExportTable(
        "inventory_transfers",
        _columns(
            "id tenant_id source_branch_id destination_branch_id product_id product_name quantity "
            "reason created_by_user_id created_at"
        ),
    ),
    ExportTable(
        "fiscal_issuer_profiles",
        _columns("tenant_id fiscal_data"),
    ),
    ExportTable(
        "invoice_requests",
        _columns(
            "id tenant_id branch_id order_id status issuer_snapshot recipient_snapshot "
            "pricing_snapshot total_amount created_at"
        ),
    ),
    ExportTable("branches", _columns("id tenant_id name address created_at")),
    ExportTable(
        "categories",
        _columns("id tenant_id name description sort_order is_active created_at updated_at"),
    ),
    ExportTable(
        "products",
        _columns(
            "id tenant_id category_id name description sku barcode price_amount cost_price "
            "track_inventory track_lots rotation_label rotation_days expiry_days "
            "low_stock_threshold is_active image_url image_position_x "
            "image_position_y image_zoom created_at updated_at"
        ),
    ),
    ExportTable(
        "product_image_files",
        _columns("id tenant_id product_id content_type byte_size created_at updated_at"),
    ),
    ExportTable(
        "modifier_groups",
        _columns(
            "id tenant_id name is_required min_selections max_selections sort_order is_active "
            "created_at updated_at"
        ),
    ),
    ExportTable(
        "modifier_options",
        _columns(
            "id tenant_id group_id name price_delta sort_order is_active created_at updated_at"
        ),
    ),
    ExportTable(
        "product_modifier_groups",
        _columns("id tenant_id product_id modifier_group_id sort_order"),
    ),
    ExportTable(
        "orders",
        _columns(
            "id tenant_id branch_id client_uuid shift_id created_by_user_id status subtotal_amount "
            "total_amount discount_amount tax_rate tax_amount customer_id occurred_at "
            "created_at updated_at"
        ),
    ),
    ExportTable(
        "order_items",
        _columns(
            "id tenant_id order_id product_id lot_tracked product_name quantity "
            "unit_price_amount unit_cost "
            "line_total_amount discount_amount tax_amount"
        ),
    ),
    ExportTable(
        "order_item_modifiers",
        _columns(
            "id tenant_id order_item_id modifier_group_id modifier_group_name "
            "modifier_option_id modifier_option_name price_delta_amount"
        ),
    ),
    ExportTable(
        "payments",
        _columns(
            "id tenant_id order_id method amount_amount amount_tendered_amount "
            "change_due_amount reference created_at"
        ),
    ),
    ExportTable(
        "inventory_movements",
        _columns(
            "id tenant_id branch_id product_id order_id order_item_id "
            "lot_tracked movement_type quantity_delta "
            "stock_on_hand_after "
            "reason reason_code created_by_user_id created_at"
        ),
    ),
    ExportTable(
        "refunds",
        _columns(
            "id tenant_id branch_id order_id created_by_user_id reason refunded_amount "
            "refund_payment_method created_at"
        ),
    ),
    ExportTable(
        "voids",
        _columns("id tenant_id branch_id order_id created_by_user_id reason created_at"),
    ),
    ExportTable(
        "shifts",
        _columns(
            "id tenant_id branch_id opened_by_user_id closed_by_user_id status opening_cash_amount "
            "actual_cash_amount expected_cash_amount reconciliation_status variance_amount "
            "opened_at closed_at"
        ),
    ),
    ExportTable(
        "cash_movements",
        _columns(
            "id tenant_id branch_id shift_id type amount reason created_by_user_id created_at"
        ),
    ),
    ExportTable(
        "expenses",
        _columns(
            "id tenant_id branch_id category amount expense_date note created_by_user_id "
            "created_at "
            "updated_at"
        ),
    ),
    ExportTable(
        "customer_orders",
        _columns(
            "id tenant_id branch_id folio status fulfillment_type source_channel customer_name "
            "customer_phone delivery_address delivery_reference promised_at note "
            "subtotal_amount total_amount sale_order_id version created_by_user_id "
            "updated_by_user_id cancelled_by_user_id cancellation_reason cancellation_note "
            "confirmed_at ready_at fulfilled_at cancelled_at created_at updated_at"
        ),
    ),
    ExportTable(
        "customer_order_items",
        _columns(
            "id tenant_id customer_order_id product_id product_name quantity unit_price_amount "
            "line_total_amount note"
        ),
    ),
    ExportTable(
        "customer_order_item_modifiers",
        _columns(
            "id tenant_id customer_order_item_id modifier_group_id modifier_group_name "
            "modifier_option_id modifier_option_name price_delta_amount"
        ),
    ),
    ExportTable(
        "inventory_reservations",
        _columns(
            "id tenant_id branch_id customer_order_id product_id lot_tracked quantity status "
            "created_at updated_at"
        ),
    ),
    ExportTable(
        "tenant_business_profiles",
        _columns(
            "tenant_id public_name support_email support_phone timezone locale currency "
            "created_at updated_at"
        ),
    ),
    ExportTable(
        "tenant_receipt_settings",
        _columns(
            "tenant_id receipt_business_name footer tax_contact_text logo_url paper_width_mm "
            "default_tax_rate "
            "created_at updated_at"
        ),
    ),
    ExportTable(
        "tenant_logo_files",
        _columns("id tenant_id content_type byte_size created_at updated_at"),
    ),
    ExportTable(
        "tenant_onboarding_state",
        _columns(
            "tenant_id business_profile_completed receipt_settings_completed "
            "first_product_completed inventory_completed shift_opened_completed "
            "first_sale_completed billing_completed created_at updated_at"
        ),
    ),
    ExportTable(
        "membership_invitations",
        _columns(
            "id tenant_id email role status invited_by_user_id created_at accepted_at "
            "revoked_at expires_at"
        ),
    ),
    ExportTable(
        "subscriptions",
        _columns(
            "id tenant_id status plan_name currency amount_minor_units current_period_start "
            "current_period_end trial_ends_at past_due_at grace_period_ends_at "
            "cancel_at_period_end canceled_at created_at updated_at"
        ),
    ),
    ExportTable(
        "order_fiscal_snapshots",
        _columns(
            "id tenant_id order_id gross_amount discount_total_amount tax_total_amount "
            "total_amount pricing_engine_version tax_catalog_version tax_calculation_status "
            "currency individual_fiscal_status created_at"
        ),
    ),
    ExportTable(
        "order_item_fiscal_snapshots",
        _columns(
            "id tenant_id order_id order_item_id product_id product_name quantity "
            "unit_price_amount gross_line_amount line_discount_amount "
            "order_discount_allocated_amount net_before_tax_amount tax_total_amount "
            "line_total_amount tax_object_code_snapshot product_service_code_snapshot "
            "unit_code_snapshot tax_calculation_status created_at"
        ),
    ),
    ExportTable(
        "order_item_tax_snapshots",
        _columns(
            "id tenant_id order_id order_item_id direction tax_code factor_type base_amount "
            "rate_or_quota tax_amount catalog_version created_at"
        ),
    ),
    ExportTable(
        "fiscal_global_draft_settings",
        _columns(
            "tenant_id frequency weekly_close_day monthly_close_day auto_close_enabled "
            "auto_processed_through created_by_user_id updated_by_user_id created_at updated_at"
        ),
    ),
    ExportTable(
        "fiscal_global_draft_batches",
        _columns(
            "id tenant_id frequency period_start period_end timezone status document_kind "
            "fiscal_status gross_amount discount_total_amount tax_total_amount total_amount "
            "refund_total_amount net_total_amount order_count "
            "excluded_individually_confirmed_count business_name_snapshot "
            "package_schema_version tax_calculation_status adjustment_total_amount "
            "adjusted_net_amount adjustment_count data_quality_warnings created_by_user_id "
            "closed_at created_at"
        ),
    ),
    ExportTable(
        "fiscal_global_draft_orders",
        _columns("id tenant_id batch_id order_id refund_total_amount net_total_amount created_at"),
    ),
    ExportTable(
        "fiscal_individual_invoice_events",
        _columns(
            "id tenant_id order_id status external_reference issued_at created_by_user_id "
            "created_at"
        ),
    ),
    ExportTable(
        "fiscal_global_draft_adjustments",
        _columns(
            "id tenant_id batch_id original_batch_id order_id source_refund_id source_event_id "
            "adjustment_type amount occurred_at created_at"
        ),
    ),
)
_EXPORTABLE_TENANT_TABLES = frozenset(spec.name for spec in _EXPORT_TABLES) | {
    "memberships",
    # Exported through the explicit refunds join below; tenant_id is now stored
    # as a database ownership invariant but does not change the CSV contract.
    "refund_items",
}
_NON_EXPORTABLE_TENANT_TABLES = frozenset(
    {
        "account_deletion_requests",
        "assistant_records",
        "assistant_chunks",
        "audit_logs",
        "idempotency_keys",
        "ops_notes",
        "sessions",
        "telemetry_events",
        "webhook_events",
    }
)

# Children and cross-links come before their parents. These tables comprise the
# approved account-ownership graph; unknown tenant tables stop a purge instead
# of silently leaving data behind.
_TENANT_DELETE_ORDER = (
    "assistant_chunks",
    "assistant_records",
    "cfdi_documents",
    "cfdi_connections",
    "invoice_requests",
    "fiscal_issuer_profiles",
    "inventory_lot_reservations",
    "inventory_lot_allocations",
    "inventory_lots",
    "inventory_transfers",
    "purchase_order_items",
    "purchase_orders",
    "suppliers",
    "fiscal_global_draft_adjustments",
    "fiscal_global_draft_orders",
    "order_item_tax_snapshots",
    "order_item_fiscal_snapshots",
    "order_fiscal_snapshots",
    "fiscal_individual_invoice_events",
    "fiscal_global_draft_batches",
    "fiscal_global_draft_settings",
    "refunds",
    "voids",
    "order_item_modifiers",
    "payments",
    "inventory_movements",
    "order_items",
    "customer_order_item_modifiers",
    "inventory_reservations",
    "customer_order_items",
    "customer_orders",
    "orders",
    "customers",
    "product_modifier_groups",
    "product_image_files",
    "modifier_options",
    "modifier_groups",
    "products",
    "categories",
    "cash_movements",
    "shifts",
    "expenses",
    "tenant_business_profiles",
    "tenant_receipt_settings",
    "tenant_logo_files",
    "tenant_onboarding_state",
    "membership_invitations",
    "subscriptions",
    "idempotency_keys",
    "telemetry_events",
    "sessions",
    "memberships",
    "audit_logs",
    "webhook_events",
    "ops_notes",
    "branches",
)
_PURGE_TENANT_TABLES = frozenset(_TENANT_DELETE_ORDER) | {
    "account_deletion_requests",
    "refund_items",
}


def _csv_value(value: object) -> object:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
    if isinstance(value, (datetime, UUID, Decimal)):
        return str(value)
    if isinstance(value, bytes):
        return "[archivo binario omitido]"
    # Prevent spreadsheet formula injection when an owner opens a CSV in Excel
    # or Sheets. The apostrophe is displayed as a literal marker by those apps.
    if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r")):
        return "'" + value
    return value


def _write_csv_entry(
    archive: zipfile.ZipFile,
    *,
    name: str,
    columns: Iterable[str],
    rows: Iterable[Iterable[object]],
) -> int:
    count = 0
    with archive.open(name, "w") as raw:
        output = io.TextIOWrapper(raw, encoding="utf-8", newline="", write_through=True)
        writer = csv.writer(output)
        writer.writerow(columns)
        for row in rows:
            writer.writerow([_csv_value(value) for value in row])
            count += 1
        output.detach()
    return count


def build_account_export(db: Session, *, tenant_id: UUID) -> BinaryIO:
    """Build the reviewed tenant-only account portability archive.

    The export contract deliberately lists tables and columns instead of
    discovering them. RLS remains active and every query also carries a tenant
    predicate as defense in depth.
    """

    # Stays in memory for small businesses and rolls to an OS-managed temporary
    # file after 8 MiB, preventing a large account from exhausting API memory.
    buffer = tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode="w+b")
    exported_at = datetime.now(UTC)
    manifest: dict[str, object] = {
        "exported_at": exported_at.isoformat(),
        "format": "Kova account export v2",
        "tenant_id": str(tenant_id),
        "tables": {},
    }
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for spec in _EXPORT_TABLES:
            columns_sql = ", ".join(f'"{column}"' for column in spec.columns)
            result = db.execute(
                text(f'SELECT {columns_sql} FROM "{spec.name}" WHERE tenant_id = :tenant_id'),
                {"tenant_id": tenant_id},
            )
            count = _write_csv_entry(
                archive,
                name=f"datos/{spec.name}.csv",
                columns=spec.columns,
                rows=result,
            )
            manifest["tables"][spec.name] = count  # type: ignore[index]

        # Fiscal XML is the business's issued evidence, not a replaceable image.
        # Preserve its exact bytes in the portability archive without credentials.
        fiscal_xml = db.execute(
            text(
                "SELECT id, environment, xml_bytes FROM cfdi_documents "
                "WHERE tenant_id = :tenant_id AND xml_bytes IS NOT NULL ORDER BY id"
            ),
            {"tenant_id": tenant_id},
        )
        xml_count = 0
        for document_id, environment, xml_bytes in fiscal_xml:
            archive.writestr(f"cfdi/{environment}/{document_id}.xml", bytes(xml_bytes))
            xml_count += 1
        manifest["fiscal_xml_files"] = xml_count

        # refund_items has indirect ownership through refunds. The explicit
        # tenant-safe join makes partial and repeated refunds reconstructable.
        refund_items = db.execute(
            text(
                "SELECT ri.id, ri.refund_id, ri.order_item_id, ri.quantity, "
                "ri.unit_price_amount, ri.line_total_amount "
                "FROM refund_items ri "
                "JOIN refunds r ON r.id = ri.refund_id "
                "WHERE r.tenant_id = :tenant_id"
            ),
            {"tenant_id": tenant_id},
        )
        refund_item_columns = list(refund_items.keys())
        refund_item_count = _write_csv_entry(
            archive,
            name="datos/refund_items.csv",
            columns=refund_item_columns,
            rows=refund_items,
        )
        manifest["tables"]["refund_items"] = refund_item_count  # type: ignore[index]

        tenant = db.get(Tenant, tenant_id)
        if tenant:
            _write_csv_entry(
                archive,
                name="datos/tenant.csv",
                columns=["id", "name", "slug", "is_active", "created_at", "updated_at"],
                rows=[
                    [
                        tenant.id,
                        tenant.name,
                        tenant.slug,
                        tenant.is_active,
                        tenant.created_at,
                        tenant.updated_at,
                    ]
                ],
            )
            manifest["tables"]["tenant"] = 1  # type: ignore[index]
        members = db.execute(
            text(
                "SELECT m.id AS membership_id, m.user_id, u.email, m.role, "
                "m.is_active, m.allowed_branch_id, m.created_at FROM memberships m "
                "JOIN users u ON u.id = m.user_id WHERE m.tenant_id = :tenant_id "
                "ORDER BY m.created_at"
            ),
            {"tenant_id": tenant_id},
        )
        member_columns = list(members.keys())
        member_count = _write_csv_entry(
            archive,
            name="datos/miembros.csv",
            columns=member_columns,
            rows=members,
        )
        manifest["tables"]["miembros"] = member_count  # type: ignore[index]
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        archive.writestr(
            "LEEME.txt",
            "Exportación de cuenta Kova. Los importes conservan la precisión almacenada "
            "y las fechas están en formato ISO. Los archivos binarios se omiten; sus "
            "metadatos permanecen en los CSV. Los XML fiscales disponibles se conservan "
            "en cfdi/test o cfdi/live. Los documentos de prueba no tienen validez fiscal. "
            "Las llaves de proveedores se excluyen de esta exportación. Conserva tus CFDI "
            "antes de eliminar la cuenta; la eliminación en Kova no cancela un CFDI ante el SAT.\n",
        )
    buffer.seek(0)
    return buffer


def get_deletion_status(db: Session, *, tenant_id: UUID) -> AccountDeletionRequest | None:
    return db.scalar(
        select(AccountDeletionRequest).where(
            AccountDeletionRequest.tenant_id == tenant_id,
            AccountDeletionRequest.status == "pending",
        )
    )


def _get_latest_deletion_request(db: Session, *, tenant_id: UUID) -> AccountDeletionRequest | None:
    return db.scalar(
        select(AccountDeletionRequest).where(AccountDeletionRequest.tenant_id == tenant_id)
    )


def schedule_deletion(
    db: Session,
    *,
    tenant_id: UUID,
    user: User,
    password: str,
    tenant_name: str,
) -> AccountDeletionRequest:
    tenant = db.get(Tenant, tenant_id)
    if not tenant or tenant.name != tenant_name.strip():
        raise HTTPException(status_code=400, detail="El nombre del negocio no coincide")
    if not verify_password(password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Contraseña incorrecta")

    existing = get_deletion_status(db, tenant_id=tenant_id)
    if existing:
        return existing

    # Billing cancellation is an existing idempotent contract. The data purge
    # never precedes an already-paid Stripe period.
    billing_service.cancel_subscription(db, tenant_id=tenant_id, user_id=user.id)
    subscription = billing_repository.get_subscription_by_tenant(db, tenant_id=tenant_id)
    purge_after = datetime.now(UTC) + timedelta(days=settings.account_deletion_grace_days)
    if subscription and subscription.current_period_end:
        period_end = subscription.current_period_end
        if period_end.tzinfo is None:
            period_end = period_end.replace(tzinfo=UTC)
        purge_after = max(purge_after, period_end)

    request = _get_latest_deletion_request(db, tenant_id=tenant_id)
    if request:
        request.requested_by_user_id = user.id
        request.status = "pending"
        request.requested_at = datetime.now(UTC)
        request.purge_after = purge_after
        request.canceled_at = None
        request.completed_at = None
    else:
        request = AccountDeletionRequest(
            tenant_id=tenant_id,
            requested_by_user_id=user.id,
            purge_after=purge_after,
        )
        db.add(request)
    db.flush()
    audit_service.log(
        db,
        action="account.deletion_scheduled",
        tenant_id=tenant_id,
        user_id=user.id,
        resource_type="account_deletion_request",
        resource_id=request.id,
        changes={"purge_after": purge_after.isoformat()},
    )
    db.commit()
    db.refresh(request)
    return request


def cancel_deletion(
    db: Session, *, tenant_id: UUID, user_id: UUID
) -> AccountDeletionRequest | None:
    request = get_deletion_status(db, tenant_id=tenant_id)
    if not request:
        return None
    request.status = "canceled"
    request.canceled_at = datetime.now(UTC)
    audit_service.log(
        db,
        action="account.deletion_canceled",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="account_deletion_request",
        resource_id=request.id,
    )
    db.commit()
    db.refresh(request)
    return request


def purge_due_accounts(db: Session, *, now: datetime | None = None) -> int:
    current = now or datetime.now(UTC)
    purged = 0
    failed = 0
    attempted: set[UUID] = set()
    while True:
        query = (
            select(AccountDeletionRequest)
            .where(
                AccountDeletionRequest.status == "pending",
                AccountDeletionRequest.purge_after <= current,
            )
            .order_by(AccountDeletionRequest.purge_after, AccountDeletionRequest.id)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        if attempted:
            query = query.where(AccountDeletionRequest.id.not_in(attempted))
        request = db.scalar(query)
        if request is None:
            db.rollback()
            break

        request_id = request.id
        attempted.add(request_id)
        try:
            _purge_account_graph(db, request=request, completed_at=current)
            db.commit()
            purged += 1
        except Exception as exc:
            db.rollback()
            failed += 1
            # Do not log the tenant, user, database error text or SQL values.
            # The tombstone request id and exception class are enough to locate
            # and retry the failed account without leaking customer data.
            logger.error(
                "account_purge_failed request_id=%s error_type=%s",
                request_id,
                type(exc).__name__,
            )
    if failed:
        # Successful accounts are already committed. Raising keeps the
        # scheduler red so the pending tombstones are not silently abandoned.
        raise AccountPurgeBatchError(purged=purged, failed=failed)
    return purged


def _purge_account_graph(
    db: Session,
    *,
    request: AccountDeletionRequest,
    completed_at: datetime,
) -> None:
    tenant_id = request.tenant_id
    schema_tables = frozenset(
        db.execute(
            text(
                "SELECT table_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND column_name = 'tenant_id'"
            )
        ).scalars()
    )
    unknown_tables = schema_tables - _PURGE_TENANT_TABLES
    if unknown_tables:
        raise RuntimeError("account purge ownership graph is incomplete")

    from app.assistant.storage import purge_tenant as purge_assistant_objects

    purge_assistant_objects(db, tenant_id)

    # Immutable fiscal history may only be physically removed as part of this
    # privileged whole-account purge. SET LOCAL cannot leak after commit/rollback.
    db.execute(text("SET LOCAL app.allow_fiscal_history_delete = 'on'"))
    user_ids = list(
        db.execute(
            text("SELECT user_id FROM memberships WHERE tenant_id = :tenant_id"),
            {"tenant_id": tenant_id},
        ).scalars()
    )

    # refund_items is the only indirectly-owned table in the current graph.
    db.execute(
        text(
            "DELETE FROM refund_items ri USING refunds r "
            "WHERE ri.refund_id = r.id AND r.tenant_id = :tenant_id"
        ),
        {"tenant_id": tenant_id},
    )
    for table_name in _TENANT_DELETE_ORDER:
        db.execute(
            text(f'DELETE FROM "{table_name}" WHERE tenant_id = :tenant_id'),
            {"tenant_id": tenant_id},
        )

    db.execute(
        text("DELETE FROM tenants WHERE id = :tenant_id"),
        {"tenant_id": tenant_id},
    )
    request.status = "completed"
    request.completed_at = completed_at
    request.requested_by_user_id = None
    db.flush()

    for user_id in user_ids:
        db.execute(
            text(
                "DELETE FROM users WHERE id = :user_id "
                "AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = :user_id) "
                "AND NOT EXISTS (SELECT 1 FROM ops_notes WHERE author_user_id = :user_id)"
            ),
            {"user_id": user_id},
        )
