"""Rewards reconcile actual POS money, inventory and immutable points under RLS."""

from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.auth.models import Membership
from app.billing.models import Subscription
from app.branches.scope import bind_branch
from app.customers.models import Customer
from app.loyalty import rewards
from app.loyalty.models import LoyaltyEntry, LoyaltyRewardRedemption, LoyaltyRewardRevision
from app.orders.models import InventoryMovement, Order
from app.tests.test_loyalty import BASE, account, key, policy, process, setup
from app.tests.test_loyalty_cards import issue, read
from app.tests.test_orders import _create_product, _open_shift, _seed_stock

pytestmark = pytest.mark.usefixtures("fast_business_auth")
REWARDS = BASE + "/rewards"


def reward(client, *, version=0, enabled=True, discount="10.00", cost=5, headers=None):
    return client.put(
        REWARDS,
        headers=headers or key(),
        json={
            "expected_version": version,
            "enabled": enabled,
            "title": "Premio de cliente frecuente",
            "points_cost": cost,
            "discount_amount": discount,
        },
    )


def program(client):
    tenant, customer = setup(client)
    assert policy(client).status_code == 200
    _open_shift(client)
    product = _create_product(client, price="25.00", track_inventory=True, cost="8.00")
    _seed_stock(client, product["id"], 20)
    initial = client.post(
        "/api/v1/orders",
        headers=key(),
        json={
            "customer_id": str(customer),
            "items": [{"product_id": product["id"], "quantity": 4}],
            "payments": [{"method": "cash", "amount": "100.00", "amount_tendered": "100.00"}],
        },
    )
    assert initial.status_code == 201, initial.text
    assert process(client) == 1
    configured = reward(client)
    assert configured.status_code == 200, configured.text
    return tenant, customer, product, configured.json()


def checkout_body(customer, product, benefit, *, quantity=2, amount="40.00", tax="0"):
    return {
        "order": {
            "customer_id": str(customer),
            "tax_rate": tax,
            "items": [{"product_id": product["id"], "quantity": quantity}],
            "payments": [{"method": "cash", "amount": amount, "amount_tendered": "100.00"}],
        },
        "reward_id": benefit["id"],
        "reward_version": benefit["version"],
        "expected_balance": 10,
        "confirmed": True,
    }


def checkout(client, body, headers=None):
    return client.post(REWARDS + "/checkout", headers=headers or key(), json=body)


def test_explicit_reward_revision_public_offer_and_owner_only_configuration(client, db):
    tenant, customer = setup(client)
    assert client.get(REWARDS).json() is None
    assert client.get(REWARDS + "/offer", params={"customer_id": str(customer)}).json() == {
        "customer_id": str(customer),
        "balance": 0,
        "adjustments_pending": False,
        "reward": None,
    }
    headers = key()
    first = reward(client, headers=headers)
    assert first.status_code == 200, first.text
    assert reward(client, headers=headers).json() == first.json()
    assert reward(client).status_code == 409
    db.rollback()
    token = issue(client, customer)
    assert read(client, token).json()["reward"] == first.json()
    paused = reward(client, version=1, enabled=False)
    assert paused.status_code == 200
    assert client.get(REWARDS).json()["enabled"] is False
    assert read(client, token).json()["reward"] is None
    member = db.query(Membership).filter_by(tenant_id=tenant).one()
    member.role = "cashier"
    db.commit()
    assert client.get(REWARDS).status_code == 403
    assert reward(client, version=2).status_code == 403
    assert client.get(REWARDS + "/offer", params={"customer_id": str(customer)}).status_code == 200


