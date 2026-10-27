from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import jwt
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.auth.models import Membership
from app.billing.models import Subscription
from app.config import settings
from app.crm.engagement_models import CatalogRequest
from app.crm.models import ContactConsent, Opportunity
from app.customer_orders.models import CustomerOrder, InventoryReservation
from app.customers.models import Customer
from app.orders.models import Order
from app.storefront import order_tracking
from app.tenants.models import Tenant
from app.tests.test_crm_engagement import _customer, _key, _public_setup
from app.tests.test_customer_orders import _confirm, _seed, _signup_login

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def setup(client, *, quantity=2, stock=5, message=None):
    tenant, product, catalog, url, body = _public_setup(client)
    _seed(client, product["id"], stock)
    body.update(order_lines=[{"product_id": product["id"], "quantity": quantity}], origin="remote")
    if message is not None:
        body["message"] = message
    response = client.post(url, json=body)
    assert response.status_code == 201, response.text
    customer = _customer(client)
    return tenant, product, catalog, url, body, response.json(), customer


def token(receipt):
    return receipt["tracking_path"].split("#", 1)[1]


def track(client, receipt):
    response = client.post("/api/v1/public/order-tracking", json={"token": token(receipt)})
    assert response.status_code == 200, response.text
    return response.json()


def preview(client, receipt, **kwargs):
    result = client.get(f"/api/v1/crm/requests/{receipt['receipt_id']}/order-preview", **kwargs)
    assert result.status_code == 200, result.text
    return result.json()


def decision(customer, review):
    return {"customer_id": customer["id"], "expected_version": review["version"],
            "preview_fingerprint": review["preview_fingerprint"], "confirmed": True}


def accept(client, receipt, customer, review=None, headers=None, **extra):
    body = decision(customer, review or preview(client, receipt))
    return client.post(f"/api/v1/crm/requests/{receipt['receipt_id']}/accept-order",
                       headers=headers or _key(), json={**body, **extra})


def test_structured_capture_uses_backend_snapshots_and_keeps_pending_projection_private(client, db):
    tenant, product, _, url, body, receipt, _ = setup(client)
    assert set(receipt) == {"receipt_id", "status", "tracking_path", "tracking_expires_at"}
    assert receipt["tracking_path"].startswith("/seguimiento#")
    assert client.post(url, json=body).json() == receipt
    assert client.post(url, json={**body, "order_lines": [{"product_id": product["id"], "quantity": 3}]}).status_code == 409
    request = client.get("/api/v1/crm/requests").json()["requests"][0]
    assert request["origin"] == "remote"
    assert request["customer_order_id"] is None
    assert request["order_lines"] == [{"product_id": product["id"], "quantity": 2,
        "product_name": product["name"], "unit_price_amount": "25.00", "line_total_amount": "50.00"}]
    assert db.query(CustomerOrder).filter_by(tenant_id=tenant).count() == 0
    assert db.query(InventoryReservation).filter_by(tenant_id=tenant).count() == 0
    client.cookies.clear()
    result = track(client, receipt)
    assert result["status"] == "pending_review"
    assert result["folio"] is None and result["total_amount"] is None
    assert result["items"] == [{"product_name": product["name"], "quantity": 2}]
    assert set(result) == {"business_name", "branch_name", "status", "folio", "total_amount",
                           "items", "catalog_path", "updated_at", "expires_at"}
    assert body["name"] not in str(result) and body["contact"] not in str(result)


@pytest.mark.parametrize("lines,origin", [
    ([], "remote"), ([{"product_id": str(uuid4()), "quantity": 2}], "remote"),
    (None, "remote"), (None, "in_store"),
])
def test_structure_does_not_parse_legacy_text_or_accept_mismatched_products(client, lines, origin):
    _, _, _, url, body = _public_setup(client)
    result = client.post(url, json={**body, "order_lines": lines, "origin": origin})
    assert result.status_code == 422


