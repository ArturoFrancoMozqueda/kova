"""Real PostgreSQL/domain regressions for plan gates and preserved commitments."""

import io
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from PIL import Image

from app.assistant import tools as assistant_tools
from app.auth.models import Membership
from app.billing.models import Subscription
from app.billing.plans import PLANS
from app.billing.schemas import BILLING_PERIOD_FRESHNESS_MAX_AGE
from app.branches.models import Branch
from app.catalog.models import Product, ProductImageFile
from app.config import settings
from app.crm.engagement_models import CatalogRequest
from app.customer_orders.models import CustomerOrder
from app.loyalty import service as loyalty_service
from app.loyalty.models import LoyaltyEntry, LoyaltyMember, LoyaltyRewardRedemption
from app.orders.models import Order
from app.purchasing.models import PurchaseOrder, Supplier
from app.quotes.models import CustomerQuote
from app.tenants.models import Tenant
from app.tests.test_customer_orders import _create as create_customer_order
from app.tests.test_customer_orders import _seed as seed_inventory
from app.tests.test_loyalty import account as loyalty_account
from app.tests.test_loyalty import policy as save_loyalty_policy
from app.tests.test_loyalty_enrollment import bootstrap, join
from app.tests.test_loyalty_enrollment import prepare as prepare_enrollment
from app.tests.test_loyalty_rewards import checkout as reward_checkout
from app.tests.test_loyalty_rewards import checkout_body, program
from app.tests.test_order_intake_tracking import accept as accept_request
from app.tests.test_order_intake_tracking import preview as preview_request
from app.tests.test_order_intake_tracking import setup as prepare_request
from app.tests.test_orders import (
    _create_cash_order,
    _create_product,
    _open_shift,
    _signup_verify_login,
)
from app.tests.test_purchasing import post as purchase_post
from app.tests.test_quotes import action as quote_action
from app.tests.test_quotes import create as create_quote
from app.tests.test_quotes import setup as prepare_quotes

pytestmark = pytest.mark.usefixtures("fast_business_auth")


@pytest.fixture(autouse=True)
def disabled_new_offers(monkeypatch):
    # Existing assignments must remain restricted even when new enrollment is off.
    monkeypatch.setattr(settings, "billing_tiered_plans_enabled", False)


def _assign_plan(db, tenant_id, plan="esencial"):
    tenant = db.get(Tenant, tenant_id)
    tenant.billing_cohort = "tiered"
    subscription = db.query(Subscription).filter_by(tenant_id=tenant_id).one_or_none()
    if subscription is None:
        subscription = Subscription(tenant_id=tenant_id)
        db.add(subscription)
    now = datetime.now(UTC)
    subscription.plan_code = plan
    subscription.plan_name = PLANS[plan].name
    subscription.amount_minor_units = PLANS[plan].amount_minor_units
    subscription.status = "active"
    subscription.stripe_subscription_id = f"sub_boundary_{tenant_id.hex}"
    subscription.stripe_price_id = f"price_boundary_{plan}"
    subscription.current_period_start = now - timedelta(days=1)
    subscription.current_period_end = now + timedelta(days=29)
    subscription.stripe_period_synced_at = now
    subscription.plan_effective_until = subscription.current_period_end
    subscription.complimentary_access = False
    db.commit()
    return subscription


def _signup(client):
    data = _signup_verify_login(
        client, f"commercial-boundary-{uuid4().hex}@example.com", "Planes de prueba"
    )
    return UUID(data["tenant_id"])


def _blocked(response, feature):
    assert response.status_code == 403, response.text
    assert response.json()["detail"]["reason"] == "plan_feature_required"
    assert response.json()["detail"]["feature"] == feature


@pytest.mark.parametrize("courtesy", [False, True])
def test_standard_and_permanent_courtesy_keep_their_committed_scope(client, db, courtesy):
    tenant_id = _signup(client)
    if courtesy:
        tenant = db.get(Tenant, tenant_id)
        tenant.created_at = datetime.now(UTC) - timedelta(days=60)
        tenant.billing_cohort = "tiered"
        db.add(Subscription(
            tenant_id=tenant_id, status="incomplete", complimentary_access=True,
            plan_code="standard",
        ))
        db.commit()
    session = client.get("/api/v1/auth/session")
    assert session.status_code == 200, session.text
    access = session.json()["commercial_access"]
    assert access["allowed"] is True
    assert access["plan_code"] == "standard"
    assert "purchasing" in access["features"]
    if courtesy:
        assert access["reason"] == "complimentary"
        # The grant is permanent; authorization cached by an offline device still expires.
        offline_until = datetime.fromisoformat(access["valid_until"].replace("Z", "+00:00"))
        assert datetime.now(UTC) < offline_until
        assert offline_until <= datetime.now(UTC) + BILLING_PERIOD_FRESHNESS_MAX_AGE
    assert client.get("/api/v1/reports/business-story").status_code == 200
    created = purchase_post(client, "suppliers", {"name": "Proveedor permitido"})
    assert created.status_code == 201, created.text