def test_checkout_atomically_discounts_real_money_stock_fiscal_and_points_with_replay(client, db):
    tenant, customer, product, benefit = program(client)
    body = checkout_body(customer, product, benefit, amount="46.40", tax="16")
    headers = key()
    first = checkout(client, body, headers)
    assert first.status_code == 201, first.text
    result = first.json()
    assert result["subtotal_amount"] == "50.00"
    assert result["discount_amount"] == "10.00"
    assert result["tax_amount"] == "6.40"
    assert result["total_amount"] == "46.40"
    assert sum(Decimal(item["line_total_amount"]) for item in result["items"]) == Decimal("46.40")
    assert result["payments"][0]["change_due_amount"] == "53.60"
    assert result["loyalty_reward"] == {
        "id": benefit["id"],
        "title": benefit["title"],
        "points_cost": 5,
        "discount_amount": "10.00",
    }
    assert account(client, customer)["balance"] == 5
    assert db.query(LoyaltyRewardRedemption).filter_by(tenant_id=tenant).count() == 1
    stock = db.query(InventoryMovement).filter_by(tenant_id=tenant, product_id=UUID(product["id"]))
    assert sum(row.quantity_delta for row in stock) == 14
    receipt = client.get(f"/api/v1/orders/{result['id']}/receipt").json()
    assert receipt["loyalty_reward"] == result["loyalty_reward"]
    assert (
        client.get(f"/api/v1/orders/{result['id']}").json()["loyalty_reward"]
        == result["loyalty_reward"]
    )
    snapshot = db.execute(
        text("SELECT total_amount FROM order_fiscal_snapshots WHERE order_id=:id"),
        {"id": UUID(result["id"])},
    ).scalar()
    assert snapshot == Decimal("46.40")
    assert process(client) == 1
    assert account(client, customer)["balance"] == 9  # Earn only on paid 46.40, never gross 50.
    assert reward(client, version=1, discount="15").status_code == 200
    assert (
        checkout(client, body, headers).json() == result
    )  # Historical replay survives changed rules.
    assert db.query(Order).filter_by(tenant_id=tenant).count() == 2
    assert db.query(LoyaltyRewardRedemption).filter_by(tenant_id=tenant).count() == 1


@pytest.mark.parametrize(
    "failure", ["payments", "stock", "balance", "version", "stack", "subtotal", "customer"]
)
def test_rejected_reward_checkout_leaves_no_financial_or_points_effect(client, db, failure):
    tenant, customer, product, benefit = program(client)
    body = checkout_body(customer, product, benefit)
    if failure == "payments":
        body["order"]["payments"][0]["amount"] = "50.00"
    elif failure == "stock":
        body["order"]["items"][0]["quantity"] = 100
    elif failure == "balance":
        body["expected_balance"] = 9
    elif failure == "version":
        body["reward_version"] = 99
    elif failure == "stack":
        body["order"]["discount_amount"] = "1.00"
    elif failure == "subtotal":
        updated = reward(client, version=1, discount="100")
        body["reward_id"] = updated.json()["id"]
        body["reward_version"] = 2
    else:
        body["order"]["customer_id"] = str(uuid4())
    result = checkout(client, body)
    assert result.status_code in (400, 404, 409, 422), result.text
    assert db.query(Order).filter_by(tenant_id=tenant).count() == 1
    assert db.query(LoyaltyRewardRedemption).filter_by(tenant_id=tenant).count() == 0
    assert account(client, customer)["balance"] == 10
    assert (
        sum(
            row.quantity_delta
            for row in db.query(InventoryMovement).filter_by(
                tenant_id=tenant,
                product_id=UUID(product["id"]),
            )
        )
        == 16
    )