@pytest.mark.parametrize("quantity", [0, -1, 100, True, "2", 1.5])
def test_quantities_are_bounded_integers_and_client_prices_are_never_accepted(client, quantity):
    _, product, _, url, body = _public_setup(client)
    line = {"product_id": product["id"], "quantity": quantity}
    assert client.post(url, json={**body, "order_lines": [line], "origin": "in_store"}).status_code == 422
    assert client.post(url, json={**body, "order_lines": [{**line, "quantity": 1, "unit_price_amount": "0.01"}], "origin": "remote"}).status_code == 422


def test_acceptance_is_atomic_replay_safe_explicit_and_does_not_reserve_or_create_income(client, db):
    tenant, _, _, url, body, receipt, customer = setup(client)
    review = preview(client, receipt)
    assert review["can_accept"] and review["total_amount"] == "50.00"
    assert review["items"][0]["available_quantity"] == 5
    headers = _key()
    result = accept(client, receipt, customer, review, headers)
    assert result.status_code == 201, result.text
    request, order = result.json()["request"], result.json()["customer_order"]
    assert request["status"] == "accepted" and request["version"] == 2
    assert request["customer_order_id"] == order["id"]
    assert request["customer_id"] == order["customer_id"] == customer["id"]
    assert order["status"] == "new" and order["payment_status"] == "unpaid"
    assert order["total_amount"] == "50.00"
    assert order["note"] == "Pedido desde el menú digital"
    assert receipt["receipt_id"] not in order["note"]
    assert order["menu_request_message"] == body["message"]
    detail = client.get(f"/api/v1/customer-orders/{order['id']}")
    assert detail.status_code == 200
    assert detail.json()["menu_request_message"] == body["message"]
    assert accept(client, receipt, customer, review, headers).json() == result.json()
    assert accept(client, receipt, customer, review).status_code == 409
    assert db.query(CustomerOrder).filter_by(tenant_id=tenant).count() == 1
    for model in (InventoryReservation, Order, Opportunity, ContactConsent):
        assert db.query(model).filter_by(tenant_id=tenant).count() == 0
    assert client.post(url, json=body).json() == receipt
    assert track(client, receipt)["status"] == "accepted"
    confirmed = _confirm(client, order)
    assert confirmed.status_code == 200
    assert track(client, receipt)["status"] == "confirmed"
    assert db.query(InventoryReservation).filter_by(tenant_id=tenant, status="active").one().quantity == 2


def test_prices_stock_and_inactive_products_require_a_new_review_before_accepting(client, db):
    tenant, product, _, _, _, receipt, customer = setup(client)
    review = preview(client, receipt)
    changed = client.patch(f"/api/v1/catalog/products/{product['id']}", headers=_key(), json={"price_amount": "30.00"})
    assert changed.status_code == 200
    assert accept(client, receipt, customer, review).status_code == 409
    assert db.query(CustomerOrder).filter_by(tenant_id=tenant).count() == 0
    refreshed = preview(client, receipt)
    assert refreshed["total_amount"] == "60.00"
    _seed(client, product["id"], -5)
    assert accept(client, receipt, customer, refreshed).status_code == 409
    unavailable = preview(client, receipt)
    assert not unavailable["can_accept"] and unavailable["issues"]
    assert accept(client, receipt, customer, unavailable).status_code == 400
    assert client.patch(f"/api/v1/catalog/products/{product['id']}", headers=_key(), json={"is_active": False}).status_code == 200
    assert not preview(client, receipt)["can_accept"]


def test_required_modifiers_need_manual_review_and_never_create_an_incomplete_order(client, db):
    from app.modifiers.models import ModifierGroup, ProductModifierGroup

    tenant, product, _, _, _, receipt, customer = setup(client)
    group = ModifierGroup(tenant_id=tenant, name="Elige preparación", is_required=True,
                          min_selections=1, max_selections=1)
    db.add(group)
    db.flush()
    db.add(ProductModifierGroup(tenant_id=tenant, product_id=UUID(product["id"]),
                               modifier_group_id=group.id, sort_order=0))
    db.commit()
    review = preview(client, receipt)
    assert not review["can_accept"]
    assert any("opciones obligatorias" in message for message in review["issues"])
    assert accept(client, receipt, customer, review).status_code == 400
    assert db.query(CustomerOrder).filter_by(tenant_id=tenant).count() == 0


