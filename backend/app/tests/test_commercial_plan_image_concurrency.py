"""Tenant-wide photo capacity is checked and persisted in one serialized RLS transaction."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from queue import Queue
from threading import Event
from time import monotonic
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.billing.plan_policy import enforce_product_image_quota
from app.billing.plans import PLANS
from app.catalog.models import ProductImageFile
from app.db import set_tenant_context


@pytest.fixture
def committed_image_capacity(owner_engine):
    tenant = uuid4()
    products = (uuid4(), uuid4())
    with owner_engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO tenants(id,name,slug,billing_cohort) "
            "VALUES(:id,'Synthetic photo concurrency',:slug,'tiered')"
        ), {"id": tenant, "slug": f"photo-concurrency-{tenant}"})
        conn.execute(text(
            "INSERT INTO subscriptions(id,tenant_id,status,plan_code,stripe_subscription_id,"
            "stripe_price_id,current_period_start,current_period_end,stripe_period_synced_at,"
            "plan_effective_until) VALUES(:id,:tenant,'active','esencial',:subscription,:price,"
            "now()-interval '1 day',now()+interval '29 days',now(),now()+interval '29 days')"
        ), {"id": uuid4(), "tenant": tenant, "subscription": f"sub_photo_synthetic_{tenant}",
            "price": "price_photo_synthetic_esencial"})
        for product in products:
            conn.execute(text(
                "INSERT INTO products(id,tenant_id,name,price_amount) "
                "VALUES(:id,:tenant,'Synthetic photo product',10)"
            ), {"id": product, "tenant": tenant})
    try:
        yield tenant, products
    finally:
        with owner_engine.begin() as conn:
            for table in ("product_image_files", "products", "subscriptions", "branches"):
                conn.execute(text(f"DELETE FROM {table} WHERE tenant_id=:tenant"),
                             {"tenant": tenant})
            conn.execute(text("DELETE FROM tenants WHERE id=:tenant"), {"tenant": tenant})


def test_competing_photo_uploads_cannot_overdraw_the_tenant_allowance(
    owner_engine, kova_app_engine, committed_image_capacity, monkeypatch,
):
    tenant, products = committed_image_capacity
    monkeypatch.setitem(PLANS, "esencial", replace(PLANS["esencial"], product_image_bytes=400))
    first_persisted = Event()
    release_first = Event()
    second_pid = Queue(maxsize=1)

    def persist(db, product):
        enforce_product_image_quota(
            db, tenant_id=tenant, product_id=product, incoming_bytes=300,
        )
        db.add(ProductImageFile(
            tenant_id=tenant, product_id=product, content_type="image/png",
            bytes_data=b"synthetic-photo".ljust(300, b"\0"), byte_size=300,
        ))
        db.flush()

    def first_upload():
        with Session(kova_app_engine) as db:
            set_tenant_context(db, tenant)
            db.execute(text("SET LOCAL lock_timeout='8s'"))
            assert db.execute(text("SELECT current_user")).scalar_one() == "kova_app"
            persist(db, products[0])
            first_persisted.set()
            assert release_first.wait(timeout=10), "Test did not release the first transaction"
            db.commit()
            return "stored"

    def second_upload():
        assert first_persisted.wait(timeout=10), "First upload did not acquire its quota lock"
        with Session(kova_app_engine) as db:
            set_tenant_context(db, tenant)
            db.execute(text("SET LOCAL lock_timeout='8s'"))
            assert db.execute(text("SELECT current_user")).scalar_one() == "kova_app"
            second_pid.put(db.execute(text("SELECT pg_backend_pid()")).scalar_one())
            try:
                persist(db, products[1])
            except HTTPException as exc:
                db.rollback()
                assert exc.status_code == 403
                assert exc.detail["reason"] == "plan_limit_reached"
                assert exc.detail["limit"] == "product_image_bytes"
                return "capacity_rejected"
            db.commit()
            return "stored"

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(first_upload)
        second = pool.submit(second_upload)
        try:
            assert first_persisted.wait(timeout=10)
            pid = second_pid.get(timeout=10)
            waiting_on_quota_lock = False
            deadline = monotonic() + 5
            # Observe an actual PostgreSQL wait, rather than guessing overlap with a sleep.
            with owner_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
                while monotonic() < deadline and not second.done():
                    wait = conn.execute(text(
                        "SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=:pid"
                    ), {"pid": pid}).one_or_none()
                    if wait is not None and tuple(wait) == ("Lock", "advisory"):
                        waiting_on_quota_lock = True
                        break
            assert waiting_on_quota_lock, "Second quota check never waited on the tenant lock"
        finally:
            release_first.set()
        assert first.result(timeout=10) == "stored"
        assert second.result(timeout=10) == "capacity_rejected"

    with owner_engine.connect() as conn:
        assert conn.execute(text(
            "SELECT count(*),sum(byte_size),sum(octet_length(bytes_data)) "
            "FROM product_image_files WHERE tenant_id=:tenant"
        ), {"tenant": tenant}).one() == (1, 300, 300)
        assert conn.execute(text(
            "SELECT product_id FROM product_image_files WHERE tenant_id=:tenant"
        ), {"tenant": tenant}).scalar_one() == products[0]
