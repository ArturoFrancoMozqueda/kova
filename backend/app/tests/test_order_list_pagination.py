from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest

from app.branches.models import Branch
from app.branches.scope import transfer_branches
from app.orders.models import Order
from app.tests.test_orders import _signup_verify_login

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def test_orders_sort_all_matching_rows_before_pagination_and_keep_scope(client, db):
    first = _signup_verify_login(client, "list-owner@example.com", "Sales List")
    tenant = UUID(first["tenant_id"])
    other = _signup_verify_login(client, "other-list@example.com", "Other Sales")
    other_tenant = UUID(other["tenant_id"])
    branch = Branch(id=uuid4(), tenant_id=tenant, name="Other branch")
    db.add(branch)
    db.flush()
    start = datetime(2026, 1, 1, tzinfo=UTC)
    orders = [Order(
        tenant_id=tenant, status="completed", subtotal_amount=Decimal(60 - i),
        total_amount=Decimal(60 - i), occurred_at=start + timedelta(days=i),
    ) for i in range(60)]
    db.add_all(orders)
    # Prepare deliberately out-of-scope history through the owner fixture,
    # retaining the application's normal branch stamp guard.
    with transfer_branches(db, {branch.id}):
        db.add_all([
            Order(tenant_id=other_tenant, total_amount=9999, subtotal_amount=9999),
            Order(tenant_id=tenant, branch_id=branch.id, total_amount=9999, subtotal_amount=9999),
        ])
        db.flush()
    db.commit()
    login = client.post("/api/v1/auth/login", json={"email": "list-owner@example.com", "password": "S3cur3pass!"})
    assert login.status_code == 200

    for sort, expected in [
        ("created_asc", orders), ("created_desc", list(reversed(orders))),
        ("amount_desc", orders), ("amount_asc", list(reversed(orders))),
    ]:
        first_page = client.get("/api/v1/orders", params={"sort": sort}).json()
        second_page = client.get("/api/v1/orders", params={"sort": sort, "offset": 50}).json()
        assert first_page["total"] == second_page["total"] == 60
        assert len(first_page["items"]) == 50
        assert len(second_page["items"]) == 10
        assert [row["id"] for row in first_page["items"] + second_page["items"]] == [str(order.id) for order in expected]

    newest = client.get("/api/v1/orders?limit=1").json()
    assert newest["items"][0]["id"] == str(orders[-1].id)
    assert client.get("/api/v1/orders?sort=invalid").status_code == 422


def test_orders_ties_have_stable_pagination(client, db):
    signup = _signup_verify_login(client, "list-ties@example.com", "Tied Sales")
    tenant = UUID(signup["tenant_id"])
    when = datetime(2026, 1, 1, tzinfo=UTC)
    orders = [Order(tenant_id=tenant, subtotal_amount=10, total_amount=10, occurred_at=when) for _ in range(3)]
    db.add_all(orders)
    db.commit()
    for sort in ("created_asc", "created_desc", "amount_asc", "amount_desc"):
        seen = [client.get("/api/v1/orders", params={"sort": sort, "limit": 1, "offset": i}).json()["items"][0]["id"] for i in range(3)]
        expected = sorted((str(order.id) for order in orders), reverse=sort.endswith("desc"))
        assert seen == expected
