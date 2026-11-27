"""Find a past sale by its receipt folio or by the customer it was charged to."""

from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from app.customers.models import Customer
from app.orders import repository
from app.orders.models import Order
from app.tests.test_orders import _signup_verify_login

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _seed(client, db):
    email = f"busqueda-{uuid4().hex}@example.com"
    tenant = UUID(_signup_verify_login(client, email, "Cafetería")["tenant_id"])
    maria = Customer(tenant_id=tenant, name="María Fernanda López", phone="5512345678")
    pedro = Customer(tenant_id=tenant, name="Pedro 100% Ruiz", email="pedro@example.com")
    db.add_all([maria, pedro])
    db.flush()
    orders = [
        Order(tenant_id=tenant, status="completed", subtotal_amount=Decimal("55.00"),
              total_amount=Decimal("55.00"), customer_id=maria.id),
        Order(tenant_id=tenant, status="voided", subtotal_amount=Decimal("40.00"),
              total_amount=Decimal("40.00"), customer_id=maria.id),
        Order(tenant_id=tenant, status="completed", subtotal_amount=Decimal("30.00"),
              total_amount=Decimal("30.00"), customer_id=pedro.id),
        Order(tenant_id=tenant, status="completed", subtotal_amount=Decimal("20.00"),
              total_amount=Decimal("20.00")),
    ]
    db.add_all(orders)
    db.commit()
    return tenant, orders


def _search(client, **params):
    response = client.get("/api/v1/orders", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _ids(page) -> set[str]:
    return {row["id"] for row in page["items"]}


def test_search_by_folio_whole_or_last_digits(client, db):
    _, orders = _seed(client, db)
    anonymous = orders[3]
    folio = anonymous.id.hex[-8:].upper()

    page = _search(client, q=folio)
    assert (_ids(page), page["total"]) == ({str(anonymous.id)}, 1)
    assert page["items"][0]["receipt_number"] == folio
    assert page["items"][0]["customer_name"] is None
    # Typed as printed (#), lowercase or only the last digits.
    assert str(anonymous.id) in _ids(_search(client, q=f"#{folio.lower()}"))
    assert str(anonymous.id) in _ids(_search(client, q=folio[-4:]))


def test_search_by_customer_name_phone_or_email(client, db):
    _, orders = _seed(client, db)
    maria_sales = {str(orders[0].id), str(orders[1].id)}

    page = _search(client, q="maría fer")
    assert (_ids(page), page["total"]) == (maria_sales, 2)
    assert {row["customer_name"] for row in page["items"]} == {"María Fernanda López"}
    assert _ids(_search(client, q="12345678")) == maria_sales
    assert _ids(_search(client, q="pedro@example")) == {str(orders[2].id)}
    # Search narrows the other filters instead of replacing them.
    assert _ids(_search(client, q="María", status="completed")) == {str(orders[0].id)}
    # Wildcards are literal text, not "match everything".
    assert _ids(_search(client, q="100%")) == {str(orders[2].id)}
    assert _search(client, q="%_")["total"] == 0


def test_search_stays_inside_the_business(client, db):
    _, orders = _seed(client, db)
    folio = orders[0].id.hex[-8:]
    client.post("/api/v1/auth/logout")
    client.cookies.clear()
    _seed(client, db)
    assert str(orders[0].id) not in _ids(_search(client, q=folio))
    assert _search(client, q="María")["total"] == 2  # only this business's María


def test_search_rejects_one_character(client, db):
    _seed(client, db)
    assert client.get("/api/v1/orders", params={"q": "a"}).status_code == 422
    assert _search(client, q="  ")["total"] == 4


def test_full_folio_lookup_uses_the_folio_index(client, db):
    tenant, orders = _seed(client, db)
    # Enough history that scanning the tenant costs more than the folio index;
    # with a handful of rows the planner may rightly pick any tenant index.
    db.execute(text(
        "INSERT INTO orders (id, tenant_id, branch_id, status, subtotal_amount, total_amount, "
        "created_at) SELECT gen_random_uuid(), :tenant, :branch, 'completed', 10, 10, now() "
        "FROM generate_series(1, 3000)"
    ), {"tenant": tenant, "branch": orders[0].branch_id})
    db.execute(text("ANALYZE orders"))
    query = repository._search_filter(
        db.query(Order.id).filter(Order.tenant_id == tenant),
        tenant_id=tenant, q=orders[0].id.hex[-8:], customers=False,
    )
    sql = str(query.statement.compile(db.get_bind(), compile_kwargs={"literal_binds": True}))
    db.execute(text("SET LOCAL enable_seqscan = off"))
    plan = "\n".join(row[0] for row in db.execute(text(f"EXPLAIN {sql}")))
    db.rollback()
    assert "ix_orders_tenant_folio" in plan, plan