def test_esencial_blocks_new_commercial_operations_but_keeps_history_and_commitments(client, db):
    tenant_id, customer, product = prepare_quotes(client, db)
    seed_inventory(client, product["id"], 10)
    supplier = purchase_post(client, "suppliers", {"name": "Proveedor previo"})
    assert supplier.status_code == 201, supplier.text
    purchase_payload = {
        "supplier_id": supplier.json()["id"],
        "items": [{"product_id": product["id"], "quantity": 3, "unit_cost": "5.00"}],
    }
    purchase = purchase_post(client, "orders", purchase_payload)
    assert purchase.status_code == 201, purchase.text
    customer_order = create_customer_order(client, product["id"])
    assert customer_order.status_code == 201, customer_order.text
    quote = create_quote(client, customer, product)
    assert quote.status_code == 201, quote.text
    before = (
        db.query(Supplier).filter_by(tenant_id=tenant_id).count(),
        db.query(PurchaseOrder).filter_by(tenant_id=tenant_id).count(),
        db.query(CustomerOrder).filter_by(tenant_id=tenant_id).count(),
        db.query(CustomerQuote).filter_by(tenant_id=tenant_id).count(),
    )
    _assign_plan(db, tenant_id)

    _blocked(purchase_post(client, "suppliers", {"name": "Proveedor nuevo"}), "purchasing")
    _blocked(purchase_post(client, "orders", purchase_payload), "purchasing")
    _blocked(create_customer_order(client, product["id"]), "customer_orders")
    _blocked(create_quote(client, customer, product), "quotes")
    assert (
        db.query(Supplier).filter_by(tenant_id=tenant_id).count(),
        db.query(PurchaseOrder).filter_by(tenant_id=tenant_id).count(),
        db.query(CustomerOrder).filter_by(tenant_id=tenant_id).count(),
        db.query(CustomerQuote).filter_by(tenant_id=tenant_id).count(),
    ) == before
    assert client.get("/api/v1/purchasing/suppliers").json()[0]["id"] == supplier.json()["id"]
    assert client.get("/api/v1/purchasing/orders").json()[0]["id"] == purchase.json()["id"]
    assert client.get(f"/api/v1/customer-orders/{customer_order.json()['id']}").status_code == 200
    assert client.get("/api/v1/quotes").json()["items"][0]["id"] == quote.json()["id"]

    received = purchase_post(client, f"orders/{purchase.json()['id']}/receive", {
        "items": [{"item_id": purchase.json()["items"][0]["id"], "quantity": 1}]
    })
    assert received.status_code == 200, received.text
    assert received.json()["items"][0]["received_quantity"] == 1
    assert purchase_post(client, f"orders/{purchase.json()['id']}/cancel", {}).status_code == 200
    assert quote_action(client, quote.json(), "cancel").status_code == 200
    edit = client.patch(
        f"/api/v1/customer-orders/{customer_order.json()['id']}",
        headers={"Idempotency-Key": str(uuid4())},
        json={"version": customer_order.json()["version"],
              "items": [{"product_id": product["id"], "quantity": 3}]},
    )
    _blocked(edit, "customer_orders")


def test_esencial_basic_reports_and_dashboard_show_real_sales_without_advanced_data(client, db):
    tenant_id = _signup(client)
    _assign_plan(db, tenant_id)
    product = _create_product(client)
    _open_shift(client)
    sale = _create_cash_order(client, product["id"], key=str(uuid4()))
    assert sale.status_code == 201, sale.text
    summary = client.get("/api/v1/reports/sales-summary")
    assert summary.status_code == 200, summary.text
    assert Decimal(summary.json()["net_sales"]) == Decimal("37.00")
    assert client.get("/api/v1/reports/payment-breakdown").status_code == 200
    assert client.get("/api/v1/reports/top-products").status_code == 200
    _blocked(client.get("/api/v1/reports/business-story"), "advanced_reports")
    _blocked(client.get("/api/v1/inventory/velocity"), "advanced_reports")
    dashboard = client.get("/api/v1/reports/dashboard")
    assert dashboard.status_code == 200, dashboard.text
    body = dashboard.json()
    assert body["story"] is None
    assert body["advanced_reports_available"] is False
    assert Decimal(body["summary"]["net_sales"]) == Decimal("37.00")
    assert body["summary"]["order_count"] == 1
    assert body["hourly"] == []
    receipt = client.get(f"/api/v1/orders/{sale.json()['id']}/receipt")
    assert receipt.status_code == 200, receipt.text
    assert Decimal(receipt.json()["total_amount"]) == Decimal("37.00")


