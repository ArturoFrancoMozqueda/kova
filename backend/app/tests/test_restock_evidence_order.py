import pytest

from app.catalog.models import Product
from app.reports.service import _restock_alerts
from app.tests.test_customer_orders import _signup_login

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def test_equal_priority_stock_alerts_use_stable_name_order_before_sample_cap(client, db):
    tenant_id = _signup_login(client, prefix="stable-restock")
    for name in ("Zanahoria", "Almendra", "Harina"):
        db.add(Product(tenant_id=tenant_id, name=name, price_amount="35.00",
                       track_inventory=True, low_stock_threshold=5))
    db.flush()
    first = _restock_alerts(db, tenant_id=tenant_id)
    assert [row["product_name"] for row in first] == ["Almendra", "Harina", "Zanahoria"]
    assert {row["stock_on_hand"] for row in first} == {0}
    assert {row["severity"] for row in first} == {"warning"}
