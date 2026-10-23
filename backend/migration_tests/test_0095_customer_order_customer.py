"""A nullable explicit identity preserves old orders and cannot discard new attribution."""

from decimal import Decimal
from uuid import uuid4

from sqlalchemy import text

from migration_tests.test_0068_branches import _database, _migrate


def test_customer_order_identity_preserves_existing_orders_and_rejects_data_loss():
    with _database() as (url, engine):
        baseline = _migrate(url, "upgrade", "0094_appointment_sales")
        assert baseline.returncode == 0, baseline.stderr
        tenant, customer, order = uuid4(), uuid4(), uuid4()
        with engine.begin() as connection:
            connection.execute(
                text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Comercio migration',:slug)"),
                {"id": tenant, "slug": str(tenant)},
            )
            connection.execute(
                text("INSERT INTO customers(id,tenant_id,name) "
                     "VALUES(:id,:tenant,'Cliente explícito')"),
                {"id": customer, "tenant": tenant},
            )
            connection.execute(
                text("INSERT INTO customer_orders(id,tenant_id,branch_id,folio,status,"
                     "fulfillment_type,source_channel,subtotal_amount,total_amount,"
                     "created_at,updated_at) "
                     "VALUES(:id,:tenant,:tenant,'PED-EXISTE','new','pickup','counter',125.50,125.50,now(),now())"),
                {"id": order, "tenant": tenant},
            )
        applied = _migrate(url, "upgrade", "0095_customer_order_customer")
        assert applied.returncode == 0, applied.stderr
        with engine.connect() as connection:
            row = connection.execute(
                text("SELECT total_amount,customer_id FROM customer_orders WHERE id=:id"),
                {"id": order},
            ).one()
            assert tuple(row) == (Decimal("125.50"), None)
        empty = _migrate(url, "downgrade", "0094_appointment_sales")
        assert empty.returncode == 0, empty.stderr
        applied = _migrate(url, "upgrade", "0095_customer_order_customer")
        assert applied.returncode == 0, applied.stderr
        with engine.begin() as connection:
            connection.execute(
                text("UPDATE customer_orders SET customer_id=:customer WHERE id=:id"),
                {"id": order, "customer": customer},
            )
        blocked = _migrate(url, "downgrade", "0094_appointment_sales")
        assert blocked.returncode != 0
        assert "Cannot discard explicit order customer attribution" in blocked.stderr
        with engine.connect() as connection:
            assert connection.scalar(
                text("SELECT customer_id FROM customer_orders WHERE id=:id"), {"id": order},
            ) == customer
