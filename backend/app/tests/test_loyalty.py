from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.auth.models import Membership
from app.billing.models import Subscription
from app.branches.scope import bind_branch
from app.customers.models import Customer
from app.db import set_tenant_context
from app.loyalty import service
from app.loyalty.models import LoyaltyEntry, LoyaltyPolicyRevision
from app.orders.models import Order, Refund
from app.tests.test_customer_orders import _signup_login

pytestmark = pytest.mark.usefixtures("fast_business_auth")
BASE = "/api/v1/loyalty"


def key():
    return {"Idempotency-Key": str(uuid4())}


def setup(client):
    tenant = _signup_login(client, prefix="loyalty")
    result = client.post(
        "/api/v1/customers", headers=key(), json={"name": "Cliente lealtad", "phone": "5512345678"}
    )
    assert result.status_code == 201, result.text
    return tenant, UUID(result.json()["id"])


def policy(client, *, version=0, enabled=True, spend="10.00", points=1, headers=None):
    return client.put(
        BASE + "/policy",
        headers=headers or key(),
        json={
            "expected_version": version,
            "enabled": enabled,
            "spend_amount": spend,
            "points_per_step": points,
        },
    )


def sale(db, tenant, customer, amount="35.00", branch=None, **extra):
    row = Order(
        tenant_id=tenant,
        branch_id=branch or tenant,
        customer_id=customer,
        subtotal_amount=Decimal(amount),
        total_amount=Decimal(amount),
        **extra,
    )
    db.add(row)
    db.commit()
    return row


def refund(db, tenant, order, amount):
    row = Refund(
        tenant_id=tenant,
        branch_id=order.branch_id,
        order_id=order.id,
        reason="customer_request",
        refunded_amount=Decimal(amount),
    )
    db.add(row)
    db.commit()
    return row


def account(client, customer):
    response = client.get(f"{BASE}/customers/{customer}")
    assert response.status_code == 200, response.text
    return response.json()


def process(client):
    response = client.post(BASE + "/process")
    assert response.status_code == 200, response.text
    return response.json()["created"]


def test_disabled_default_requires_explicit_rate_and_real_sales(client, db):
    tenant, customer = setup(client)
    assert client.get(BASE).json() == {
        "policy": {"enabled": False, "spend_amount": None, "points_per_step": None, "version": 0},
        "accounts": [],
        "accounts_has_more": False,
    }
    sale(db, tenant, customer)
    assert process(client) == 0
    assert (
        client.put(
            BASE + "/policy", headers=key(), json={"expected_version": 0, "enabled": True}
        ).status_code
        == 422
    )
    headers = key()
    first = policy(client, spend="10.00", points=2, headers=headers)
    assert first.status_code == 200, first.text
    assert policy(client, spend="10.00", points=2, headers=headers).json() == first.json()
    sale(db, tenant, customer, "35.00")
    sale(db, tenant, None, "1000.00")
    assert process(client) == 1
    assert process(client) == 0
    result = account(client, customer)
    assert result["balance"] == 6
    assert result["adjustments_pending"] is False
    assert result["entries"][0]["kind"] == "accrual"
    assert db.query(Order).filter_by(tenant_id=tenant).count() == 3


def test_delayed_processing_uses_immutable_rate_revisions_and_pause_boundaries(client, db):
    tenant, customer = setup(client)
    assert policy(client, spend="10", points=2).status_code == 200
    sale(db, tenant, customer, "35")
    assert policy(client, version=1, spend="5", points=3).status_code == 200
    sale(db, tenant, customer, "35")
    assert policy(client, version=2, enabled=False, spend="5", points=3).status_code == 200
    sale(db, tenant, customer, "35")
    assert process(client) == 2
    assert account(client, customer)["balance"] == 6 + 21
    assert db.query(LoyaltyPolicyRevision).filter_by(tenant_id=tenant).count() == 3
    assert policy(client, version=1).status_code == 409


def test_refunds_reverse_cumulative_floor_and_void_only_remaining_points(client, db):
    tenant, customer = setup(client)
    assert policy(client, spend="10", points=2).status_code == 200
    order = sale(db, tenant, customer, "35")
    assert process(client) == 1
    first = refund(db, tenant, order, "1.00")
    assert account(client, customer)["adjustments_pending"] is True
    assert process(client) == 1
    assert account(client, customer)["balance"] == 6
    second = refund(db, tenant, order, "5.00")
    assert process(client) == 1
    assert account(client, customer)["balance"] == 4
    assert policy(client, version=1, enabled=False, spend="1", points=100).status_code == 200
    order.status = "voided"
    db.commit()
    assert process(client) == 1
    result = account(client, customer)
    assert result["balance"] == 0
    assert result["adjustments_pending"] is False
    assert process(client) == 0
    assert {
        str(r.source_id)
        for r in db.query(LoyaltyEntry).filter_by(tenant_id=tenant, kind="refund").all()
    } == {str(first.id), str(second.id)}
    assert order.total_amount == Decimal("35")


