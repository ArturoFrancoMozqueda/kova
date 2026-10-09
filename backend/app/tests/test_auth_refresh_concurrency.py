from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier, BrokenBarrierError
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import repository, service
from app.auth.models import User, UserSession
from app.tenants.models import Tenant


def test_concurrent_refresh_consumes_token_once(owner_engine, monkeypatch):
    token = f"test-refresh-{uuid4().hex}"
    now = datetime.now(UTC)
    with Session(owner_engine) as seed:
        tenant = Tenant(name="Refresh concurrency", slug=f"refresh-{uuid4().hex}")
        user = User(
            email=f"refresh-{uuid4().hex}@example.com",
            hashed_password="unused-test-hash",
            created_at=now,
            updated_at=now,
        )
        seed.add_all([tenant, user])
        seed.flush()
        session = UserSession(
            user_id=user.id,
            tenant_id=tenant.id,
            refresh_token_hash=service._hash_token(token),
            created_at=now,
            expires_at=now + timedelta(days=1),
        )
        seed.add(session)
        seed.commit()
        tenant_id, user_id, session_id = tenant.id, user.id, session.id

    start = Barrier(2)
    looked_up = Barrier(2)
    original_lookup = repository.get_session_by_refresh_hash

    def synchronized_lookup(db, token_hash):
        found = original_lookup(db, token_hash)
        if found is not None:
            # Without the row lock both workers observe the old hash before
            # either rotates it. With the lock only the winner reaches here;
            # it commits after the timeout and the waiter no longer finds it.
            try:
                looked_up.wait(timeout=1)
            except BrokenBarrierError:
                pass
        return found

    monkeypatch.setattr(repository, "get_session_by_refresh_hash", synchronized_lookup)

    def refresh():
        with Session(owner_engine) as db:
            connection_id = db.execute(text("SELECT pg_backend_pid()")).scalar_one()
            start.wait(timeout=5)
            try:
                pair = service.refresh_session(db, refresh_token=token)
                return 200, connection_id, pair
            except HTTPException as exc:
                db.rollback()
                return exc.status_code, connection_id, None

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(refresh)
            second = pool.submit(refresh)
            outcomes = [first.result(timeout=10), second.result(timeout=10)]

        assert sorted(status for status, _, _ in outcomes) == [200, 401]
        assert len({connection_id for _, connection_id, _ in outcomes}) == 2
        access, rotated_token = next(pair for status, _, pair in outcomes if status == 200)
        assert service.decode_access_token(access)["jti"] == str(session_id)
        with Session(owner_engine) as db:
            with pytest.raises(HTTPException) as exc:
                service.refresh_session(db, refresh_token=token)
            assert exc.value.status_code == 401
            db.rollback()
            # The successful response contains the persisted successor token.
            service.refresh_session(db, refresh_token=rotated_token)
    finally:
        with Session(owner_engine) as cleanup:
            cleanup.query(UserSession).filter(UserSession.id == session_id).delete()
            cleanup.query(User).filter(User.id == user_id).delete()
            cleanup.query(Tenant).filter(Tenant.id == tenant_id).delete()
            cleanup.commit()
