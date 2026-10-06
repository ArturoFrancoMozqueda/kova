from uuid import UUID, uuid4

from app.auth.models import User
from app.tests.test_branches import _post, _setup
from app.tests.test_employee_rbac import _add_member
from app.tests.test_orders import _create_product


def _stock(client, branch):
    return client.get("/api/v1/inventory/stock", headers={"X-Kova-Branch": branch}).json()[0][
        "stock_on_hand"
    ]


def _seed(client):
    source, destination = _setup(client)
    product = _create_product(client, name="Pan", price="10.00", track_inventory=True)
    assert (
        _post(
            client,
            f"/api/v1/inventory/products/{product['id']}/adjustments",
            {"quantity_delta": 10, "reason": "Recepción"},
            source,
        ).status_code
        == 201
    )
    return source, destination, product["id"]


def test_transfer_is_atomic_idempotent_and_preserves_total(client):
    source, destination, product = _seed(client)
    payload = dict(
        source_branch_id=source,
        destination_branch_id=destination,
        product_id=product,
        quantity=4,
        reason="Reposición",
    )
    first = _post(client, "/api/v1/branches/transfers", payload, source, "transfer-replay")
    assert first.status_code == 201, first.text
    replay = _post(client, "/api/v1/branches/transfers", payload, destination, "transfer-replay")
    assert first.json() == replay.json()
    assert _stock(client, source) == 6
    assert _stock(client, destination) == 4
    assert len(client.get("/api/v1/branches/transfers").json()) == 1
    payload["quantity"] = 2
    assert (
        _post(client, "/api/v1/branches/transfers", payload, key="transfer-replay").status_code
        == 400
    )


def test_invalid_transfer_does_not_change_stock(client):
    source, destination, product = _seed(client)
    payload = dict(
        source_branch_id=source,
        destination_branch_id=destination,
        product_id=product,
        quantity=11,
        reason="Reposición",
    )
    assert _post(client, "/api/v1/branches/transfers", payload).status_code == 400
    payload["destination_branch_id"] = str(uuid4())
    payload["quantity"] = 2
    assert _post(client, "/api/v1/branches/transfers", payload).status_code == 404
    payload["destination_branch_id"] = source
    assert _post(client, "/api/v1/branches/transfers", payload).status_code == 422
    assert _stock(client, source) == 10
    assert _stock(client, destination) == 0
    assert client.get("/api/v1/branches/transfers").json() == []


def test_assigned_manager_cannot_operate_or_report_other_branches(client, db):
    source, destination, product = _seed(client)
    member = _add_member(db, tenant_id=UUID(source), role="manager")
    email = db.query(User).filter(User.id == member.user_id).one().email
    response = client.patch(
        f"/api/v1/employees/{member.id}/branch", json={"allowed_branch_id": destination}
    )
    assert response.status_code == 200, response.text
    assert response.json()["allowed_branch_id"] == destination
    client.post("/api/v1/auth/login", json={"email": email, "password": "S3cur3pass!"})
    assert (
        client.get("/api/v1/branches", headers={"X-Kova-Branch": source}).json()[0]["id"]
        == destination
    )
    assert (
        client.get("/api/v1/inventory/stock", headers={"X-Kova-Branch": source}).status_code == 403
    )
    assert (
        client.get("/api/v1/inventory/stock", headers={"X-Kova-Branch": destination}).status_code
        == 200
    )
    assert (
        client.get("/api/v1/reports/branches", headers={"X-Kova-Branch": destination}).status_code
        == 403
    )
    assert (
        _post(
            client,
            "/api/v1/branches/transfers",
            dict(
                source_branch_id=destination,
                destination_branch_id=source,
                product_id=product,
                quantity=1,
                reason="Reposición",
            ),
            destination,
        ).status_code
        == 403
    )


def test_reserved_units_cannot_be_transferred(client, db):
    from app.tests.test_customer_orders import _enable_customer_orders

    source, destination, product = _seed(client)
    _enable_customer_orders(db, UUID(source))
    created = _post(
        client,
        "/api/v1/customer-orders",
        {"items": [{"product_id": product, "quantity": 8}]},
        source,
    )
    assert created.status_code == 201, created.text
    order = created.json()
    assert (
        _post(
            client,
            f"/api/v1/customer-orders/{order['id']}/confirm",
            {"version": order["version"]},
            source,
        ).status_code
        == 200
    )
    payload = dict(
        source_branch_id=source,
        destination_branch_id=destination,
        product_id=product,
        quantity=3,
        reason="Reposición",
    )
    assert _post(client, "/api/v1/branches/transfers", payload).status_code == 400
    assert _stock(client, source) == 10
    assert _stock(client, destination) == 0
    payload["quantity"] = 2
    assert _post(client, "/api/v1/branches/transfers", payload).status_code == 201
    assert _stock(client, source) == 8
    assert _stock(client, destination) == 2


def test_offline_sync_retains_failed_origin_when_employee_is_reassigned(client, db):
    source, destination, product = _seed(client)
    member = _add_member(db, tenant_id=UUID(source), role="cashier")
    email = db.query(User).filter(User.id == member.user_id).one().email
    assigned = client.patch(
        f"/api/v1/employees/{member.id}/branch", json={"allowed_branch_id": destination}
    )
    assert assigned.status_code == 200
    client.post("/api/v1/auth/login", json={"email": email, "password": "S3cur3pass!"})
    order = {
        "items": [{"product_id": product, "quantity": 1}],
        "payments": [{"method": "manual_card", "amount": "10.00"}],
    }
    payload = {"sales": [{"client_uuid": str(uuid4()), "branch_id": source, "order": order}]}
    response = client.post(
        "/api/v1/sync/offline-sales", json=payload, headers={"X-Kova-Branch": destination}
    )
    assert response.status_code == 200, response.text
    failed = response.json()["results"][0]
    assert failed["status"] == "failed"
    assert "sucursal" in str(failed).lower()
