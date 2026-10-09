from uuid import uuid4

import pytest

from app.tests.test_customer_orders import _enable_customer_orders, _product, _signup_login

pytestmark = pytest.mark.usefixtures("fast_business_auth")



@pytest.mark.parametrize("needle", ["%", "_", "\\"])
def test_order_search_treats_pattern_characters_as_literal_text(client, db, needle):
    tenant_id = _signup_login(client, prefix="literal-search")
    _enable_customer_orders(db, tenant_id)
    product = _product(client)
    order_ids = []
    for name in [f"Cliente{needle}A", "ClienteXA"]:
        response = client.post(
            "/api/v1/customer-orders",
            headers={"Idempotency-Key": f"literal-{uuid4().hex}"},
            json={"fulfillment_type": "pickup", "source_channel": "counter",
                  "customer_name": name,
                  "items": [{"product_id": product["id"], "quantity": 1}]},
        )
        assert response.status_code == 201, response.text
        order_ids.append(response.json()["id"])
    result = client.get("/api/v1/customer-orders", params={"search": needle, "limit": 1})
    assert result.status_code == 200, result.text
    assert result.json()["total"] == 1
    assert [item["id"] for item in result.json()["items"]] == [order_ids[0]]
    ordinary = client.get("/api/v1/customer-orders", params={"search": "clientexa"})
    assert [item["id"] for item in ordinary.json()["items"]] == [order_ids[1]]
