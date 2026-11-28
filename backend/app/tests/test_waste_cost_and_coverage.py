"""Waste keeps the cost it had when recorded, and stock coverage is projected from 7 days of use."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest

from app.orders.models import InventoryMovement
from app.tests.test_report_margins import _add_stock, _create_product, _signup_verify_login

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _waste(client, product: dict, quantity: int, code: str = "merma") -> dict:
    response = client.post(
        f"/api/v1/inventory/products/{product['id']}/adjustments",
        headers={"Idempotency-Key": str(uuid4())},
        json={"quantity_delta": -quantity, "reason": "Se maltrató", "reason_code": code},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_a_later_price_change_does_not_rewrite_past_waste(client, db) -> None:
    _signup_verify_login(client)
    bread = _create_product(client, name="Bolillo", cost="2.00")
    _add_stock(client, bread["id"], 20)
    recorded = _waste(client, bread, 3)  # 3 × $2 = $6
    stored = db.query(InventoryMovement).filter(InventoryMovement.id == UUID(recorded["id"])).one()
    assert stored.unit_cost == Decimal("2.000000")

    raised = client.patch(f"/api/v1/catalog/products/{bread['id']}", json={"cost_price": "5.00"},
                          headers={"Idempotency-Key": str(uuid4())})
    assert raised.status_code == 200, raised.text
    _waste(client, bread, 1)  # 1 × $5 = $5

    waste = client.get("/api/v1/reports/business-story").json()["waste"]
    assert (waste["units"], Decimal(waste["value"]), waste["complete"]) == (4, Decimal("11.00"), True)


def test_waste_recorded_before_the_cost_snapshot_keeps_todays_cost(client, db) -> None:
    _signup_verify_login(client)
    bread = _create_product(client, name="Concha", cost="8.00")
    _add_stock(client, bread["id"], 5)
    legacy = _waste(client, bread, 2)
    # Rows written before 0118 (or by an older app version) have no cost of their own.
    db.query(InventoryMovement).filter(InventoryMovement.id == UUID(legacy["id"])).update(
        {"unit_cost": None})
    db.commit()
    waste = client.get("/api/v1/reports/business-story").json()["waste"]
    assert Decimal(waste["value"]) == Decimal("16.00")


def test_coverage_projects_days_from_the_last_seven_days_of_use(client, db) -> None:
    _signup_verify_login(client)
    fast = _create_product(client, name="Rápido", cost="1.00")
    idle = _create_product(client, name="Quieto", cost="1.00")
    _add_stock(client, fast["id"], 10)
    _add_stock(client, idle["id"], 4)
    tenant_id = db.query(InventoryMovement.tenant_id).filter(
        InventoryMovement.product_id == UUID(fast["id"])).first()[0]
    now = datetime.now(UTC)
    db.add_all([
        # 14 units sold in the window (sales and recipe consumption both count) → 2 a day.
        InventoryMovement(tenant_id=tenant_id, product_id=UUID(fast["id"]), movement_type="sale",
                          quantity_delta=-10, created_at=now - timedelta(days=2)),
        InventoryMovement(tenant_id=tenant_id, product_id=UUID(fast["id"]),
                          movement_type="consumption", quantity_delta=-4,
                          created_at=now - timedelta(days=1)),
        # Outside the 7-day window: ignored.
        InventoryMovement(tenant_id=tenant_id, product_id=UUID(fast["id"]), movement_type="sale",
                          quantity_delta=-50, created_at=now - timedelta(days=9)),
    ])
    db.commit()
    rows = client.get("/api/v1/inventory/velocity").json()
    by_name = {row["product_name"]: row for row in rows}
    stock = by_name["Rápido"]["stock_on_hand"]
    assert Decimal(by_name["Rápido"]["units_per_day_7d"]) == Decimal("2.00")
    assert Decimal(by_name["Rápido"]["days_until_out"]) == (
        Decimal(stock) / Decimal("2.00")).quantize(Decimal("0.1"))
    # No use in the window: no projection, and it sorts after the ones that will run out.
    assert by_name["Quieto"]["days_until_out"] is None
    assert [row["product_name"] for row in rows].index("Rápido") < [
        row["product_name"] for row in rows].index("Quieto")
