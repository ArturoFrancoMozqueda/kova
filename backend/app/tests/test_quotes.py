from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.auth.models import Membership
from app.billing.models import Subscription
from app.branches.scope import bind_branch
from app.catalog.models import Product
from app.customer_orders.models import CustomerOrder, InventoryReservation
from app.customers.models import Customer
from app.db import set_tenant_context
from app.orders.models import Order, Payment
from app.quotes import service
from app.quotes.models import CustomerQuote
from app.quotes.schemas import QuoteAccept, QuoteCreate, QuoteShared
from app.tenants.models import Tenant
from app.tests.test_customer_orders import _enable_customer_orders, _product, _signup_login

pytestmark = pytest.mark.usefixtures("fast_business_auth")
BASE = "/api/v1/quotes"


def setup(client, db, *, enable_orders=True):
    tenant = _signup_login(client, prefix="quote")
    if enable_orders:
        _enable_customer_orders(db, tenant)
    else:
        stored = db.get(Tenant, tenant)
        stored.feature_overrides = {**stored.feature_overrides, "customer_orders": False}
        db.commit()
    customer = client.post(
        "/api/v1/customers",
        headers={"Idempotency-Key": str(uuid4())},
        json={"name": "Ana Cotización", "phone": "5512345678"},
    )
    assert customer.status_code == 201, customer.text
    product = _product(client, name="Pan cotizado", price="25.30")
    return tenant, customer.json(), product


def create(client, customer, product, *, key=None, quantity=2, **extra):
    return client.post(
        BASE,
        headers={"Idempotency-Key": key or str(uuid4())},
        json={
            "customer_id": customer["id"],
            "expires_at": (datetime.now(UTC) + timedelta(days=2)).isoformat(),
            "items": [{"product_id": product["id"], "quantity": quantity}],
            **extra,
        },
    )


def action(client, quote, name, *, key=None, version=None, branch=None, **extra):
    headers = {"Idempotency-Key": key or str(uuid4())}
    if branch:
        headers["X-Kova-Branch"] = branch
    return client.post(
        f"{BASE}/{quote['id']}/{name}",
        headers=headers,
        json={"expected_version": version or quote["version"], **extra},
    )


def sent(client, customer, product):
    created = create(client, customer, product)
    assert created.status_code == 201, created.text
    shared = action(client, created.json(), "mark-sent", confirmed_shared=True)
    assert shared.status_code == 200, shared.text
    return shared.json()


def test_server_priced_snapshot_and_atomic_conversion_do_not_create_income(client, db):
    tenant, customer, product = setup(client, db)
    quote = sent(client, customer, product)
    assert quote["total_amount"] == "50.60"
    assert quote["items"][0]["unit_price_amount"] == "25.30"
    assert quote["customer_name"] == customer["name"]
    key = str(uuid4())
    result = action(client, quote, "accept", key=key, confirmed_customer_acceptance=True)
    assert result.status_code == 200, result.text
    accepted = result.json()
    assert accepted["status"] == "accepted"
    assert (
        action(client, quote, "accept", key=key, confirmed_customer_acceptance=True).json()
        == accepted
    )
    assert action(client, quote, "accept", confirmed_customer_acceptance=True).status_code == 409
    order = client.get(f"/api/v1/customer-orders/{accepted['customer_order_id']}").json()
    assert order["status"] == "new" and order["payment_status"] == "unpaid"
    assert order["total_amount"] == quote["total_amount"]
    assert order["customer_name"] == customer["name"]
    assert order["items"][0]["quantity"] == 2
    assert db.query(CustomerOrder).filter_by(tenant_id=tenant).count() == 1
    assert db.query(Order).filter_by(tenant_id=tenant).count() == 0
    assert db.query(Payment).filter_by(tenant_id=tenant).count() == 0
    assert db.query(InventoryReservation).filter_by(tenant_id=tenant).count() == 0
    assert action(client, accepted, "cancel").status_code == 409