def test_assistant_cannot_reveal_excluded_analysis_through_a_second_surface(client, db):
    tenant_id = _signup(client)
    _assign_plan(db, tenant_id)
    member = db.query(Membership).filter_by(tenant_id=tenant_id).one()
    for tool in ("get_inventory", "compare_branches"):
        with pytest.raises(HTTPException) as caught:
            assistant_tools.call(db, tenant_id, member.user_id, tool, {})
        assert caught.value.status_code == 403
        assert caught.value.detail["reason"] == "plan_feature_required"
    result = assistant_tools.call(db, tenant_id, member.user_id, "get_sales", {})
    assert result["order_count"] == 0


def _png(length):
    image = io.BytesIO()
    Image.new("RGB", (6, 4), "red").save(image, "PNG")
    raw = image.getvalue()
    assert len(raw) <= length
    return raw.ljust(length, b"\0")


def _upload(client, product, data, *, branch_id=None):
    return client.post(
        f"/api/v1/catalog/products/{product['id']}/image",
        files={"file": ("foto.png", data, "image/png")},
        headers={"X-Kova-Branch": branch_id} if branch_id else {},
    )


def test_image_capacity_counts_the_tenant_across_branches_not_other_tenants(client, db, monkeypatch):
    # Scale only the configured allowance to exercise real uploads without allocating 250 MB.
    monkeypatch.setitem(PLANS, "esencial", replace(PLANS["esencial"], product_image_bytes=400))
    tenant_id = _signup(client)
    first = _create_product(client, name="Primera imagen")
    second = _create_product(client, name="Segunda imagen")
    third = _create_product(client, name="Imagen sobre cuota")
    branch = client.post("/api/v1/branches", headers={"Idempotency-Key": str(uuid4())},
                         json={"name": "Sucursal histórica"})
    assert branch.status_code == 201, branch.text
    foreign_tenant, foreign_product = uuid4(), uuid4()
    db.add(Tenant(id=foreign_tenant, name="Otro negocio sintético", slug=f"image-{uuid4().hex}"))
    db.flush()
    db.add(Product(id=foreign_product, tenant_id=foreign_tenant, name="Foto ajena", price_amount=10))
    db.flush()
    db.add(ProductImageFile(tenant_id=foreign_tenant, product_id=foreign_product,
                            content_type="image/png", bytes_data=_png(500), byte_size=500))
    db.commit()
    _assign_plan(db, tenant_id)

    first_upload = _upload(client, first, _png(300))
    assert first_upload.status_code == 200, first_upload.text
    second_upload = _upload(client, second, _png(100), branch_id=branch.json()["id"])
    assert second_upload.status_code == 200, second_upload.text
    overflow = _upload(client, third, _png(100))
    assert overflow.status_code == 403, overflow.text
    assert overflow.json()["detail"]["reason"] == "plan_limit_reached"
    assert db.query(ProductImageFile).filter_by(tenant_id=tenant_id).count() == 2
    assert sum(row.byte_size for row in db.query(ProductImageFile).filter_by(tenant_id=tenant_id)) == 400


def test_existing_images_can_shrink_or_stay_same_size_above_new_plan_capacity(client, db, monkeypatch):
    monkeypatch.setitem(PLANS, "esencial", replace(PLANS["esencial"], product_image_bytes=400))
    monkeypatch.setitem(PLANS, "gestion", replace(PLANS["gestion"], product_image_bytes=1000))
    tenant_id = _signup(client)
    products = [_create_product(client, name=f"Imagen {i}") for i in range(3)]
    _assign_plan(db, tenant_id, "gestion")
    assert _upload(client, products[0], _png(400)).status_code == 200
    assert _upload(client, products[1], _png(200)).status_code == 200
    _assign_plan(db, tenant_id)
    assert _upload(client, products[0], _png(350)).status_code == 200
    assert _upload(client, products[0], _png(350)).status_code == 200
    assert _upload(client, products[0], _png(351)).status_code == 403
    assert _upload(client, products[2], _png(100)).status_code == 403
    stored = db.query(ProductImageFile).filter_by(tenant_id=tenant_id).all()
    assert len(stored) == 2 and sum(row.byte_size for row in stored) == 550
    deleted = client.delete(f"/api/v1/catalog/products/{products[1]['id']}/image")
    assert deleted.status_code == 204, deleted.text
    assert client.get("/api/v1/inventory/stock").status_code == 200


