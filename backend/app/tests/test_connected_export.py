import csv
import io
import zipfile

import pytest

from app.tests.test_appointments import book, resource
from app.tests.test_appointments import post as post_appointment
from app.tests.test_customer_order_identity import post, prepare

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def test_account_export_preserves_explicit_order_identity_and_appointment_sale_graph(client):
    _tenant, customer, body = prepare(client)
    order = post(client, "", {**body, "customer_id": customer["id"]})
    assert order.status_code == 201, order.text
    appointment = book(client, customer, resource(client))
    sale = client.post(
        "/api/v1/orders",
        json={
            "customer_id": customer["id"], "items": body["items"],
            "payments": [{"method": "manual_card", "amount": "50.00"}],
        },
        headers={"Idempotency-Key": "export-linked-service-sale"},
    )
    assert sale.status_code == 201, sale.text
    link = post_appointment(client, f"/{appointment['id']}/sale", {
        "expected_version": 1, "sale_order_id": sale.json()["id"],
    })
    assert link.status_code == 200, link.text
    exported = client.get("/api/v1/export/account")
    assert exported.status_code == 200, exported.text
    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        orders = list(csv.DictReader(io.StringIO(archive.read("datos/customer_orders.csv").decode())))
        assert len(orders) == 1
        assert orders[0]["id"] == order.json()["id"]
        assert orders[0]["customer_id"] == customer["id"]
        links = list(csv.DictReader(io.StringIO(archive.read("datos/appointment_sales.csv").decode())))
        assert len(links) == 1
        assert links[0]["appointment_id"] == appointment["id"]
        assert links[0]["sale_order_id"] == sale.json()["id"]