def test_price_or_name_drift_preserves_quote_and_rejects_conversion(client, db):
    tenant, customer, product = setup(client, db)
    quote = sent(client, customer, product)
    changed = client.patch(
        f"/api/v1/catalog/products/{product['id']}",
        headers={"Idempotency-Key": str(uuid4())},
        json={"price_amount": "30.00", "name": "Pan actualizado"},
    )
    assert changed.status_code == 200, changed.text
    assert action(client, quote, "accept", confirmed_customer_acceptance=True).status_code == 409
    stored = client.get(BASE).json()["items"][0]
    assert stored["total_amount"] == "50.60" and stored["status"] == "sent"
    assert stored["items"][0]["product_name"] == "Pan cotizado"
    assert db.query(CustomerOrder).filter_by(tenant_id=tenant).count() == 0


def test_expiration_is_rechecked_at_execution_without_get_mutation(client, db, monkeypatch):
    tenant, customer, product = setup(client, db)
    quote = sent(client, customer, product)
    expired_time = datetime.fromisoformat(quote["expires_at"]) + timedelta(seconds=1)
    monkeypatch.setattr(service, "now", lambda: expired_time)
    listed = client.get(BASE).json()["items"][0]
    assert listed["status"] == "expired"
    assert db.get(CustomerQuote, UUID(quote["id"])).status == "sent"
    assert action(client, quote, "accept", confirmed_customer_acceptance=True).status_code == 409
    assert db.query(CustomerOrder).filter_by(tenant_id=tenant).count() == 0


def test_conversion_requires_orders_flag_and_explicit_human_declarations(client, db):
    _, customer, product = setup(client, db, enable_orders=False)
    created = create(client, customer, product).json()
    assert action(client, created, "accept", confirmed_customer_acceptance=True).status_code == 403
    assert action(client, created, "mark-sent").status_code == 422
    assert action(client, created, "mark-sent", confirmed_shared=False).status_code == 422
    shared = action(client, created, "mark-sent", confirmed_shared=True).json()
    assert action(client, shared, "accept", confirmed_customer_acceptance=False).status_code == 422
    assert action(client, shared, "accept", confirmed_customer_acceptance=True).status_code == 403


def test_versioned_cancel_and_create_replay(client, db):
    _, customer, product = setup(client, db)
    payload = {
        "customer_id": customer["id"],
        "expires_at": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
        "items": [{"product_id": product["id"], "quantity": 1}],
    }
    key = str(uuid4())
    first = client.post(BASE, headers={"Idempotency-Key": key}, json=payload)
    assert first.status_code == 201, first.text
    assert client.post(BASE, headers={"Idempotency-Key": key}, json=payload).json() == first.json()
    quote = first.json()
    shared = action(client, quote, "mark-sent", confirmed_shared=True).json()
    assert action(client, quote, "cancel").status_code == 409
    cancelled = action(client, shared, "cancel")
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    assert (
        action(client, cancelled.json(), "accept", confirmed_customer_acceptance=True).status_code
        == 409
    )


def test_cross_tenant_branch_and_role_boundaries(client, db):
    _, customer, product = setup(client, db)
    quote = sent(client, customer, product)
    branch = client.post(
        "/api/v1/branches",
        headers={"Idempotency-Key": str(uuid4())},
        json={"name": "Otra sucursal"},
    ).json()["id"]
    assert client.get(BASE, headers={"X-Kova-Branch": branch}).json()["items"] == []
    assert (
        action(
            client, quote, "accept", branch=branch, confirmed_customer_acceptance=True
        ).status_code
        == 404
    )
    foreign_customer, foreign_product = customer, product
    tenant, customer, product = setup(client, db)
    assert client.get(BASE).json()["items"] == []
    assert action(client, quote, "accept", confirmed_customer_acceptance=True).status_code == 404
    assert create(client, foreign_customer, product).status_code == 404
    assert create(client, customer, foreign_product).status_code == 404
    member = db.query(Membership).filter_by(tenant_id=tenant).one()
    member.role = "cashier"
    db.commit()
    assert client.get(BASE).status_code == 403
    assert create(client, customer, product).status_code == 403


def test_billing_blocks_quotes(client, db):
    tenant, customer, product = setup(client, db)
    db.add(Subscription(tenant_id=tenant, status="canceled"))
    db.commit()
    assert client.get(BASE).status_code == 402
    assert create(client, customer, product).status_code == 402