def test_full_refund_returns_reward_cost_once_partial_keeps_cost_and_refunds_only_paid(client, db):
    tenant, customer, product, benefit = program(client)
    result = checkout(client, checkout_body(customer, product, benefit)).json()
    assert process(client) == 1
    assert account(client, customer)["balance"] == 9
    item = result["items"][0]["id"]
    refund_body = {
        "items": [{"order_item_id": item, "quantity": 1}],
        "reason": "customer_return",
        "refund_payment_method": "cash",
    }
    first = client.post(f"/api/v1/orders/{result['id']}/refunds", headers=key(), json=refund_body)
    assert first.status_code == 201, first.text
    assert first.json()["refunded_amount"] == "20.00"
    assert account(client, customer)["balance"] == 9
    assert account(client, customer)["adjustments_pending"] is True
    assert checkout(client, checkout_body(customer, product, benefit)).status_code == 409
    db.rollback()
    assert process(client) == 1
    assert account(client, customer)["balance"] == 7
    headers = key()
    second = client.post(
        f"/api/v1/orders/{result['id']}/refunds", headers=headers, json=refund_body
    )
    assert second.status_code == 201, second.text
    assert second.json()["refunded_amount"] == "20.00"
    assert (
        account(client, customer)["balance"] == 12
    )  # 7 + returned cost5, pending earned reversal2.
    assert process(client) == 1
    assert account(client, customer)["balance"] == 10
    assert (
        client.post(
            f"/api/v1/orders/{result['id']}/refunds", headers=headers, json=refund_body
        ).json()
        == second.json()
    )
    assert db.query(LoyaltyEntry).filter_by(tenant_id=tenant, kind="reward_return").count() == 1
    assert (
        sum(
            row.quantity_delta
            for row in db.query(InventoryMovement).filter_by(
                tenant_id=tenant,
                product_id=UUID(product["id"]),
            )
        )
        == 16
    )


def test_void_returns_reward_cost_once_without_suppressing_earned_reversal(client, db):
    tenant, customer, product, benefit = program(client)
    result = checkout(client, checkout_body(customer, product, benefit)).json()
    assert process(client) == 1
    headers = key()
    first = client.post(
        f"/api/v1/orders/{result['id']}/void", headers=headers, json={"reason": "operator_error"}
    )
    assert first.status_code == 201, first.text
    assert account(client, customer)["balance"] == 14
    assert account(client, customer)["adjustments_pending"] is True
    assert process(client) == 1
    assert account(client, customer)["balance"] == 10
    assert (
        client.post(
            f"/api/v1/orders/{result['id']}/void",
            headers=headers,
            json={"reason": "operator_error"},
        ).json()
        == first.json()
    )
    assert db.query(LoyaltyEntry).filter_by(tenant_id=tenant, kind="reward_return").count() == 1


def test_branch_customer_billing_and_current_author_control_the_reward(client, db):
    tenant, customer, product, benefit = program(client)
    body = checkout_body(customer, product, benefit)
    assert (
        checkout(client, body, {"Idempotency-Key": str(uuid4()), "X-CSRF-Token": "bad"}).status_code
        == 403
    )
    branch = client.post("/api/v1/branches", headers=key(), json={"name": "Otra"}).json()["id"]
    assert (
        client.get(
            REWARDS + "/offer",
            params={"customer_id": str(customer)},
            headers={"X-Kova-Branch": branch},
        ).json()["reward"]
        is None
    )
    member = db.query(Membership).filter_by(tenant_id=tenant).one()
    member.role = "cashier"
    db.commit()
    assert checkout(client, body).status_code == 409  # Author no longer owner, no reward.
    member.role = "owner"
    db.commit()
    customer_row = db.query(Customer).filter_by(id=customer).one()
    customer_row.is_active = False
    db.commit()
    assert checkout(client, body).status_code == 404
    customer_row.is_active = True
    db.commit()
    db.add(Subscription(tenant_id=tenant, status="canceled"))
    db.commit()
    assert checkout(client, body).status_code == 402