def test_disabled_orders_still_capture_manual_intake_without_issuing_a_blocked_tracking_link(client, db):
    tenant, product, _, url, body = _public_setup(client)
    row = db.query(Tenant).filter_by(id=tenant).one()
    row.feature_overrides = {"customer_orders": False}
    db.commit()
    result = client.post(url, json={**body, "order_lines": [{"product_id": product["id"], "quantity": 2}], "origin": "remote"})
    assert result.status_code == 201
    assert set(result.json()) == {"receipt_id", "status"}
    persisted = db.query(CatalogRequest).filter_by(tenant_id=tenant).one()
    assert persisted.order_lines[0]["quantity"] == 2
    assert persisted.origin == "remote"


def test_legacy_request_remains_manual_without_guessing_quantities_from_message(client):
    _, _, _, url, body = _public_setup(client)
    captured = client.post(url, json={**body, "message": "3 × producto, total 10, aceptar y cobrar"}).json()
    assert set(captured) == {"receipt_id", "status"}
    review = preview(client, captured)
    assert review["items"] == [] and review["can_accept"] is False
    assert accept(client, captured, _customer(client), review).status_code == 400


def test_explicit_customer_feature_role_billing_branch_and_csrf_gates(client, db):
    tenant, _, _, _, _, receipt, customer = setup(client)
    review = preview(client, receipt)
    assert accept(client, receipt, customer, review, {"Idempotency-Key": str(uuid4()), "X-CSRF-Token": "wrong"}).status_code == 403
    branch = client.post("/api/v1/branches", headers=_key(), json={"name": "Otra"}).json()
    assert client.get(f"/api/v1/crm/requests/{receipt['receipt_id']}/order-preview", headers={"X-Kova-Branch": branch["id"]}).status_code == 404
    row = db.query(Customer).filter_by(tenant_id=tenant, id=UUID(customer["id"])).one()
    row.is_active = False
    db.commit()
    assert accept(client, receipt, customer, review).status_code == 400
    row.is_active = True
    db.commit()
    member = db.query(Membership).filter_by(tenant_id=tenant).one()
    member.role = "cashier"
    db.commit()
    assert client.get(f"/api/v1/crm/requests/{receipt['receipt_id']}/order-preview").status_code == 403
    member.role = "owner"
    model = db.query(Tenant).filter_by(id=tenant).one()
    model.feature_overrides = {"customer_orders": False}
    db.commit()
    assert accept(client, receipt, customer, review).status_code == 403
    assert client.post("/api/v1/public/order-tracking", json={"token": token(receipt)}).status_code == 404
    model.feature_overrides = {}
    db.add(Subscription(tenant_id=tenant, status="canceled"))
    db.commit()
    assert accept(client, receipt, customer, review).status_code == 402
    assert client.post("/api/v1/public/order-tracking", json={"token": token(receipt)}).status_code == 404


def test_tracking_reflects_real_preparation_delivery_and_cancellation_without_payment_claims(client):
    _, _, _, _, _, receipt, customer = setup(client)
    accepted = accept(client, receipt, customer).json()["customer_order"]
    order = _confirm(client, accepted).json()
    for state in ("in_progress", "ready"):
        changed = client.post(f"/api/v1/customer-orders/{order['id']}/status", headers=_key(), json={"version": order["version"], "status": state})
        assert changed.status_code == 200, changed.text
        order = changed.json()
        assert track(client, receipt)["status"] == state
    checkout = client.post(f"/api/v1/customer-orders/{order['id']}/checkout", headers=_key(), json={"version": order["version"], "payments": [{"method": "manual_card", "amount": "50.00"}]})
    assert checkout.status_code == 201, checkout.text
    order = checkout.json()["customer_order"]
    fulfilled = client.post(f"/api/v1/customer-orders/{order['id']}/status", headers=_key(), json={"version": order["version"], "status": "fulfilled"})
    assert fulfilled.status_code == 200, fulfilled.text
    public = track(client, receipt)
    assert public["status"] == "fulfilled" and public["total_amount"] == "50.00"
    assert not any("payment" in field or "customer" in field for field in public)
    other = setup(client)[5:]
    other_receipt, other_customer = other
    new_order = accept(client, other_receipt, other_customer).json()["customer_order"]
    cancelled = client.post(f"/api/v1/customer-orders/{new_order['id']}/cancel", headers=_key(), json={"version": 1, "reason": "customer_request"})
    assert cancelled.status_code == 200
    assert track(client, other_receipt)["status"] == "cancelled"