def test_untrusted_price_timezone_duplicate_and_quantity_rejected(client, db):
    _, customer, product = setup(client, db)
    assert create(client, customer, product, expires_at="2027-01-01T12:00:00").status_code == 422
    assert create(client, customer, product, quantity=0).status_code == 422
    assert create(client, customer, product, quantity=100001).status_code == 422
    assert (
        create(
            client,
            customer,
            product,
            items=[
                {
                    "product_id": product["id"],
                    "quantity": 1,
                    "unit_price_amount": "0.01",
                }
            ],
        ).status_code
        == 422
    )
    assert (
        create(
            client,
            customer,
            product,
            items=[
                {"product_id": product["id"], "quantity": 1},
                {"product_id": product["id"], "quantity": 2},
            ],
        ).status_code
        == 422
    )
    assert (
        create(
            client,
            customer,
            product,
            expires_at=(datetime.now(UTC) - timedelta(seconds=1)).isoformat(),
        ).status_code
        == 400
    )


def test_failed_quote_commit_rolls_back_created_order(client, db, monkeypatch):
    tenant, customer, product = setup(client, db)
    quote = sent(client, customer, product)
    member = db.query(Membership).filter_by(tenant_id=tenant).one()
    bind_branch(db, tenant_id=tenant)

    def fail(*args, **kwargs):
        raise RuntimeError("test-only failure before outer quote commit")

    monkeypatch.setattr(service, "_finish", fail)
    with pytest.raises(RuntimeError, match="test-only failure"):
        service.accept(
            db,
            tenant_id=tenant,
            user_id=member.user_id,
            quote_id=UUID(quote["id"]),
            body=QuoteAccept(expected_version=quote["version"], confirmed_customer_acceptance=True),
            key=str(uuid4()),
        )
    db.rollback()
    assert db.query(CustomerOrder).filter_by(tenant_id=tenant).count() == 0
    stored = db.get(CustomerQuote, UUID(quote["id"]))
    assert stored.status == "sent" and stored.customer_order_id is None


def test_quote_tables_force_rls_and_runtime_cannot_edit_snapshot(db, kova_app_engine):
    for table in ("customer_quotes", "customer_quote_items"):
        flags = db.execute(
            text("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=:table"),
            {"table": table},
        ).one()
        assert flags.relrowsecurity and flags.relforcerowsecurity
        assert not db.execute(
            text("SELECT has_column_privilege('kova_app',:table,'tenant_id','UPDATE')"),
            {"table": table},
        ).scalar()
        assert not db.execute(
            text("SELECT has_table_privilege('kova_app',:table,'DELETE')"), {"table": table}
        ).scalar()
    assert not db.execute(
        text(
            "SELECT has_column_privilege('kova_app','customer_quote_items','unit_price_amount','UPDATE')"
        )
    ).scalar()


@pytest.fixture
def committed_quote(owner_engine):
    tenant_id, customer_id, product_id = uuid4(), uuid4(), uuid4()
    with Session(owner_engine) as db:
        db.add(
            Tenant(
                id=tenant_id,
                name="Concurrent quotes",
                slug=f"quotes-{tenant_id}",
                feature_overrides={"customer_orders": True},
            )
        )
        db.flush()
        db.execute(
            text(
                "INSERT INTO users(id,email,hashed_password,is_email_verified) "
                "VALUES(:id,:email,'test-only',true)"
            ),
            {"id": tenant_id, "email": f"quotes-{tenant_id}@example.com"},
        )
        db.execute(
            text("INSERT INTO memberships(tenant_id,user_id,role) VALUES(:id,:id,'owner')"),
            {"id": tenant_id},
        )
        db.add(Customer(id=customer_id, tenant_id=tenant_id, name="Concurrent customer"))
        db.add(
            Product(
                id=product_id,
                tenant_id=tenant_id,
                name="Concurrent product",
                price_amount=Decimal("12.50"),
                track_inventory=True,
            )
        )
        db.flush()
        bind_branch(db, tenant_id=tenant_id)
        _, created = service.create(
            db,
            tenant_id=tenant_id,
            user_id=tenant_id,
            body=QuoteCreate(
                customer_id=customer_id,
                expires_at=datetime.now(UTC) + timedelta(days=1),
                items=[{"product_id": product_id, "quantity": 3}],
            ),
            key=str(uuid4()),
        )
        _, shared = service.mark_sent(
            db,
            tenant_id=tenant_id,
            user_id=tenant_id,
            quote_id=UUID(created["id"]),
            body=QuoteShared(expected_version=1, confirmed_shared=True),
            key=str(uuid4()),
        )
    try:
        yield tenant_id, shared
    finally:
        with owner_engine.begin() as connection:
            for table in (
                "customer_quote_items",
                "customer_quotes",
                "customer_order_item_modifiers",
                "customer_order_items",
                "customer_orders",
                "customers",
                "audit_logs",
                "idempotency_keys",
                "products",
                "memberships",
                "branches",
                "tenants",
                "users",
            ):
                column = "id" if table in ("tenants", "users") else "tenant_id"
                connection.execute(
                    text(f"DELETE FROM {table} WHERE {column}=:tenant"), {"tenant": tenant_id}
                )


