import csv
import io
import json
import re
import tempfile
import zipfile
from collections.abc import Iterable
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

_SAFE_IDENTIFIER = re.compile(r"^[a-z_][a-z0-9_]*$")
_EXPORT_EXCLUDED_TABLES = {"sessions", "idempotency_keys", "webhook_events"}


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
    """Build a tenant-only ZIP from every relational table carrying tenant_id.

    Discovering tenant tables from PostgreSQL keeps the export complete as Kova
    grows. RLS remains active on this session and every SELECT also has an
    explicit tenant predicate as defense in depth.
    """
    rows = db.execute(
        text(
            "SELECT table_name FROM information_schema.columns "
            "WHERE table_schema = 'public' AND column_name = 'tenant_id' "
            "ORDER BY table_name"
        )
    ).scalars()
    tables = [
        name
        for name in rows
        if _SAFE_IDENTIFIER.fullmatch(name) and name not in _EXPORT_EXCLUDED_TABLES
    ]

    # Stays in memory for small businesses and rolls to an OS-managed temporary
    # file after 8 MiB, preventing a large account from exhausting API memory.
    buffer = tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode="w+b")
    exported_at = datetime.now(UTC)
    manifest: dict[str, object] = {
        "exported_at": exported_at.isoformat(),
        "format": "Kova account export v1",
        "tenant_id": str(tenant_id),
        "tables": {},
    }
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for table_name in tables:
            result = db.execute(
                text(f'SELECT * FROM "{table_name}" WHERE tenant_id = :tenant_id'),
                {"tenant_id": tenant_id},
            )
            columns = list(result.keys())
            count = _write_csv_entry(
                archive,
                name=f"datos/{table_name}.csv",
                columns=columns,
                rows=result,
            )
            manifest["tables"][table_name] = count  # type: ignore[index]

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
                "m.is_active, m.created_at FROM memberships m "
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
            "metadatos permanecen en los CSV.\n",
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
    due = list(
        db.scalars(
            select(AccountDeletionRequest)
            .where(
                AccountDeletionRequest.status == "pending",
                AccountDeletionRequest.purge_after <= current,
            )
            .with_for_update(skip_locked=True)
        )
    )
    purged = 0
    for request in due:
        tenant_id = request.tenant_id
        # Immutable fiscal history may only be physically removed as part of
        # this privileged, audited whole-account purge. Transaction-local keeps
        # the bypass from leaking to the pooled connection after commit/rollback.
        db.execute(text("SET LOCAL app.allow_fiscal_history_delete = 'on'"))
        user_ids = list(
            db.execute(
                text("SELECT user_id FROM memberships WHERE tenant_id = :tenant_id"),
                {"tenant_id": tenant_id},
            ).scalars()
        )
        table_names = list(
            db.execute(
                text(
                    "SELECT table_name FROM information_schema.columns "
                    "WHERE table_schema='public' AND column_name='tenant_id' "
                    "AND table_name <> 'account_deletion_requests'"
                )
            ).scalars()
        )
        for table_name in table_names:
            if _SAFE_IDENTIFIER.fullmatch(table_name):
                db.execute(
                    text(f'DELETE FROM "{table_name}" WHERE tenant_id = :tenant_id'),
                    {"tenant_id": tenant_id},
                )
        db.execute(text("DELETE FROM tenants WHERE id = :tenant_id"), {"tenant_id": tenant_id})
        for user_id in user_ids:
            still_member = db.execute(
                text("SELECT 1 FROM memberships WHERE user_id = :user_id LIMIT 1"),
                {"user_id": user_id},
            ).first()
            if not still_member:
                params = {"user_id": user_id}
                db.execute(text("DELETE FROM verification_tokens WHERE user_id = :user_id"), params)
                db.execute(text("DELETE FROM sessions WHERE user_id = :user_id"), params)
                db.execute(text("DELETE FROM users WHERE id = :user_id"), {"user_id": user_id})
        request.status = "completed"
        request.completed_at = current
        request.requested_by_user_id = None
        purged += 1
    db.commit()
    return purged
