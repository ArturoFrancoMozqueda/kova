from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.idempotency.models import IdempotencyKey
from app.shared.exceptions import bad_request, conflict


def _by_key(
    db: Session, *, tenant_id: UUID, key: str, for_update: bool = False
) -> IdempotencyKey | None:
    query = db.query(IdempotencyKey).filter(
        IdempotencyKey.tenant_id == tenant_id,
        IdempotencyKey.key == key,
    )
    if for_update:
        query = query.with_for_update()
    return query.first()


def get(db: Session, *, tenant_id: UUID, key: str) -> IdempotencyKey | None:
    # A completed financial effect outlives the response replay window. Hiding
    # an old row would let a caller try the same key again and collide only
    # after performing its mutation.
    return _by_key(db, tenant_id=tenant_id, key=key)


def claim(db: Session, *, tenant_id: UUID, key: str, request_hash: str) -> IdempotencyKey | None:
    """Reserve a key before side effects, or return its completed response.

    The reservation and the business mutation share one transaction. A racing
    request therefore waits for the winner and can only replay its response;
    it cannot persist a second mutation before discovering the collision.
    """
    existing = _by_key(db, tenant_id=tenant_id, key=key, for_update=True)
    if existing is not None:
        if existing.request_hash != request_hash:
            raise bad_request("Idempotency key reused with different request body")
        if existing.response_status is None or existing.response_body is None:
            raise conflict("Idempotent request is still processing")
        return existing

    now = datetime.now(UTC)
    response_expires_at = now + timedelta(seconds=settings.idempotency_response_ttl_seconds)
    record = IdempotencyKey(
        tenant_id=tenant_id,
        key=key,
        request_hash=request_hash,
        response_status=None,
        response_body=None,
        created_at=now,
        expires_at=response_expires_at,
    )
    try:
        with db.begin_nested():
            db.add(record)
            db.flush()
    except IntegrityError:
        existing = _by_key(db, tenant_id=tenant_id, key=key, for_update=True)
        if existing is None:
            raise
        if existing.request_hash != request_hash:
            raise bad_request("Idempotency key reused with different request body") from None
        if existing.response_status is None or existing.response_body is None:
            raise conflict("Idempotent request is still processing") from None
        return existing
    return None


def store(
    db: Session,
    *,
    tenant_id: UUID,
    key: str,
    request_hash: str,
    response_status: int,
    response_body: dict,
) -> IdempotencyKey:
    record = _by_key(db, tenant_id=tenant_id, key=key, for_update=True)
    if record is None:
        raise RuntimeError("Idempotency response stored without a reservation")
    if record.request_hash != request_hash:
        raise bad_request("Idempotency key reused with different request body")
    record.response_status = response_status
    record.response_body = response_body
    record.expires_at = datetime.now(UTC) + timedelta(
        seconds=settings.idempotency_response_ttl_seconds
    )
    db.flush()
    return record