def test_tracking_survives_menu_withdrawal_but_rejects_tampering_and_cross_purpose_tokens(client, db, monkeypatch):
    tenant, _, _, _, _, receipt, _ = setup(client)
    from app.storefront.models import PublicCatalog

    db.query(PublicCatalog).filter_by(tenant_id=tenant).one().enabled = False
    db.commit()
    assert track(client, receipt)["catalog_path"] is None
    claims = jwt.decode(token(receipt), settings.secret_key, algorithms=["HS256"], audience=order_tracking.AUDIENCE)
    now = datetime.now(UTC)
    invalid = ["wrong", token(receipt).rsplit(".", 1)[0] + ".tampered", "x" * 2001]
    for override in ({"aud": "kova-loyalty-card"}, {"request": "not-uuid"}, {"submission": None},
                     {"iat": now - timedelta(days=31), "exp": now - timedelta(days=1)}):
        invalid.append(jwt.encode({**claims, **override}, settings.secret_key, algorithm="HS256"))
    def no_context(*args):
        pytest.fail("Invalid tracking token reached the database")
    monkeypatch.setattr(order_tracking, "set_tenant_context", no_context)
    for bad in invalid:
        response = client.post("/api/v1/public/order-tracking", json={"token": bad})
        assert response.status_code == 404 and response.json() == {"detail": order_tracking.UNAVAILABLE}


def test_tracking_and_request_capability_cannot_authorize_session_or_another_request(client):
    _, _, _, _, _, receipt, _ = setup(client)
    client.cookies.clear()
    response = client.post("/api/v1/public/order-tracking", json={"token": token(receipt)})
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["X-Robots-Tag"] == "noindex, nofollow"
    assert not response.headers.get("set-cookie")
    client.cookies.set("access_token", token(receipt))
    assert client.get("/api/v1/crm/requests").status_code == 401


def test_cross_tenant_requests_customers_and_runtime_structure_are_isolated(client, db, kova_app_engine):
    from app.db import set_tenant_context

    tenant, _, _, _, _, receipt, customer = setup(client)
    review = preview(client, receipt)
    owner_cookies = dict(client.cookies)
    foreign = _signup_login(client, prefix="foreign-intake")
    foreign_customer = _customer(client)
    assert client.get(f"/api/v1/crm/requests/{receipt['receipt_id']}/order-preview").status_code == 404
    assert accept(client, receipt, foreign_customer, review).status_code == 404
    client.cookies.clear()
    client.cookies.update(owner_cookies)
    assert accept(client, receipt, foreign_customer, review).status_code == 404
    db.execute(text("SET LOCAL ROLE kova_app"))
    try:
        set_tenant_context(db, tenant)
        public = order_tracking.read(db, token(receipt))
        assert public.status == "pending_review"
        for field in ("order_lines", "origin", "message", "product_ids"):
            with pytest.raises(DBAPIError), db.begin_nested():
                db.execute(text(f"UPDATE crm_catalog_requests SET {field}={field} WHERE id=:id"), {"id": receipt["receipt_id"]})
        set_tenant_context(db, foreign)
        assert db.query(CatalogRequest).filter_by(id=UUID(receipt["receipt_id"])).count() == 0
    finally:
        db.execute(text("RESET ROLE"))


