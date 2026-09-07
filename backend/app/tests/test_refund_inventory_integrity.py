from uuid import UUID, uuid4

from app.orders.models import InventoryMovement, Refund


def _signup_verify_login(client, *, label: str) -> dict:
    suffix = uuid4().hex
    email = f"{label}-{suffix}@example.com"
    signup_response = client.post(
        "/api/v1/auth/signup",
        json={
            "email": email,
            "password": "S3cur3pass!",
            "tenant_name": f"{label} Tenant",
            "accepted_terms": True,
        },
    )
    assert signup_response.status_code == 201, signup_response.text
    signup = signup_response.json()
    verify_response = client.post(
        "/api/v1/auth/verify", json={"token": signup["dev_verification_token"]}
    )
    assert verify_response.status_code == 200, verify_response.text
    login_response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "S3cur3pass!"},
    )
    assert login_response.status_code == 200, login_response.text
    return signup


def _open_shift(client, *, label: str) -> None:
    response = client.post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"{label}-shift-{uuid4().hex}"},
        json={"opening_cash_amount": "100.00"},
    )
    assert response.status_code == 201, response.text


def _create_product(
    client,
    *,
    label: str,
    price: str,
    track_inventory: bool,
) -> dict:
    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"{label}-product-{uuid4().hex}"},
        json={
            "name": f"{label} Product",
            "price_amount": price,
            "track_inventory": track_inventory,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _seed_stock(client, *, product_id: str, quantity: int = 10) -> None:
    response = client.post(
        f"/api/v1/inventory/products/{product_id}/adjustments",
        headers={"Idempotency-Key": f"stock-{product_id}-{uuid4().hex}"},
        json={"quantity_delta": quantity, "reason": "Regression test stock"},
    )
    assert response.status_code == 201, response.text


def _create_cash_order(client, *, items: list[dict], amount: str, label: str) -> dict:
    response = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": f"{label}-order-{uuid4().hex}"},
        json={
            "items": items,
            "payments": [{"method": "cash", "amount": amount, "amount_tendered": amount}],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _set_inventory_tracking(client, *, product_id: str, enabled: bool, label: str) -> None:
    response = client.patch(
        f"/api/v1/catalog/products/{product_id}",
        headers={"Idempotency-Key": f"{label}-tracking-{uuid4().hex}"},
        json={"track_inventory": enabled},
    )
    assert response.status_code == 200, response.text


def _order_movements(db, *, tenant_id: str, order_id: str, product_id: str) -> list[int]:
    rows = (
        db.query(InventoryMovement)
        .filter(
            InventoryMovement.tenant_id == UUID(tenant_id),
            InventoryMovement.order_id == UUID(order_id),
            InventoryMovement.product_id == UUID(product_id),
        )
        .order_by(InventoryMovement.created_at, InventoryMovement.id)
        .all()
    )
    return [row.quantity_delta for row in rows]


def test_duplicate_refund_lines_are_validated_as_one_aggregate(client, db):
    signup = _signup_verify_login(client, label="duplicate-refund")
    _open_shift(client, label="duplicate-refund")
    inexpensive = _create_product(
        client, label="inexpensive", price="5.00", track_inventory=False
    )
    expensive = _create_product(client, label="expensive", price="15.00", track_inventory=False)
    order = _create_cash_order(
        client,
        items=[
            {"product_id": inexpensive["id"], "quantity": 1},
            {"product_id": expensive["id"], "quantity": 1},
        ],
        amount="20.00",
        label="duplicate-refund",
    )

    order_item_id = next(
        item["id"] for item in order["items"] if item["product_id"] == inexpensive["id"]
    )
    response = client.post(
        f"/api/v1/orders/{order['id']}/refunds",
        headers={"Idempotency-Key": f"duplicate-refund-{uuid4().hex}"},
        json={
            "items": [
                {"order_item_id": order_item_id, "quantity": 1},
                {"order_item_id": order_item_id, "quantity": 1},
            ],
            "reason": "customer_return",
            "refund_payment_method": "cash",
        },
    )

    assert response.status_code == 422, response.text
    assert response.json()["detail"] == {
        "code": "REFUND_QTY_EXCEEDS_AVAILABLE",
        "available": 1,
        "requested": 2,
        "message": "La cantidad excede lo disponible para devolución (máx. 1).",
    }
    assert (
        db.query(Refund)
        .filter(Refund.tenant_id == UUID(signup["tenant_id"]), Refund.order_id == UUID(order["id"]))
        .count()
        == 0
    )


def test_duplicate_refund_lines_within_available_quantity_are_normalized(client, db):
    signup = _signup_verify_login(client, label="normalized-refund")
    _open_shift(client, label="normalized-refund")
    product = _create_product(client, label="normalized", price="5.00", track_inventory=True)
    _seed_stock(client, product_id=product["id"], quantity=2)
    order = _create_cash_order(
        client,
        items=[{"product_id": product["id"], "quantity": 2}],
        amount="10.00",
        label="normalized-refund",
    )
    order_item_id = order["items"][0]["id"]

    response = client.post(
        f"/api/v1/orders/{order['id']}/refunds",
        headers={"Idempotency-Key": f"normalized-refund-{uuid4().hex}"},
        json={
            "items": [
                {"order_item_id": order_item_id, "quantity": 1},
                {"order_item_id": order_item_id, "quantity": 1},
            ],
            "reason": "customer_return",
            "refund_payment_method": "cash",
        },
    )

    assert response.status_code == 201, response.text
    assert response.json()["refunded_amount"] == "10.00"
    assert len(response.json()["items"]) == 1
    assert response.json()["items"][0]["quantity"] == 2
    assert _order_movements(
        db,
        tenant_id=signup["tenant_id"],
        order_id=order["id"],
        product_id=product["id"],
    ) == [-2, 2]


def test_refund_uses_sale_ledger_instead_of_current_tracking_flag(client, db):
    signup = _signup_verify_login(client, label="refund-ledger")
    _open_shift(client, label="refund-ledger")
    untracked = _create_product(client, label="untracked-sale", price="10.00", track_inventory=False)
    tracked = _create_product(client, label="tracked-sale", price="20.00", track_inventory=True)
    _seed_stock(client, product_id=tracked["id"])
    order = _create_cash_order(
        client,
        items=[
            {"product_id": untracked["id"], "quantity": 1},
            {"product_id": tracked["id"], "quantity": 1},
        ],
        amount="30.00",
        label="refund-ledger",
    )
    _set_inventory_tracking(
        client, product_id=untracked["id"], enabled=True, label="untracked-sale"
    )
    _set_inventory_tracking(
        client, product_id=tracked["id"], enabled=False, label="tracked-sale"
    )

    for product in (untracked, tracked):
        order_item = next(
            item for item in order["items"] if item["product_id"] == product["id"]
        )
        response = client.post(
            f"/api/v1/orders/{order['id']}/refunds",
            headers={"Idempotency-Key": f"refund-{product['id']}-{uuid4().hex}"},
            json={
                "items": [{"order_item_id": order_item["id"], "quantity": 1}],
                "reason": "customer_return",
                "refund_payment_method": "cash",
            },
        )
        assert response.status_code == 201, response.text

    assert _order_movements(
        db,
        tenant_id=signup["tenant_id"],
        order_id=order["id"],
        product_id=untracked["id"],
    ) == []
    assert _order_movements(
        db,
        tenant_id=signup["tenant_id"],
        order_id=order["id"],
        product_id=tracked["id"],
    ) == [-1, 1]


def test_void_uses_sale_ledger_instead_of_current_tracking_flag(client, db):
    signup = _signup_verify_login(client, label="void-ledger")
    _open_shift(client, label="void-ledger")
    untracked = _create_product(client, label="void-untracked", price="10.00", track_inventory=False)
    tracked = _create_product(client, label="void-tracked", price="20.00", track_inventory=True)
    _seed_stock(client, product_id=tracked["id"])
    order = _create_cash_order(
        client,
        items=[
            {"product_id": untracked["id"], "quantity": 1},
            {"product_id": tracked["id"], "quantity": 1},
        ],
        amount="30.00",
        label="void-ledger",
    )
    _set_inventory_tracking(
        client, product_id=untracked["id"], enabled=True, label="void-untracked"
    )
    _set_inventory_tracking(
        client, product_id=tracked["id"], enabled=False, label="void-tracked"
    )

    response = client.post(
        f"/api/v1/orders/{order['id']}/void",
        headers={"Idempotency-Key": f"void-ledger-{uuid4().hex}"},
        json={"reason": "operator_error"},
    )

    assert response.status_code == 201, response.text
    assert _order_movements(
        db,
        tenant_id=signup["tenant_id"],
        order_id=order["id"],
        product_id=untracked["id"],
    ) == []
    assert _order_movements(
        db,
        tenant_id=signup["tenant_id"],
        order_id=order["id"],
        product_id=tracked["id"],
    ) == [-1, 1]


def test_order_locks_products_in_stable_uuid_order(client, monkeypatch):
    _signup_verify_login(client, label="lock-order")
    _open_shift(client, label="lock-order")
    first = _create_product(client, label="lock-first", price="10.00", track_inventory=False)
    second = _create_product(client, label="lock-second", price="20.00", track_inventory=False)

    from app.orders import repository as orders_repo

    original_get = orders_repo.get_active_product_for_update
    locked_ids = []

    def recording_get(db, *, tenant_id, product_id):
        locked_ids.append(product_id)
        return original_get(db, tenant_id=tenant_id, product_id=product_id)

    monkeypatch.setattr(orders_repo, "get_active_product_for_update", recording_get)
    cart = sorted([first, second], key=lambda product: UUID(product["id"]).int, reverse=True)

    _create_cash_order(
        client,
        items=[{"product_id": product["id"], "quantity": 1} for product in cart],
        amount="30.00",
        label="lock-order",
    )

    assert locked_ids == sorted(locked_ids, key=lambda product_id: product_id.int)
    assert set(locked_ids) == {UUID(first["id"]), UUID(second["id"])}
