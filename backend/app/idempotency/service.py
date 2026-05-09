from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.idempotency.models import IdempotencyKey
from app.shared.exceptions import bad_request


def get(db: Session, *, tenant_id: UUID, key: str) -> IdempotencyKey | None:
    now = datetime.now(UTC)
    return (
        db.query(IdempotencyKey)
        .filter(
            IdempotencyKey.tenant_id == tenant_id,
            IdempotencyKey.key == key,
            IdempotencyKey.expires_at > now,
        )
        .first()
    )


def store(
    db: Session,
    *,
    tenant_id: UUID,
    key: str,
    request_hash: str,
    response_status: int,
    response_body: dict,
) -> IdempotencyKey:
    now = datetime.now(UTC)
    record = IdempotencyKey(
        tenant_id=tenant_id,
        key=key,
        request_hash=request_hash,
        response_status=response_status,
        response_body=response_body,
        created_at=now,
        expires_at=now + timedelta(seconds=settings.token_ttl_seconds),
    )
    try:
        db.add(record)
        db.flush()
    except IntegrityError:
        db.rollback()
        existing = get(db, tenant_id=tenant_id, key=key)
        if existing and existing.request_hash != request_hash:
            raise bad_request("Idempotency key reused with different request body") from None
    return record