def test_concurrent_acceptance_creates_one_order(owner_engine, committed_quote):
    tenant_id, quote = committed_quote
    barrier = Barrier(2)

    def accept_once():
        with Session(owner_engine) as db:
            set_tenant_context(db, tenant_id)
            bind_branch(db, tenant_id=tenant_id)
            barrier.wait(timeout=10)
            try:
                status, _ = service.accept(
                    db,
                    tenant_id=tenant_id,
                    user_id=tenant_id,
                    quote_id=UUID(quote["id"]),
                    body=QuoteAccept(expected_version=2, confirmed_customer_acceptance=True),
                    key=str(uuid4()),
                )
                return status
            except HTTPException as exc:
                db.rollback()
                return exc.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: accept_once(), range(2)))
    assert sorted(results) == [200, 409]
    with Session(owner_engine) as db:
        assert db.query(CustomerOrder).filter_by(tenant_id=tenant_id).count() == 1
        assert db.query(InventoryReservation).filter_by(tenant_id=tenant_id).count() == 0
        assert db.query(Order).filter_by(tenant_id=tenant_id).count() == 0


def test_runtime_rls_rejects_foreign_quotes_and_snapshot_update(
    client,
    db,
    kova_app_engine,
):
    tenants, quotes = [], []
    for _ in range(2):
        tenant, customer, product = setup(client, db)
        tenants.append(tenant)
        quotes.append(create(client, customer, product).json())
    set_tenant_context(db, tenants[0])
    db.execute(text("SET LOCAL ROLE kova_app"))
    assert db.execute(text("SELECT id FROM customer_quotes")).scalars().all() == [
        UUID(quotes[0]["id"])
    ]
    assert (
        db.execute(
            text("UPDATE customer_quotes SET version=version+1 WHERE id=:id"),
            {"id": UUID(quotes[1]["id"])},
        ).rowcount
        == 0
    )
    with pytest.raises(DBAPIError) as denied:
        with db.begin_nested():
            db.execute(text("UPDATE customer_quote_items SET unit_price_amount=0 WHERE false"))
    assert denied.value.orig.sqlstate == "42501"


@pytest.mark.parametrize("change", ["modifier", "inactive"])
def test_catalog_capability_changes_reject_conversion(client, db, change):
    from app.modifiers.models import ModifierGroup, ProductModifierGroup

    tenant, customer, product = setup(client, db)
    quote = sent(client, customer, product)
    if change == "modifier":
        group = ModifierGroup(tenant_id=tenant, name="Opciones nuevas")
        db.add(group)
        db.flush()
        db.add(
            ProductModifierGroup(
                tenant_id=tenant,
                product_id=UUID(product["id"]),
                modifier_group_id=group.id,
            )
        )
    else:
        db.get(Product, UUID(product["id"])).is_active = False
    db.commit()
    rejected = action(client, quote, "accept", confirmed_customer_acceptance=True)
    assert rejected.status_code == 409, rejected.text
    assert db.query(CustomerOrder).filter_by(tenant_id=tenant).count() == 0
    if change == "modifier":
        assert create(client, customer, product).status_code == 400


def test_customer_phone_must_be_compatible_with_order_contract(client, db):
    tenant, customer, product = setup(client, db)
    stored = db.get(Customer, UUID(customer["id"]))
    stored.phone = "+12"
    db.commit()
    result = create(client, customer, product)
    assert result.status_code == 400, result.text
    assert "teléfono" in result.json()["detail"]
    assert db.query(CustomerQuote).filter_by(tenant_id=tenant).count() == 0