def test_menu_stays_public_but_new_requests_and_loyalty_enrollment_are_blocked(client, db):
    tenant_id, _, menu = prepare_enrollment(client)
    client.cookies.clear()
    pre_downgrade_context = bootstrap(client, menu).json()
    assert pre_downgrade_context["available"] is True
    _assign_plan(db, tenant_id)
    public_menu = client.get(f"/api/v1/public/catalog/{menu}")
    assert public_menu.status_code == 200, public_menu.text
    assert public_menu.json()["products"]
    assert public_menu.json()["checkout_available"] is False
    assert public_menu.json()["requests_available"] is False
    assert public_menu.json()["loyalty_available"] is False
    request = client.post(f"/api/v1/public/catalog/{menu}/requests", json={
        "submission_id": str(uuid4()), "name": "Cliente sintético",
        "contact": "contacto@example.com", "message": "Solicitud de prueba",
        "product_ids": [],
    })
    _blocked(request, "customer_orders")
    joined = join(client, menu, pre_downgrade_context)
    # Public enrollment preserves its existing opaque response for an unavailable program.
    assert joined.status_code == 404, joined.text
    assert db.query(CatalogRequest).filter_by(tenant_id=tenant_id).count() == 0
    assert db.query(LoyaltyMember).filter_by(tenant_id=tenant_id).count() == 0
    latest_context = bootstrap(client, menu).json()
    assert latest_context["available"] is False


def test_earned_rewards_and_reversals_survive_without_new_accrual_after_downgrade(client, db):
    tenant_id, customer, product, benefit = program(client)
    _assign_plan(db, tenant_id)
    assert loyalty_account(client, customer)["balance"] == 10
    _blocked(save_loyalty_policy(client, version=1), "loyalty")
    body = checkout_body(customer, product, benefit)
    operation = {"Idempotency-Key": str(uuid4())}
    redeemed = reward_checkout(client, body, headers=operation)
    assert redeemed.status_code == 201, redeemed.text
    assert reward_checkout(client, body, headers=operation).json() == redeemed.json()
    assert loyalty_account(client, customer)["balance"] == 5
    assert loyalty_service.process(db, tenant_id) == 0
    db.commit()
    assert db.query(LoyaltyEntry).filter_by(tenant_id=tenant_id, kind="accrual").count() == 1
    assert db.query(LoyaltyRewardRedemption).filter_by(tenant_id=tenant_id).count() == 1
    refund_body = {
        "items": [{"order_item_id": redeemed.json()["items"][0]["id"], "quantity": 2}],
        "reason": "customer_return", "refund_payment_method": "cash",
    }
    refund_key = {"Idempotency-Key": str(uuid4())}
    refund = client.post(f"/api/v1/orders/{redeemed.json()['id']}/refunds",
                         headers=refund_key, json=refund_body)
    assert refund.status_code == 201, refund.text
    assert client.post(f"/api/v1/orders/{redeemed.json()['id']}/refunds",
                       headers=refund_key, json=refund_body).json() == refund.json()
    assert loyalty_account(client, customer)["balance"] == 10
    assert db.query(LoyaltyEntry).filter_by(tenant_id=tenant_id, kind="reward_return").count() == 1
    original = db.query(Order).filter(Order.tenant_id == tenant_id,
                                     Order.id != UUID(redeemed.json()["id"])).one()
    old_sale = client.get(f"/api/v1/orders/{original.id}").json()
    old_refund = client.post(f"/api/v1/orders/{original.id}/refunds",
                            headers={"Idempotency-Key": str(uuid4())}, json={
                                **refund_body,
                                "items": [{"order_item_id": old_sale["items"][0]["id"],
                                           "quantity": 4}],
                            })
    assert old_refund.status_code == 201, old_refund.text
    assert loyalty_service.process(db, tenant_id) == 1
    db.commit()
    assert loyalty_account(client, customer)["balance"] == 0
    assert db.query(LoyaltyEntry).filter_by(tenant_id=tenant_id, kind="accrual").count() == 1