def test_redemption_explicit_only_debits_points_and_refund_can_make_negative_balance(client, db):
    tenant, customer = setup(client)
    assert policy(client).status_code == 200
    order = sale(db, tenant, customer, "100")
    assert process(client) == 1
    url = f"{BASE}/customers/{customer}/redeem"
    body = {
        "points": 8,
        "expected_balance": 10,
        "benefit": "Revisar obsequio manual con el cliente",
        "confirmed": True,
    }
    assert client.post(url, headers=key(), json={**body, "confirmed": False}).status_code == 422
    assert client.post(url, headers=key(), json={**body, "benefit": " "}).status_code == 422
    headers = key()
    redeemed = client.post(url, headers=headers, json=body)
    assert redeemed.status_code == 201, redeemed.text
    assert redeemed.json()["balance"] == 2
    assert client.post(url, headers=headers, json=body).json() == redeemed.json()
    assert client.post(url, headers=key(), json=body).status_code == 409
    refund(db, tenant, order, "100")
    assert (
        client.post(
            url, headers=key(), json={**body, "points": 1, "expected_balance": 2}
        ).status_code
        == 409
    )
    assert process(client) == 1
    assert account(client, customer)["balance"] == -8
    assert (
        client.post(
            url, headers=key(), json={**body, "points": 1, "expected_balance": -8}
        ).status_code
        == 409
    )
    assert db.query(Order).filter_by(tenant_id=tenant).count() == 1
    assert order.total_amount == Decimal("100")


def test_zero_points_and_small_decimal_steps_never_round_up_or_duplicate(client, db):
    tenant, customer = setup(client)
    assert policy(client, spend=".03", points=1).status_code == 200
    sale(db, tenant, customer, ".02")
    sale(db, tenant, customer, ".08")
    assert process(client) == 2
    assert process(client) == 0
    assert account(client, customer)["balance"] == 2
    assert sorted(r.points for r in db.query(LoyaltyEntry).filter_by(tenant_id=tenant).all()) == [
        0,
        2,
    ]


def test_billing_roles_revoked_policy_author_and_inactive_customer_are_enforced(client, db):
    tenant, customer = setup(client)
    assert policy(client).status_code == 200
    sale(db, tenant, customer)
    member = db.query(Membership).filter_by(tenant_id=tenant).one()
    member.role = "manager"
    db.commit()
    assert client.get(BASE).status_code == 403
    assert service.process(db, tenant) == 0
    member.role = "owner"
    db.commit()
    db.query(Customer).filter_by(id=customer, tenant_id=tenant).one().is_active = False
    db.commit()
    assert service.process(db, tenant) == 0
    db.query(Customer).filter_by(id=customer, tenant_id=tenant).one().is_active = True
    db.add(Subscription(tenant_id=tenant, status="canceled"))
    db.commit()
    assert client.post(BASE + "/process").status_code == 402
    assert service.process(db, tenant) == 0


def test_branch_and_tenant_isolation(client, db):
    tenant, customer = setup(client)
    assert policy(client).status_code == 200
    sale(db, tenant, customer)
    assert process(client) == 1
    branch = client.post(
        "/api/v1/branches", headers=key(), json={"name": "Sucursal lealtad"}
    ).json()
    other = {"X-Kova-Branch": branch["id"]}
    assert client.get(BASE, headers=other).json()["accounts"] == []
    assert client.get(f"{BASE}/customers/{customer}", headers=other).json()["balance"] == 0
    assert (
        client.put(
            BASE + "/policy",
            headers={**key(), **other},
            json={
                "expected_version": 0,
                "enabled": True,
                "spend_amount": "1",
                "points_per_step": 1,
            },
        ).status_code
        == 200
    )
    bind_branch(db, tenant_id=tenant, branch_id=UUID(branch["id"]))
    sale(db, tenant, customer, "12", branch=UUID(branch["id"]))
    assert client.post(BASE + "/process", headers=other).json() == {"created": 1}
    assert client.get(f"{BASE}/customers/{customer}", headers=other).json()["balance"] == 12
    setup(client)
    assert client.get(f"{BASE}/customers/{customer}").status_code == 404


def test_policy_and_ledger_force_rls_and_are_runtime_append_only(client, db, kova_app_engine):
    tenant, customer = setup(client)
    assert policy(client).status_code == 200
    sale(db, tenant, customer)
    assert process(client) == 1
    db.execute(text("SET LOCAL ROLE kova_app"))
    set_tenant_context(db, tenant)
    assert db.query(LoyaltyEntry).filter_by(tenant_id=tenant).count() == 1
    for table in ("loyalty_entries", "loyalty_policy_revisions"):
        with pytest.raises(DBAPIError), db.begin_nested():
            db.execute(
                text(f"UPDATE {table} SET tenant_id=:id WHERE tenant_id=:id"), {"id": tenant}
            )
        with pytest.raises(DBAPIError), db.begin_nested():
            db.execute(text(f"DELETE FROM {table} WHERE tenant_id=:id"), {"id": tenant})
    set_tenant_context(db, uuid4())
    assert db.query(LoyaltyEntry).count() == 0
    assert db.query(LoyaltyPolicyRevision).count() == 0
    with pytest.raises(DBAPIError), db.begin_nested():
        db.execute(
            text(
                "INSERT INTO loyalty_entries(id,tenant_id,branch_id,customer_id,kind,source_id,points,created_at,benefit,recorded_by_user_id) VALUES(:id,:tenant,:tenant,:customer,'redemption',:id,-1,now(),'manual',:user)"
            ),
            {
                "id": uuid4(),
                "tenant": tenant,
                "customer": customer,
                "user": db.execute(
                    text("SELECT user_id FROM memberships WHERE tenant_id=:id"), {"id": tenant}
                ).scalar()
                or tenant,
            },
        )
    db.execute(text("RESET ROLE"))


