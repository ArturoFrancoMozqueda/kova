from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, local
from time import sleep
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import set_tenant_context
from app.orders import repository as order_repo
from app.orders import service as order_service
from app.orders.schemas import OrderCreate


@pytest.fixture
def sale_lock_pair(owner_engine):
    ids = {
        "tenant": uuid4(),
        "user": uuid4(),
        "products": sorted((uuid4(), uuid4()), key=lambda value: value.int),
    }
    with owner_engine.begin() as conn:
        conn.execute(
            text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Lock pair', :slug)"),
            {"id": ids["tenant"], "slug": f"lock-pair-{ids['tenant']}"},
        )
        conn.execute(
            text(
                "INSERT INTO users (id, email, hashed_password, is_email_verified) "
                "VALUES (:id, :email, 'hash', true)"
            ),
            {"id": ids["user"], "email": f"lock-pair-{ids['user']}@example.com"},
        )
        conn.execute(
            text(
                "INSERT INTO memberships (tenant_id, user_id, role) "
                "VALUES (:tenant_id, :user_id, 'owner')"
            ),
            {"tenant_id": ids["tenant"], "user_id": ids["user"]},
        )
        conn.execute(
            text(
                "INSERT INTO products "
                "(id, tenant_id, name, price_amount, track_inventory) VALUES "
                "(:first, :tenant_id, 'Primero', 10.00, true), "
                "(:second, :tenant_id, 'Segundo', 10.00, true)"
            ),
            {
                "first": ids["products"][0],
                "second": ids["products"][1],
                "tenant_id": ids["tenant"],
            },
        )
        conn.execute(
            text(
                "INSERT INTO inventory_movements "
                "(tenant_id, product_id, movement_type, quantity_delta, "
                "stock_on_hand_after, created_by_user_id) VALUES "
                "(:tenant_id, :first, 'adjustment', 10, 10, :user_id), "
                "(:tenant_id, :second, 'adjustment', 10, 10, :user_id)"
            ),
            {
                "tenant_id": ids["tenant"],
                "first": ids["products"][0],
                "second": ids["products"][1],
                "user_id": ids["user"],
            },
        )
    try:
        yield ids
    finally:
        with owner_engine.begin() as conn:
            conn.execute(text("SELECT set_config('app.allow_fiscal_history_delete', 'on', true)"))
            for table in (
                "order_item_tax_snapshots",
                "order_item_fiscal_snapshots",
                "order_fiscal_snapshots",
                "order_item_modifiers",
                "payments",
                "inventory_movements",
                "order_items",
                "orders",
                "idempotency_keys",
                "audit_logs",
            ):
                conn.execute(
                    text(f"DELETE FROM {table} WHERE tenant_id = :tenant_id"),
                    {"tenant_id": ids["tenant"]},
                )
            conn.execute(
                text("DELETE FROM memberships WHERE tenant_id = :tenant_id"),
                {"tenant_id": ids["tenant"]},
            )
            conn.execute(
                text("DELETE FROM products WHERE tenant_id = :tenant_id"),
                {"tenant_id": ids["tenant"]},
            )
            conn.execute(
                text("DELETE FROM users WHERE id = :user_id"),
                {"user_id": ids["user"]},
            )
            conn.execute(
                text("DELETE FROM tenants WHERE id = :tenant_id"),
                {"tenant_id": ids["tenant"]},
            )


def test_reversed_carts_complete_without_product_lock_deadlock(
    owner_engine,
    kova_app_engine,
    sale_lock_pair: dict[str, UUID | list[UUID]],
    monkeypatch,
) -> None:
    """Two checkouts with A/B and B/A must acquire product rows in one order."""
    tenant_id = sale_lock_pair["tenant"]
    user_id = sale_lock_pair["user"]
    products = sale_lock_pair["products"]
    assert isinstance(tenant_id, UUID)
    assert isinstance(user_id, UUID)
    assert isinstance(products, list)

    start = Barrier(2)
    calls = local()
    original_get_product = order_repo.get_active_product_for_update

    def hold_first_product_lock(*args, **kwargs):
        product = original_get_product(*args, **kwargs)
        calls.count = getattr(calls, "count", 0) + 1
        if calls.count == 1:
            sleep(0.25)
        return product

    monkeypatch.setattr(order_repo, "get_active_product_for_update", hold_first_product_lock)

    def checkout(product_ids: list[UUID]) -> tuple[int, str]:
        with Session(kova_app_engine) as db:
            set_tenant_context(db, tenant_id)
            start.wait(timeout=5)
            status, response = order_service.create_order(
                db,
                tenant_id=tenant_id,
                user_id=user_id,
                body=OrderCreate.model_validate(
                    {
                        "items": [
                            {"product_id": product_id, "quantity": 1}
                            for product_id in product_ids
                        ],
                        "payments": [{"method": "bank_transfer", "amount": "20.00"}],
                    }
                ),
                idempotency_key=f"inverse-locks-{uuid4()}",
            )
            return status, response["id"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        forward = pool.submit(checkout, products)
        reverse = pool.submit(checkout, list(reversed(products)))
        results = [forward.result(timeout=10), reverse.result(timeout=10)]

    assert [status for status, _ in results] == [201, 201]
    assert len({order_id for _, order_id in results}) == 2
    with owner_engine.connect() as conn:
        assert (
            conn.scalar(
                text("SELECT count(*) FROM orders WHERE tenant_id = :tenant_id"),
                {"tenant_id": tenant_id},
            )
            == 2
        )
        assert (
            conn.scalar(
                text("SELECT count(*) FROM order_items WHERE tenant_id = :tenant_id"),
                {"tenant_id": tenant_id},
            )
            == 4
        )
        stock = dict(
            conn.execute(
                text(
                    "SELECT product_id, sum(quantity_delta) FROM inventory_movements "
                    "WHERE tenant_id = :tenant_id GROUP BY product_id"
                ),
                {"tenant_id": tenant_id},
            ).all()
        )
        assert stock == {products[0]: 8, products[1]: 8}
