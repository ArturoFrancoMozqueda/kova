"""Upgrade populated stores safely and refuse to erase new operating history."""

import os
import subprocess
import sys
from uuid import uuid4

import pytest
from sqlalchemy import text

from migration_tests.test_0065_tenant_hardening import (
    BACKEND_ROOT,
    _run_alembic,
    _temporary_database,
)


def _seed_store(connection):
    tenant, product, order, user, destination = (uuid4() for _ in range(5))
    connection.execute(
        text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Existing shop', :slug)"),
        {"id": tenant, "slug": str(tenant)},
    )
    connection.execute(
        text(
            "INSERT INTO products (id, tenant_id, name, price_amount) "
            "VALUES (:id, :tenant, 'Existing bread', 100)"
        ),
        {"id": product, "tenant": tenant},
    )
    connection.execute(
        text(
            "INSERT INTO orders (id, tenant_id, status, subtotal_amount, total_amount) "
            "VALUES (:id, :tenant, 'completed', 100, 100)"
        ),
        {"id": order, "tenant": tenant},
    )
    connection.execute(
        text("INSERT INTO users (id, email, hashed_password) VALUES (:id, :email, 'hash')"),
        {"id": user, "email": f"{user}@example.com"},
    )
    connection.execute(
        text("INSERT INTO branches (id, tenant_id, name) VALUES (:id, :tenant, 'Destination')"),
        {"id": destination, "tenant": tenant},
    )
    return {
        "tenant": tenant,
        "product": product,
        "order": order,
        "user": user,
        "destination": destination,
        "id": uuid4(),
    }


def test_upgrade_keeps_legacy_sale_values_and_product_identity():
    with _temporary_database() as (url, engine):
        _run_alembic(url, "0068_branches")
        with engine.begin() as connection:
            ids = _seed_store(connection)
        _run_alembic(url, "head")
        with engine.connect() as connection:
            row = connection.execute(
                text(
                    "SELECT subtotal_amount, total_amount, discount_amount, tax_amount, "
                    "tax_rate, customer_id, branch_id FROM orders WHERE id = :order"
                ),
                ids,
            ).one()
            assert tuple(row[:5]) == (100, 100, 0, 0, 0)
            assert row.customer_id is None
            assert row.branch_id == ids["tenant"]
            product = connection.execute(
                text("SELECT name, price_amount, barcode FROM products WHERE id = :product"),
                ids,
            ).one()
            assert tuple(product) == ("Existing bread", 100, None)
            for table in (
                "customers",
                "suppliers",
                "purchase_orders",
                "purchase_order_items",
                "inventory_transfers",
                "fiscal_issuer_profiles",
                "invoice_requests",
            ):
                assert connection.scalar(text(f"SELECT count(*) FROM {table}")) == 0


@pytest.mark.parametrize(
    ("target", "statement", "message", "history_table"),
    [
        (
            "0068_branches",
            "UPDATE orders SET discount_amount = 10, total_amount = 90 WHERE id = :order",
            "Cannot remove pricing snapshots",
            "orders",
        ),
        (
            "0069_sales_pricing",
            "INSERT INTO customers (id, tenant_id, name) VALUES (:id, :tenant, 'Regular')",
            "Cannot discard customer or barcode data",
            "customers",
        ),
        (
            "0070_customers_barcodes",
            "INSERT INTO suppliers (id, tenant_id, name, is_active, created_at) "
            "VALUES (:id, :tenant, 'Mill', true, now())",
            "Cannot discard purchasing records",
            "suppliers",
        ),
        (
            "0071_purchasing",
            "INSERT INTO inventory_transfers (id, tenant_id, source_branch_id, "
            "destination_branch_id, product_id, product_name, quantity, reason, "
            "created_by_user_id) "
            "VALUES (:id, :tenant, :tenant, :destination, :product, 'Existing bread', "
            "1, 'Restock', :user)",
            "Cannot downgrade recorded inventory transfers",
            "inventory_transfers",
        ),
        (
            "0071_purchasing",
            "INSERT INTO memberships (id, tenant_id, user_id, role, is_active, "
            "allowed_branch_id, created_at) "
            "VALUES (:id, :tenant, :user, 'staff', true, :destination, now())",
            "Cannot downgrade recorded inventory transfers",
            "memberships",
        ),
        (
            "0072_branch_transfers",
            "INSERT INTO fiscal_issuer_profiles (tenant_id, fiscal_data) VALUES (:tenant, '{}')",
            "Cannot erase fiscal request/profile data",
            "fiscal_issuer_profiles",
        ),
    ],
)
def test_downgrade_refuses_to_erase_new_business_history(target, statement, message, history_table):
    with _temporary_database() as (url, engine):
        _run_alembic(url, "head")
        with engine.begin() as connection:
            ids = _seed_store(connection)
            connection.execute(text(statement), ids)
            before = connection.scalar(text("SELECT version_num FROM alembic_version"))
        env = {
            **os.environ,
            "APP_ENV": "local",
            "DATABASE_URL": str(url),
            "MIGRATION_DATABASE_URL": url.render_as_string(hide_password=False),
        }
        # str(URL) hides passwords; both selectors must be usable by Alembic.
        env["DATABASE_URL"] = env["MIGRATION_DATABASE_URL"]
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", target],
            cwd=BACKEND_ROOT,
            env=env,
            capture_output=True,
            text=True,
        )
        assert result.returncode != 0
        assert message in result.stderr
        with engine.connect() as connection:
            # PostgreSQL rolls back earlier DDL in the same failed downgrade.
            assert connection.scalar(text("SELECT version_num FROM alembic_version")) == before
            assert (
                connection.scalar(
                    text(f"SELECT count(*) FROM {history_table} WHERE tenant_id = :tenant"),
                    ids,
                )
                == 1
            )
            assert connection.scalar(
                text("SELECT total_amount FROM orders WHERE id = :order"),
                ids,
            ) == (90 if history_table == "orders" else 100)
