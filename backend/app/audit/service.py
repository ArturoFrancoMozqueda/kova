from uuid import UUID

from sqlalchemy.orm import Session

from app.audit.models import AuditLog


def log(
    db: Session,
    *,
    action: str,
    tenant_id: UUID | None = None,
    user_id: UUID | None = None,
    resource_type: str | None = None,
    resource_id: UUID | None = None,
    changes: dict | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    entry = AuditLog(
        tenant_id=tenant_id,
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        changes=changes,
        ip_address=ip_address,
    )
    db.add(entry)
    db.flush()
    return entry