def test_reward_tables_are_rls_private_append_only_and_scope_safe(client, db, kova_app_engine):
    tenant, customer, product, benefit = program(client)
    assert checkout(client, checkout_body(customer, product, benefit)).status_code == 201
    other_branch = client.post(
        "/api/v1/branches",
        headers=key(),
        json={"name": "Reward FK boundary"},
    ).json()["id"]
    bind_branch(db, tenant_id=tenant)
    db.execute(text("SET LOCAL ROLE kova_app"))
    try:
        assert rewards.offer(db, tenant, customer).balance == 5
        assert db.query(LoyaltyRewardRedemption).filter_by(tenant_id=tenant).count() == 1
        with pytest.raises(DBAPIError) as boundary, db.begin_nested():
            db.execute(
                text(
                    "INSERT INTO loyalty_reward_redemptions "
                    "SELECT gen_random_uuid(),tenant_id,CAST(:branch AS uuid),customer_id,"
                    "sale_order_id,reward_revision_id,gen_random_uuid(),title,points_cost,"
                    "discount_amount,created_by_user_id,created_at "
                    "FROM loyalty_reward_redemptions WHERE tenant_id=:tenant"
                ),
                {"branch": other_branch, "tenant": tenant},
            )
        assert boundary.value.orig.sqlstate == "23503"
        assert "sale_order" in boundary.value.orig.diag.constraint_name
        for table in ("loyalty_reward_revisions", "loyalty_reward_redemptions"):
            flags = db.execute(
                text(
                    "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=:table"
                ),
                {"table": table},
            ).one()
            assert flags == (True, True)
            with pytest.raises(DBAPIError), db.begin_nested():
                db.execute(text(f"DELETE FROM {table} WHERE tenant_id=:tenant"), {"tenant": tenant})
        db.execute(
            text("SELECT set_config('app.tenant_id',:tenant,true)"), {"tenant": str(uuid4())}
        )
        assert db.query(LoyaltyRewardRevision).count() == 0
        assert db.query(LoyaltyRewardRedemption).count() == 0
    finally:
        db.execute(text("RESET ROLE"))


def test_cashier_uses_only_explicit_owner_reward_and_never_configures_it(client, db):
    from app.auth.models import User
    from app.tests.test_employee_rbac import _add_member

    tenant, customer, product, benefit = program(client)
    cashier = _add_member(db, tenant_id=tenant, role="cashier")
    email = db.query(User.email).filter_by(id=cashier.user_id).scalar()
    client.cookies.clear()
    assert (
        client.post(
            "/api/v1/auth/login", json={"email": email, "password": "S3cur3pass!"}
        ).status_code
        == 200
    )
    assert reward(client, version=1).status_code == 403
    offer = client.get(REWARDS + "/offer", params={"customer_id": str(customer)})
    assert offer.status_code == 200
    assert offer.json()["reward"] == benefit
    assert set(offer.json()) == {"customer_id", "balance", "adjustments_pending", "reward"}
    sale = checkout(client, checkout_body(customer, product, benefit))
    assert sale.status_code == 201, sale.text
    assert sale.json()["total_amount"] == "40.00"
    assert (
        db.query(LoyaltyEntry)
        .filter_by(tenant_id=tenant, kind="redemption")
        .one()
        .recorded_by_user_id
        == cashier.user_id
    )


