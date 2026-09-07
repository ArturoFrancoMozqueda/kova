from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.customer_orders import service as customer_order_service
from app.inventory import service as inventory_service
from app.orders import service as order_service
from app.orders.models import Order
from app.tenants.models import Tenant


def _signup_login(client, *, prefix: str) -> UUID:
    email = f"query-{prefix}-{uuid4().hex}@example.com"
    signup = client.post(
        "/api/v1/auth/signup",
        json={
            "email": email,
            "password": "S3cur3pass!",
            "tenant_name": f"Queries {prefix}",
            "accepted_terms": True,
        },
    )
    assert signup.status_code == 201, signup.text
    body = signup.json()
    assert (
        client.post(
            "/api/v1/auth/verify", json={"token": body["dev_verification_token"]}
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": "S3cur3pass!"},
        ).status_code
        == 200
    )
    return UUID(body["tenant_id"])


def _enable_customer_orders(db: Session, tenant_id: UUID) -> None:
    tenant = db.get(Tenant, tenant_id)
    assert tenant is not None
    tenant.feature_overrides = {**tenant.feature_overrides, "customer_orders": True}
    db.commit()


def _product(client, *, name: str, stock: int = 20) -> dict[str, Any]:
    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"query-product-{uuid4().hex}"},
        json={"name": name, "price_amount": "10.00", "track_inventory": True},
    )
    assert response.status_code == 201, response.text
    product = response.json()
    seed = client.post(
        f"/api/v1/inventory/products/{product['id']}/adjustments",
        headers={"Idempotency-Key": f"query-stock-{uuid4().hex}"},
        json={"quantity_delta": stock, "reason": "Carga sintética"},
    )
    assert seed.status_code == 201, seed.text
    return product


def _customer_order(client, product_ids: list[str], *, confirm: bool = False) -> dict:
    response = client.post(
        "/api/v1/customer-orders",
        headers={"Idempotency-Key": f"query-customer-order-{uuid4().hex}"},
        json={
            "fulfillment_type": "pickup",
            "source_channel": "counter",
            "items": [
                {"product_id": product_id, "quantity": 1}
                for product_id in product_ids
            ],
        },
    )
    assert response.status_code == 201, response.text
    order = response.json()
    if not confirm:
        return order
    confirmed = client.post(
        f"/api/v1/customer-orders/{order['id']}/confirm",
        headers={"Idempotency-Key": f"query-confirm-{uuid4().hex}"},
        json={"version": order["version"]},
    )
    assert confirmed.status_code == 200, confirmed.text
    return confirmed.json()


def _selects_during(db: Session, operation: Callable[[], Any]) -> tuple[Any, list[str]]:
    statements: list[str] = []

    def record(_conn, _cursor, statement, _parameters, _context, _executemany):
        normalized = " ".join(statement.lower().split())
        if normalized.startswith("select"):
            statements.append(normalized)

    event.listen(db.bind, "before_cursor_execute", record)
    try:
        return operation(), statements
    finally:
        event.remove(db.bind, "before_cursor_execute", record)


def _queries_from(statements: list[str], table: str) -> int:
    return sum(f"from {table}" in statement for statement in statements)


def test_inventory_stock_query_count_is_constant_with_product_volume(
    client, db: Session
) -> None:
    tenant_id = _signup_login(client, prefix="inventory")
    products = [_product(client, name=f"Producto {index:02d}") for index in range(20)]

    rows, statements = _selects_during(
        db, lambda: inventory_service.list_stock(db, tenant_id=tenant_id)
    )

    assert len(rows) == len(products)
    assert _queries_from(statements, "products") == 1
    assert _queries_from(statements, "inventory_movements") == 1
    assert _queries_from(statements, "inventory_reservations") == 1


def test_customer_order_list_batches_stock_conflicts_across_many_orders(
    client, db: Session
) -> None:
    tenant_id = _signup_login(client, prefix="customer-list")
    _enable_customer_orders(db, tenant_id)
    product = _product(client, name="Producto reservado", stock=20)
    orders = [_customer_order(client, [product["id"]], confirm=True) for _ in range(12)]

    result, statements = _selects_during(
        db,
        lambda: customer_order_service.list_customer_orders(
            db, tenant_id=tenant_id, limit=50, offset=0
        ),
    )

    assert len(result["items"]) == len(orders)
    assert _queries_from(statements, "inventory_movements") == 1
    assert _queries_from(statements, "inventory_reservations") == 2


def test_sale_and_customer_order_serialization_batch_item_modifiers(
    client, db: Session
) -> None:
    tenant_id = _signup_login(client, prefix="serialization")
    _enable_customer_orders(db, tenant_id)
    products = [_product(client, name=f"Línea {index:02d}") for index in range(8)]
    product_ids = [product["id"] for product in products]
    sale_response = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": "query-serialization-sale"},
        json={
            "items": [
                {"product_id": product_id, "quantity": 1}
                for product_id in product_ids
            ],
            "payments": [{"method": "bank_transfer", "amount": "80.00"}],
        },
    )
    assert sale_response.status_code == 201, sale_response.text
    sale = db.get(Order, UUID(sale_response.json()["id"]))
    assert sale is not None

    sale_body, sale_statements = _selects_during(
        db,
        lambda: order_service.serialize_order(db, tenant_id=tenant_id, order=sale),
    )
    assert len(sale_body["items"]) == len(products)
    assert _queries_from(sale_statements, "order_items") == 1
    assert _queries_from(sale_statements, "payments") == 1
    assert _queries_from(sale_statements, "order_item_modifiers") == 1

    customer_order = _customer_order(client, product_ids)
    customer_body, customer_statements = _selects_during(
        db,
        lambda: customer_order_service.get_customer_order(
            db, tenant_id=tenant_id, order_id=UUID(customer_order["id"])
        ),
    )
    assert len(customer_body["items"]) == len(products)
    assert _queries_from(customer_statements, "customer_order_items") == 1
    assert _queries_from(customer_statements, "customer_order_item_modifiers") == 1

    customer_model = customer_order_service.repo.get_order(
        db, tenant_id=tenant_id, order_id=UUID(customer_order["id"])
    )
    assert customer_model is not None
    _, reservation_statements = _selects_during(
        db, lambda: customer_order_service._reserve_inventory(db, order=customer_model)
    )
    assert _queries_from(reservation_statements, "inventory_movements") == 1
    assert _queries_from(reservation_statements, "inventory_reservations") == 2