def test_mid_conversion_failure_rolls_back_order_and_both_idempotency_records(client, db, monkeypatch):
    from app.crm import engagement

    tenant, _, _, _, _, receipt, customer = setup(client)
    review = preview(client, receipt)
    original = engagement._finish
    def fail(*args, **kwargs):
        raise RuntimeError("Simulated lost transaction before linking response")
    monkeypatch.setattr(engagement, "_finish", fail)
    with pytest.raises(RuntimeError):
        accept(client, receipt, customer, review)
    db.rollback()
    monkeypatch.setattr(engagement, "_finish", original)
    assert db.query(CustomerOrder).filter_by(tenant_id=tenant).count() == 0
    assert db.query(CatalogRequest).filter_by(id=UUID(receipt["receipt_id"])).one().status == "new"


def test_runtime_acceptance_preserves_rls_and_rejects_cross_branch_order_link(client, db, kova_app_engine):
    from app.crm import order_intake
    from app.crm.engagement_schemas import CatalogOrderAccept
    from app.db import set_tenant_context

    tenant, _, _, _, _, receipt, customer = setup(client)
    review = preview(client, receipt)
    db.execute(text("SET LOCAL ROLE kova_app"))
    try:
        set_tenant_context(db, tenant)
        status, result = order_intake.accept(db, tenant,
            db.query(Membership).filter_by(tenant_id=tenant).one().user_id,
            UUID(receipt["receipt_id"]), CatalogOrderAccept(**decision(customer, review)), str(uuid4()))
        assert status == 201 and result["customer_order"]["status"] == "new"
        assert order_tracking.read(db, token(receipt)).status == "accepted"
        assert db.execute(text("SELECT current_user")).scalar() == "kova_app"
    finally:
        db.execute(text("RESET ROLE"))
    branch = client.post("/api/v1/branches", headers=_key(), json={"name": "Sucursal ajena al pedido"}).json()
    other_id = uuid4()
    db.execute(text("INSERT INTO customer_orders(id,tenant_id,branch_id,folio,status,fulfillment_type,source_channel,subtotal_amount,total_amount,created_at,updated_at) VALUES(:id,:tenant,:branch,'PED-FOREIGN','new','pickup','counter',1,1,now(),now())"),
               {"id": other_id, "tenant": tenant, "branch": branch["id"]})
    db.flush()
    with pytest.raises(DBAPIError), db.begin_nested():
        db.execute(text("UPDATE crm_catalog_requests SET customer_order_id=:order WHERE id=:request"),
                   {"order": other_id, "request": receipt["receipt_id"]})


@pytest.fixture
def committed_intake(owner_engine):
    from sqlalchemy.orm import Session

    from app.branches.scope import bind_branch
    from app.catalog.models import Product
    from app.crm import engagement
    from app.crm.engagement_schemas import PublicRequestWrite
    from app.db import set_tenant_context
    from app.storefront.models import PublicCatalog, PublicCatalogItem

    tenant, user, customer, product, catalog = (uuid4() for _ in range(5))
    with Session(owner_engine) as db:
        db.add(Tenant(id=tenant, name="Concurrent intake", slug=f"intake-{tenant}"))
        db.flush()
        db.execute(text("INSERT INTO users(id,email,hashed_password,is_email_verified) VALUES(:id,:email,'test-only',true)"),
                   {"id": user, "email": f"intake-{tenant}@example.com"})
        db.add(Membership(tenant_id=tenant, user_id=user, role="owner", created_at=datetime.now(UTC)))
        db.add(Customer(id=customer, tenant_id=tenant, name="Concurrent buyer"))
        db.add(Product(id=product, tenant_id=tenant, name="Concurrent product", price_amount=25,
                       track_inventory=False))
        db.add(PublicCatalog(id=catalog, tenant_id=tenant, branch_id=tenant, title="Concurrent menu",
                             enabled=True, version=1, link_version=1))
        db.flush()
        db.add(PublicCatalogItem(tenant_id=tenant, catalog_id=catalog, product_id=product))
        db.commit()
        set_tenant_context(db, tenant)
        bind_branch(db, tenant_id=tenant)
        receipt = engagement.capture_request(db, db.get(PublicCatalog, catalog), PublicRequestWrite(
            submission_id=uuid4(), name="Concurrent visitor", contact="test@example.com", message="Two",
            product_ids=[product], order_lines=[{"product_id": product, "quantity": 2}], origin="remote"))
    try:
        yield tenant, user, customer, UUID(receipt["receipt_id"])
    finally:
        with owner_engine.begin() as conn:
            for table in ("crm_catalog_requests", "customer_order_item_modifiers", "customer_order_items",
                          "inventory_reservations", "customer_orders", "public_catalog_items",
                          "public_catalogs", "products", "customers", "idempotency_keys", "audit_logs",
                          "memberships", "branches"):
                conn.execute(text(f"DELETE FROM {table} WHERE tenant_id=:tenant"), {"tenant": tenant})
            conn.execute(text("DELETE FROM tenants WHERE id=:id"), {"id": tenant})
            conn.execute(text("DELETE FROM users WHERE id=:id"), {"id": user})