def test_delayed_points_follow_the_server_sale_snapshot_across_plan_changes(client, db):
    tenant_id, customer, product, _ = program(client)

    def sell():
        response = client.post(
            "/api/v1/orders",
            headers={"Idempotency-Key": str(uuid4())},
            json={
                "customer_id": str(customer),
                "items": [{"product_id": product["id"], "quantity": 2}],
                "payments": [{"method": "cash", "amount": "50.00",
                              "amount_tendered": "50.00"}],
            },
        )
        assert response.status_code == 201, response.text
        return db.get(Order, UUID(response.json()["id"]))

    earned_before_downgrade = sell()
    assert earned_before_downgrade.loyalty_eligible is True
    _assign_plan(db, tenant_id)
    excluded_sale = sell()
    assert excluded_sale.loyalty_eligible is False
    # A delayed job still materializes rights earned while the program was included.
    assert loyalty_service.process(db, tenant_id) == 1
    db.commit()
    assert loyalty_account(client, customer)["balance"] == 15
    assert db.query(LoyaltyEntry).filter_by(
        tenant_id=tenant_id, kind="accrual", source_id=earned_before_downgrade.id
    ).count() == 1
    _assign_plan(db, tenant_id, "gestion")
    assert loyalty_service.process(db, tenant_id) == 0
    db.commit()
    assert db.query(LoyaltyEntry).filter_by(
        tenant_id=tenant_id, kind="accrual", source_id=excluded_sale.id
    ).count() == 0
    assert loyalty_account(client, customer)["balance"] == 15


@pytest.mark.parametrize("already_accepted", [False, True])
def test_request_conversion_cannot_create_a_new_commitment_after_downgrade(
    client, db, already_accepted,
):
    tenant_id, _, _, _, _, receipt, customer = prepare_request(client)
    review = preview_request(client, receipt)
    headers = {"Idempotency-Key": str(uuid4())}
    if already_accepted:
        original = accept_request(client, receipt, customer, review, headers)
        assert original.status_code == 201, original.text
    _assign_plan(db, tenant_id)
    attempted = accept_request(client, receipt, customer, review, headers)
    if already_accepted:
        # A replay returns the already created commitment without creating another order.
        assert attempted.status_code == 201, attempted.text
        assert attempted.json() == original.json()
        assert db.query(CustomerOrder).filter_by(tenant_id=tenant_id).count() == 1
    else:
        _blocked(attempted, "customer_orders")
        assert db.query(CustomerOrder).filter_by(tenant_id=tenant_id).count() == 0
        converted = client.post(
            f"/api/v1/crm/requests/{receipt['receipt_id']}/resolve",
            headers={"Idempotency-Key": str(uuid4())},
            json={"expected_version": review["version"], "status": "converted",
                  "customer_id": customer["id"]},
        )
        _blocked(converted, "customer_orders")
        dismissed = client.post(
            f"/api/v1/crm/requests/{receipt['receipt_id']}/resolve",
            headers={"Idempotency-Key": str(uuid4())},
            json={"expected_version": review["version"], "status": "dismissed"},
        )
        assert dismissed.status_code == 200, dismissed.text


@pytest.mark.parametrize("plan", ["esencial", "gestion"])
def test_assistant_confirmation_rechecks_the_shared_branch_limit(client, db, monkeypatch, plan):
    tenant_id = _signup(client)
    monkeypatch.setattr(settings, "assistant_enabled", True)
    monkeypatch.setattr(settings, "assistant_mutations_enabled", True)
    monkeypatch.setattr(settings, "assistant_tenant_ids", str(tenant_id))
    proposal = client.post("/api/v1/assistant/proposals", json={
        "steps": [{"action": "branch_create", "values": {"name": "Sucursal propuesta"}}],
    })
    assert proposal.status_code == 201, proposal.text
    _assign_plan(db, tenant_id, plan)
    body = proposal.json()
    confirmed = client.post(
        f"/api/v1/assistant/proposals/{body['id']}/confirm",
        json={"fingerprint": body["data"]["fingerprint"]},
    )
    assert confirmed.status_code == 200, confirmed.text
    result = confirmed.json()
    assert result["status"] == "pending_approval"
    assert result["data"]["error_code"] == 403
    assert result["data"]["steps"][0]["result"] is None
    assert db.query(Branch).filter_by(tenant_id=tenant_id).count() == 1