def test_fully_discounted_reward_never_earns_gross_points_and_full_return_restores_cost(client, db):
    tenant, customer, product, _ = program(client)
    benefit = reward(client, version=1, discount="25").json()
    result = checkout(client, checkout_body(customer, product, benefit, quantity=1, amount="0.00"))
    assert result.status_code == 201, result.text
    sale = result.json()
    assert sale["total_amount"] == "0.00"
    assert process(client) == 1
    assert account(client, customer)["balance"] == 5
    response = client.post(
        f"/api/v1/orders/{sale['id']}/refunds",
        headers=key(),
        json={
            "items": [{"order_item_id": sale["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return",
            "refund_payment_method": "cash",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["refunded_amount"] == "0.00"
    assert account(client, customer)["balance"] == 10
    assert db.query(LoyaltyEntry).filter_by(tenant_id=tenant, kind="reward_return").count() == 1


def test_offline_payload_remains_unchanged_and_reward_checkout_rejects_offline_snapshots(
    client, db
):
    from app.sync.schemas import OfflineSaleSyncItem

    tenant, customer, product, benefit = program(client)
    body = checkout_body(customer, product, benefit)
    body["order"]["items"][0]["unit_price_amount"] = "25.00"
    assert checkout(client, body).status_code == 400
    assert db.query(LoyaltyRewardRedemption).filter_by(tenant_id=tenant).count() == 0
    ordinary = {
        "items": [{"product_id": product["id"], "quantity": 1, "unit_price_amount": "25.00"}],
        "payments": [{"method": "cash", "amount": "25.00", "amount_tendered": "25.00"}],
    }
    offline = OfflineSaleSyncItem(client_uuid=uuid4(), order=ordinary)
    result = client.post(
        "/api/v1/sync/offline-sales", json={"sales": [offline.model_dump(mode="json")]}
    )
    assert result.status_code == 200, result.text
    assert result.json()["results"][0]["status"] == "synced"
    assert db.query(LoyaltyRewardRedemption).filter_by(tenant_id=tenant).count() == 0


@pytest.fixture
def committed_reward(owner_engine):
    from datetime import UTC, datetime, timedelta

    from sqlalchemy.orm import Session

    from app.catalog.models import Product
    from app.loyalty.models import LoyaltyPolicyRevision
    from app.tenants.models import Tenant

    tenant, customer, product, reward_id = [uuid4() for _ in range(4)]
    with Session(owner_engine) as db:
        db.add(Tenant(id=tenant, name="Concurrent reward", slug=str(tenant)))
        db.flush()
        db.execute(
            text(
                "INSERT INTO users(id,email,hashed_password,is_email_verified) VALUES(:id,:email,'test-only',true)"
            ),
            {"id": tenant, "email": f"reward-{tenant}@example.com"},
        )
        db.execute(
            text("INSERT INTO memberships(tenant_id,user_id,role) VALUES(:id,:id,'owner')"),
            {"id": tenant},
        )
        db.add(Customer(id=customer, tenant_id=tenant, name="Reward customer"))
        db.add(
            Product(id=product, tenant_id=tenant, name="Reward product", price_amount=Decimal("25"))
        )
        db.add(
            LoyaltyPolicyRevision(
                tenant_id=tenant,
                branch_id=tenant,
                version=1,
                enabled=True,
                spend_amount=Decimal("10"),
                points_per_step=1,
                authorized_by_user_id=tenant,
                effective_at=datetime.now(UTC) - timedelta(minutes=1),
            )
        )
        db.add(
            LoyaltyRewardRevision(
                id=reward_id,
                tenant_id=tenant,
                branch_id=tenant,
                version=1,
                enabled=True,
                title="Real reward",
                points_cost=8,
                discount_amount=Decimal("10"),
                authorized_by_user_id=tenant,
            )
        )
        db.flush()
        db.add(
            Order(
                tenant_id=tenant,
                branch_id=tenant,
                customer_id=customer,
                subtotal_amount=Decimal("100"),
                total_amount=Decimal("100"),
            )
        )
        db.commit()
    try:
        yield tenant, customer, product, reward_id
    finally:
        with owner_engine.begin() as conn:
            # Test cleanup follows the same privileged, transaction-local fiscal
            # history deletion gate as an approved whole-account purge.
            conn.execute(text("SET LOCAL app.allow_fiscal_history_delete='on'"))
            for table in (
                "loyalty_reward_redemptions",
                "loyalty_entries",
                "loyalty_reward_revisions",
                "loyalty_policy_revisions",
                "order_fiscal_snapshots",
                "order_item_modifiers",
                "order_items",
                "payments",
                "inventory_movements",
                "idempotency_keys",
                "audit_logs",
                "orders",
                "products",
                "customers",
                "memberships",
                "branches",
            ):
                conn.execute(text(f"DELETE FROM {table} WHERE tenant_id=:id"), {"id": tenant})
            conn.execute(text("DELETE FROM tenants WHERE id=:id"), {"id": tenant})
            conn.execute(text("DELETE FROM users WHERE id=:id"), {"id": tenant})


@pytest.mark.parametrize("same_key", [False, True])
def test_runtime_concurrent_reward_checkout_replays_or_rejects_without_overspending(
    kova_app_engine,
    committed_reward,
    same_key,
):
    from concurrent.futures import ThreadPoolExecutor

    from fastapi import HTTPException
    from sqlalchemy.orm import Session

    from app.db import set_tenant_context
    from app.loyalty import service
    from app.loyalty.schemas import LoyaltyRewardCheckout

    tenant, customer, product, reward_id = committed_reward
    with Session(kova_app_engine) as db:
        set_tenant_context(db, tenant)
        bind_branch(db, tenant_id=tenant)
        assert service.process(db, tenant) == 1
        db.commit()
    body = LoyaltyRewardCheckout.model_validate(
        {
            "order": {
                "customer_id": str(customer),
                "items": [{"product_id": str(product), "quantity": 1}],
                "payments": [{"method": "bank_transfer", "amount": "15"}],
            },
            "reward_id": str(reward_id),
            "reward_version": 1,
            "expected_balance": 10,
            "confirmed": True,
        }
    )
    shared_key = str(uuid4())

    def apply(_):
        with Session(kova_app_engine) as db:
            set_tenant_context(db, tenant)
            bind_branch(db, tenant_id=tenant)
            try:
                status, result = rewards.checkout(
                    db, tenant, tenant, body, shared_key if same_key else str(uuid4())
                )
                return status, result["id"]
            except HTTPException as error:
                return error.status_code, None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(apply, range(2)))
    assert sorted(status for status, _ in results) == ([201, 201] if same_key else [201, 409])
    if same_key:
        assert results[0][1] == results[1][1]
    with Session(kova_app_engine) as db:
        set_tenant_context(db, tenant)
        bind_branch(db, tenant_id=tenant)
        assert service._balance(db, tenant, customer) == 2
        assert db.query(LoyaltyRewardRedemption).count() == 1
        assert db.query(Order).count() == 2


def test_runtime_manual_and_pos_redemptions_share_one_serialized_balance(
    kova_app_engine,
    committed_reward,
):
    from concurrent.futures import ThreadPoolExecutor

    from fastapi import HTTPException
    from sqlalchemy.orm import Session

    from app.db import set_tenant_context
    from app.loyalty import service
    from app.loyalty.schemas import LoyaltyRedeemWrite, LoyaltyRewardCheckout

    tenant, customer, product, reward_id = committed_reward
    with Session(kova_app_engine) as db:
        set_tenant_context(db, tenant)
        bind_branch(db, tenant_id=tenant)
        assert service.process(db, tenant) == 1
        db.commit()
    body = LoyaltyRewardCheckout.model_validate(
        {
            "order": {
                "customer_id": str(customer),
                "items": [{"product_id": str(product), "quantity": 1}],
                "payments": [{"method": "bank_transfer", "amount": "15"}],
            },
            "reward_id": str(reward_id),
            "reward_version": 1,
            "expected_balance": 10,
            "confirmed": True,
        }
    )
    manual = LoyaltyRedeemWrite(
        points=8, expected_balance=10, benefit="Manual benefit", confirmed=True
    )

    def apply(manual_mode):
        with Session(kova_app_engine) as db:
            set_tenant_context(db, tenant)
            bind_branch(db, tenant_id=tenant)
            try:
                result = (
                    service.redeem(db, tenant, tenant, customer, manual, str(uuid4()))
                    if manual_mode
                    else rewards.checkout(db, tenant, tenant, body, str(uuid4()))
                )
                return result[0]
            except HTTPException as error:
                db.rollback()
                return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(apply, [False, True])) == [201, 409]
    with Session(kova_app_engine) as db:
        set_tenant_context(db, tenant)
        bind_branch(db, tenant_id=tenant)
        assert service._balance(db, tenant, customer) == 2
        assert db.query(LoyaltyEntry).filter_by(kind="redemption").count() == 1
