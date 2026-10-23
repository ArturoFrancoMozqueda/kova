from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, text

from app.auth.models import Membership
from app.billing.models import Subscription
from app.branches.scope import bind_branch
from app.customers.activity import read_activity
from app.customers.models import Customer
from app.db import set_tenant_context
from app.orders.models import Order
from app.tests.test_customers_barcodes import _customer
from app.tests.test_operations_queue import seed, setup

pytestmark = pytest.mark.usefixtures("fast_business_auth")
BASE = "/api/v1/customers"


def sections(result):
    return {item["source"]: item for item in result["sections"]}


def test_exact_customer_read_active_inactive_and_tenant_boundaries(client, db):
    tenant, customer, _actor = setup(client, db)
    url = f"{BASE}/{customer.id}"
    result = client.get(url)
    assert result.status_code == 200, result.text
    assert result.json()["id"] == str(customer.id)
    assert "tenant_id" not in result.json()
    customer.is_active = False
    db.commit()
    assert client.get(url).json()["is_active"] is False
    assert client.get(f"{BASE}/{uuid4()}").status_code == 404
    other, _customer_row, _actor = setup(client, db)
    assert other != tenant
    assert client.get(url).status_code == 404
    assert client.get(url + "/activity").status_code == 404


def test_customer_context_is_branch_and_customer_scoped_with_real_states(client, db):
    tenant, customer, actor = setup(client, db)
    records = seed(db, tenant, customer, actor)
    other = _customer(client, key="other-customer", name="Otro cliente")
    other_row = db.get(Customer, UUID(other["id"]))
    seed(db, tenant, other_row, actor, suffix=" no corresponde")
    branch = client.post(
        "/api/v1/branches", json={"name": "Sucursal dos"},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert branch.status_code == 201, branch.text
    seed(db, tenant, customer, actor, branch=UUID(branch.json()["id"]), suffix=" otra sucursal")
    records[1].stage = "lost"
    records[2].status = "completed"
    records[3].status = "cancelled"
    db.commit()
    response = client.get(f"{BASE}/{customer.id}/activity")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["branch_id"] == str(tenant)
    rows = sections(result)
    for source, row, state in (
        ("appointments", records[3], "cancelled"),
        ("opportunities", records[1], "lost"),
        ("followups", records[2], "completed"),
        ("service_cases", records[0], "open"),
    ):
        assert len(rows[source]["items"]) == 1
        item = rows[source]["items"][0]
        assert item["id"] == str(row.id)
        assert item["state"] == state
        assert set(item) == {"id", "title", "state", "created_at", "due_at"}
    for private in (customer.phone, customer.email, "Nota privada", "estimated_amount"):
        assert private not in str(result)
    scoped = client.get(
        f"{BASE}/{customer.id}/activity",
        headers={"X-Kova-Branch": branch.json()["id"]},
    )
    assert scoped.status_code == 200
    assert all(
        len(section["items"]) == 1 for section in scoped.json()["sections"]
        if section["source"] != "customer_orders"
    )
    assert scoped.json()["branch_id"] == branch.json()["id"]


def test_activity_is_bounded_deterministic_projection_without_writes(client, db):
    tenant, customer, actor = setup(client, db)
    for index in range(11):
        seed(db, tenant, customer, actor, suffix=str(index))
    customer_id = customer.id
    statements = []

    def capture(_conn, _cursor, statement, parameters, _context, _many):
        statements.append((statement, parameters))

    connection = db.connection()
    event.listen(connection, "before_cursor_execute", capture)
    try:
        result = read_activity(db, tenant_id=tenant, customer_id=customer_id)
    finally:
        event.remove(connection, "before_cursor_execute", capture)
    assert len(statements) == 5
    for statement, params in statements:
        assert statement.lstrip().startswith("SELECT")
        assert "LIMIT" in statement
        assert 11 in (params.values() if isinstance(params, dict) else params)
        assert not any(value in statement for value in (".note", ".email", ".phone"))
    assert all(
        len(section.items) == 10 and section.has_more for section in result.sections
        if section.source != "customer_orders"
    )
    assert result == read_activity(db, tenant_id=tenant, customer_id=customer_id)


def test_activity_and_exact_customer_preserve_roles_billing_and_private_cache(client, db):
    tenant, customer, actor = setup(client, db)
    member = db.query(Membership).filter_by(tenant_id=tenant, user_id=actor).one()
    url = f"{BASE}/{customer.id}"
    for role in ("owner", "manager"):
        member.role = role
        db.commit()
        result = client.get(url + "/activity")
        assert result.status_code == 200, result.text
        assert "no-store" in result.headers["cache-control"]
    for role in ("cashier", "staff"):
        member.role = role
        db.commit()
        assert client.get(url).status_code == 200
        assert client.get(url + "/activity").status_code == 403
    member.role = "owner"
    db.add(Subscription(tenant_id=tenant, status="canceled"))
    db.commit()
    assert client.get(url).status_code == 402
    assert client.get(url + "/activity").status_code == 402
    client.cookies.clear()
    assert client.get(url).status_code == 401


def test_customer_activity_runtime_rls_denies_cross_tenant_direct_calls(client, db, kova_app_engine):
    tenant, customer, actor = setup(client, db)
    seed(db, tenant, customer, actor)
    foreign, other_customer, other_actor = setup(client, db)
    seed(db, foreign, other_customer, other_actor)
    customer_id, other_customer_id = customer.id, other_customer.id
    db.execute(text("SET LOCAL ROLE kova_app"))
    set_tenant_context(db, tenant)
    own = read_activity(db, tenant_id=tenant, customer_id=customer_id)
    assert all(
        len(section.items) == 1 for section in own.sections if section.source != "customer_orders"
    )
    hidden = read_activity(db, tenant_id=foreign, customer_id=other_customer_id)
    assert all(not section.items for section in hidden.sections)
    db.execute(text("RESET ROLE"))


def test_customer_purchase_history_keeps_selected_branch_scope(client, db):
    tenant, customer, _actor = setup(client, db)
    branch = client.post(
        "/api/v1/branches", json={"name": "Historial sucursal dos"},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert branch.status_code == 201, branch.text
    second = UUID(branch.json()["id"])
    ids = []
    for selected in (tenant, second):
        bind_branch(db, tenant_id=tenant, branch_id=selected)
        row = Order(
            tenant_id=tenant, branch_id=selected, customer_id=customer.id,
            status="completed", subtotal_amount=50, total_amount=50,
        )
        db.add(row)
        db.flush()
        ids.append(str(row.id))
    db.commit()
    db.info.pop("kova_branch_id", None)
    path = f"{BASE}/{customer.id}/history"
    assert [row["id"] for row in client.get(path).json()["purchases"]] == [ids[0]]
    scoped = client.get(path, headers={"X-Kova-Branch": str(second)})
    assert scoped.status_code == 200, scoped.text
    assert [row["id"] for row in scoped.json()["purchases"]] == [ids[1]]