@pytest.fixture
def committed_loyalty(owner_engine):
    from datetime import UTC, datetime, timedelta

    from sqlalchemy.orm import Session

    from app.tenants.models import Tenant

    tenant, customer = uuid4(), uuid4()
    with Session(owner_engine) as db:
        db.add(Tenant(id=tenant, name="Concurrent points", slug=f"points-{tenant}"))
        db.flush()
        db.execute(
            text(
                "INSERT INTO users(id,email,hashed_password,is_email_verified) VALUES(:id,:email,'test-only',true)"
            ),
            {"id": tenant, "email": f"points-{tenant}@example.com"},
        )
        db.execute(
            text("INSERT INTO memberships(tenant_id,user_id,role) VALUES(:id,:id,'owner')"),
            {"id": tenant},
        )
        db.add(Customer(id=customer, tenant_id=tenant, name="Concurrent points customer"))
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
        yield tenant, customer
    finally:
        with owner_engine.begin() as conn:
            for table in (
                "loyalty_entries",
                "loyalty_policy_revisions",
                "idempotency_keys",
                "audit_logs",
                "orders",
                "customers",
                "memberships",
                "branches",
            ):
                conn.execute(text(f"DELETE FROM {table} WHERE tenant_id=:id"), {"id": tenant})
            conn.execute(text("DELETE FROM tenants WHERE id=:id"), {"id": tenant})
            conn.execute(text("DELETE FROM users WHERE id=:id"), {"id": tenant})


def test_runtime_concurrent_accrual_and_redemption_never_duplicate_or_overdraw(
    kova_app_engine, committed_loyalty
):
    from concurrent.futures import ThreadPoolExecutor

    from fastapi import HTTPException
    from sqlalchemy.orm import Session

    from app.loyalty.schemas import LoyaltyRedeemWrite

    tenant, customer = committed_loyalty

    def accrue(_):
        with Session(kova_app_engine) as db:
            set_tenant_context(db, tenant)
            bind_branch(db, tenant_id=tenant)
            created = service.process(db, tenant)
            db.commit()
            return created

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(accrue, range(2))) == [0, 1]
    body = LoyaltyRedeemWrite(
        points=8, expected_balance=10, benefit="Beneficio manual a revisar", confirmed=True
    )

    def redeem(_):
        with Session(kova_app_engine) as db:
            set_tenant_context(db, tenant)
            bind_branch(db, tenant_id=tenant)
            try:
                status, _ = service.redeem(db, tenant, tenant, customer, body, str(uuid4()))
                return status
            except HTTPException as exc:
                db.rollback()
                return exc.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(redeem, range(2))) == [201, 409]
    with Session(kova_app_engine) as db:
        set_tenant_context(db, tenant)
        bind_branch(db, tenant_id=tenant)
        assert service.account(db, tenant, customer)["balance"] == 2
        assert db.query(LoyaltyEntry).filter_by(tenant_id=tenant).count() == 2


def test_processing_refund_ledger_budget_advances_without_repeating_entries(client, db):
    tenant, customer = setup(client)
    assert policy(client, spend=".01", points=1).status_code == 200
    order = sale(db, tenant, customer, "100")
    for _ in range(103):
        db.add(
            Refund(
                tenant_id=tenant,
                branch_id=tenant,
                order_id=order.id,
                reason="customer_request",
                refunded_amount=Decimal(".01"),
            )
        )
    db.commit()
    assert process(client) == 100
    assert account(client, customer)["adjustments_pending"] is True
    assert process(client) == 4
    assert process(client) == 0
    assert account(client, customer)["balance"] == 10000 - 103
    assert account(client, customer)["adjustments_pending"] is False


def test_worker_processes_loyalty_only_branch_without_other_rules(client, db, monkeypatch):
    from contextlib import contextmanager

    from app.automations import worker

    tenant, customer = setup(client)
    assert policy(client).status_code == 200
    sale(db, tenant, customer)

    @contextmanager
    def session():
        yield db

    monkeypatch.setattr(worker, "SessionLocal", session)
    assert worker.process_tenant(tenant) == 1
    assert db.query(LoyaltyEntry).filter_by(tenant_id=tenant).count() == 1