@pytest.mark.parametrize("same_key", [False, True])
def test_concurrent_acceptance_creates_exactly_one_order(committed_intake, kova_app_engine, same_key):
    from concurrent.futures import ThreadPoolExecutor

    from fastapi import HTTPException
    from sqlalchemy.orm import Session

    from app.branches.scope import bind_branch
    from app.crm import order_intake
    from app.crm.engagement_schemas import CatalogOrderAccept
    from app.db import set_tenant_context

    tenant, user, customer, request_id = committed_intake
    with Session(kova_app_engine) as db:
        set_tenant_context(db, tenant)
        bind_branch(db, tenant_id=tenant)
        review = order_intake.preview(db, tenant, request_id)
    body = CatalogOrderAccept(expected_version=1, customer_id=customer,
                              preview_fingerprint=review["preview_fingerprint"], confirmed=True)
    shared_key = str(uuid4())
    def execute(index):
        with Session(kova_app_engine) as db:
            set_tenant_context(db, tenant)
            bind_branch(db, tenant_id=tenant)
            try:
                return order_intake.accept(db, tenant, user, request_id, body,
                                           shared_key if same_key else str(uuid4()))[0]
            except HTTPException as exc:
                db.rollback()
                return exc.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(execute, range(2))) == ([201, 201] if same_key else [201, 409])
    with Session(kova_app_engine) as db:
        set_tenant_context(db, tenant)
        bind_branch(db, tenant_id=tenant)
        assert db.query(CustomerOrder).filter_by(tenant_id=tenant).count() == 1
        assert db.query(InventoryReservation).filter_by(tenant_id=tenant).count() == 0
        assert db.query(CatalogRequest).filter_by(tenant_id=tenant).one().status == "accepted"


def test_original_menu_instructions_remain_private_and_visible_through_preparation(client, db):
    message = "\n".join(["Sin calentar, por favor."] * 30)
    tenant, _, _, _, _, receipt, customer = setup(client, message=message)
    response = accept(client, receipt, customer)
    assert response.status_code == 201, response.text
    order = response.json()["customer_order"]
    assert order["menu_request_message"] == message
    assert _confirm(client, order).json()["menu_request_message"] == message
    detail = client.get(f"/api/v1/customer-orders/{order['id']}")
    assert detail.json()["menu_request_message"] == message
    assert "menu_request_message" not in track(client, receipt)
    assert message not in str(track(client, receipt))
    member = db.query(Membership).filter_by(tenant_id=tenant).one()
    member.role = "cashier"
    db.commit()
    assert client.get(f"/api/v1/customer-orders/{order['id']}").json()["menu_request_message"] == message
    assert client.get(f"/api/v1/crm/requests/{receipt['receipt_id']}/order-preview").status_code == 403
    _signup_login(client, prefix="foreign-menu-instructions")
    assert client.get(f"/api/v1/customer-orders/{order['id']}").status_code == 404
