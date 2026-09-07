from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import set_tenant_context
from app.idempotency import service


@pytest.fixture
def idempotency_tenant(owner_engine):
    tenant_id = uuid4()
    with owner_engine.begin() as conn:
        conn.execute(
            text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Idempotency', :slug)"),
            {"id": tenant_id, "slug": f"idempotency-{tenant_id}"},
        )
    try:
        yield tenant_id
    finally:
        with owner_engine.begin() as conn:
            conn.execute(text("DELETE FROM products WHERE tenant_id = :id"), {"id": tenant_id})
            conn.execute(
                text("DELETE FROM idempotency_keys WHERE tenant_id = :id"),
                {"id": tenant_id},
            )
            conn.execute(text("DELETE FROM tenants WHERE id = :id"), {"id": tenant_id})


def test_expired_key_replays_winning_response_without_repeating_effect(
    kova_app_engine, owner_engine, idempotency_tenant: UUID
):
    key = f"expired-{uuid4()}"
    effect_id = uuid4()
    with Session(kova_app_engine) as db:
        set_tenant_context(db, idempotency_tenant)
        assert (
            service.claim(db, tenant_id=idempotency_tenant, key=key, request_hash="first") is None
        )
        db.execute(
            text(
                "INSERT INTO products (id, tenant_id, name, price_amount) "
                "VALUES (:id, :tenant_id, 'Retained effect', 1.00)"
            ),
            {"id": effect_id, "tenant_id": idempotency_tenant},
        )
        service.store(
            db,
            tenant_id=idempotency_tenant,
            key=key,
            request_hash="first",
            response_status=201,
            response_body={"id": str(effect_id)},
        )
        db.commit()

    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE idempotency_keys SET expires_at = :expired "
                "WHERE tenant_id = :tenant_id AND key = :key"
            ),
            {
                "expired": datetime.now(UTC) - timedelta(seconds=1),
                "tenant_id": idempotency_tenant,
                "key": key,
            },
        )

    with Session(kova_app_engine) as db:
        set_tenant_context(db, idempotency_tenant)
        replay = service.claim(db, tenant_id=idempotency_tenant, key=key, request_hash="first")
        assert replay is not None
        assert replay.response_status == 201
        assert replay.response_body == {"id": str(effect_id)}

        with pytest.raises(HTTPException) as exc_info:
            service.claim(db, tenant_id=idempotency_tenant, key=key, request_hash="second")
        assert exc_info.value.status_code == 400
        assert "different request body" in str(exc_info.value.detail)

    with owner_engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT request_hash, response_body FROM idempotency_keys "
                "WHERE tenant_id = :tenant_id AND key = :key"
            ),
            {"tenant_id": idempotency_tenant, "key": key},
        ).one()
        count = conn.execute(
            text(
                "SELECT count(*) FROM idempotency_keys WHERE tenant_id = :tenant_id AND key = :key"
            ),
            {"tenant_id": idempotency_tenant, "key": key},
        ).scalar_one()
        effect_count = conn.execute(
            text("SELECT count(*) FROM products WHERE tenant_id = :tenant_id AND id = :effect_id"),
            {"tenant_id": idempotency_tenant, "effect_id": effect_id},
        ).scalar_one()
    assert count == 1
    assert effect_count == 1
    assert row.request_hash == "first"
    assert row.response_body == {"id": str(effect_id)}


def test_concurrent_same_key_persists_one_mutation_and_replays_one_response(
    kova_app_engine, owner_engine, idempotency_tenant: UUID
):
    key = f"race-{uuid4()}"
    request_hash = "same-request"
    barrier = Barrier(2)

    def execute_intent() -> str:
        with Session(kova_app_engine) as db:
            set_tenant_context(db, idempotency_tenant)
            barrier.wait(timeout=5)
            existing = service.claim(
                db,
                tenant_id=idempotency_tenant,
                key=key,
                request_hash=request_hash,
            )
            if existing is not None:
                return str(existing.response_body["product_id"])

            product_id = uuid4()
            db.execute(
                text(
                    "INSERT INTO products (id, tenant_id, name, price_amount) "
                    "VALUES (:id, :tenant_id, 'Idempotent product', 1.00)"
                ),
                {"id": product_id, "tenant_id": idempotency_tenant},
            )
            service.store(
                db,
                tenant_id=idempotency_tenant,
                key=key,
                request_hash=request_hash,
                response_status=201,
                response_body={"product_id": str(product_id)},
            )
            db.commit()
            return str(product_id)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(execute_intent)
        second = pool.submit(execute_intent)
        results = (first.result(timeout=15), second.result(timeout=15))

    with owner_engine.connect() as conn:
        mutation_count = conn.execute(
            text("SELECT count(*) FROM products WHERE tenant_id = :tenant_id"),
            {"tenant_id": idempotency_tenant},
        ).scalar_one()
    assert results[0] == results[1]
    assert mutation_count == 1
