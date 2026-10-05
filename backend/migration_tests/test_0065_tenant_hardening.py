"""PostgreSQL coverage for tenant-safe FKs, RLS semantics, and grants."""

import os
import shutil
import subprocess
import sys
import uuid
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import JSON, LargeBinary, MetaData, create_engine, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app import db as app_db

BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROVISION_SCRIPT = BACKEND_ROOT / "scripts" / "provision_app_role.sql"
TENANT_A = uuid.UUID("10000000-0000-0000-0000-000000000065")
TENANT_B = uuid.UUID("20000000-0000-0000-0000-000000000065")
PRODUCT_A = uuid.UUID("30000000-0000-0000-0000-000000000065")
PRODUCT_B = uuid.UUID("40000000-0000-0000-0000-000000000065")
ORDER_A = uuid.UUID("50000000-0000-0000-0000-000000000065")
ORDER_ITEM_A = uuid.UUID("60000000-0000-0000-0000-000000000065")
REFUND_A = uuid.UUID("70000000-0000-0000-0000-000000000065")
REFUND_ITEM_A = uuid.UUID("80000000-0000-0000-0000-000000000065")
CUSTOMER_ORDER_A = uuid.UUID("90000000-0000-0000-0000-000000000065")
CUSTOMER_ORDER_ITEM_A = uuid.UUID("91000000-0000-0000-0000-000000000065")
USER_A = uuid.UUID("a0000000-0000-0000-0000-000000000065")
USER_B = uuid.UUID("b0000000-0000-0000-0000-000000000065")

_RUNTIME_TABLE_PRIVILEGES = {
    **{
        table: {"SELECT", "INSERT", "UPDATE", "DELETE"}
        for table in (
            "expenses",
            "product_image_files",
            "tenant_logo_files",
        )
    },
    **{
        table: {"SELECT", "INSERT", "DELETE"}
        for table in (
            "customer_order_item_modifiers",
            "customer_order_items",
            "product_modifier_groups",
        )
    },
    **{
        table: {"SELECT", "INSERT", "UPDATE"}
        for table in (
            "account_deletion_requests",
            "categories",
            "customer_orders",
            "idempotency_keys",
            "inventory_reservations",
            "membership_invitations",
            "modifier_groups",
            "modifier_options",
            "orders",
            "products",
            "shifts",
            "subscriptions",
            "tenant_business_profiles",
            "tenant_onboarding_state",
            "tenant_receipt_settings",
        )
    },
    "branches": {"SELECT", "INSERT"},
    "memberships": {"SELECT", "UPDATE"},
    "sessions": {"SELECT", "UPDATE"},
    **{
        table: {"SELECT", "INSERT"}
        for table in (
            "cash_movements",
            "inventory_movements",
            "order_item_modifiers",
            "order_items",
            "payments",
            "refund_items",
            "refunds",
            "voids",
            "order_fiscal_snapshots",
            "order_item_fiscal_snapshots",
            "order_item_tax_snapshots",
            "fiscal_global_draft_batches",
            "fiscal_global_draft_orders",
            "fiscal_individual_invoice_events",
            "fiscal_global_draft_adjustments",
        )
    },
    "audit_logs": {"INSERT"},
    "telemetry_events": {"INSERT"},
    "fiscal_global_draft_settings": {"SELECT", "INSERT", "UPDATE"},
    "anonymous_telemetry_events": {"INSERT"},
    "tenants": {"SELECT"},
    "users": {"SELECT"},
}
_TENANT_RELATIONS = {
    "fk_products_tenant_category": ("products", "category_id", "categories"),
    "fk_product_images_tenant_product": ("product_image_files", "product_id", "products"),
    "fk_order_items_tenant_order": ("order_items", "order_id", "orders"),
    "fk_order_items_tenant_product": ("order_items", "product_id", "products"),
    "fk_payments_tenant_order": ("payments", "order_id", "orders"),
    "fk_inventory_movements_tenant_product": (
        "inventory_movements",
        "product_id",
        "products",
    ),
    "fk_inventory_movements_tenant_order": ("inventory_movements", "order_id", "orders"),
    "fk_refunds_tenant_order": ("refunds", "order_id", "orders"),
    "fk_voids_tenant_order": ("voids", "order_id", "orders"),
    "fk_refund_items_tenant_refund": ("refund_items", "refund_id", "refunds"),
    "fk_refund_items_tenant_order_item": ("refund_items", "order_item_id", "order_items"),
    "fk_orders_tenant_shift": ("orders", "shift_id", "shifts"),
    "fk_cash_movements_tenant_shift": ("cash_movements", "shift_id", "shifts"),
    "fk_customer_orders_tenant_sale": ("customer_orders", "sale_order_id", "orders"),
    "fk_customer_order_items_tenant_order": (
        "customer_order_items",
        "customer_order_id",
        "customer_orders",
    ),
    "fk_customer_order_items_tenant_product": (
        "customer_order_items",
        "product_id",
        "products",
    ),
    "fk_customer_order_item_modifiers_tenant_item": (
        "customer_order_item_modifiers",
        "customer_order_item_id",
        "customer_order_items",
    ),
    "fk_customer_order_item_modifiers_tenant_group": (
        "customer_order_item_modifiers",
        "modifier_group_id",
        "modifier_groups",
    ),
    "fk_customer_order_item_modifiers_tenant_option": (
        "customer_order_item_modifiers",
        "modifier_option_id",
        "modifier_options",
    ),
    "fk_inventory_reservations_tenant_order": (
        "inventory_reservations",
        "customer_order_id",
        "customer_orders",
    ),
    "fk_inventory_reservations_tenant_product": (
        "inventory_reservations",
        "product_id",
        "products",
    ),
}

_SPECIAL_RUNTIME_TABLES = {"anonymous_telemetry_events", "tenants", "users"}
_SEMANTIC_INSERT_ORDER = (
    "account_deletion_requests",
    "audit_logs",
    "categories",
    "expenses",
    "fiscal_global_draft_settings",
    "idempotency_keys",
    "membership_invitations",
    "memberships",
    "modifier_groups",
    "sessions",
    "shifts",
    "subscriptions",
    "telemetry_events",
    "tenant_business_profiles",
    "tenant_logo_files",
    "tenant_onboarding_state",
    "tenant_receipt_settings",
    "webhook_events",
    "orders",
    "products",
    "modifier_options",
    "cash_movements",
    "customer_orders",
    "inventory_movements",
    "order_items",
    "payments",
    "product_image_files",
    "product_modifier_groups",
    "refunds",
    "voids",
    "customer_order_items",
    "inventory_reservations",
    "order_fiscal_snapshots",
    "fiscal_global_draft_batches",
    "fiscal_global_draft_orders",
    "fiscal_individual_invoice_events",
    "order_item_fiscal_snapshots",
    "order_item_modifiers",
    "order_item_tax_snapshots",
    "refund_items",
    "fiscal_global_draft_adjustments",
    "customer_order_item_modifiers",
)


def _semantic_uuid(table: str, tenant: uuid.UUID, variant: int = 0) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_URL, f"kova-0067:{table}:{tenant}:{variant}")


def _semantic_value(table, column, tenant: uuid.UUID, variant: int, ids):
    name = column.name
    tenant_token = str(tenant).split("-")[0]
    token = f"{tenant_token}-{variant}-{table.name}"
    if name in {"tenant_id", "branch_id"}:
        return tenant
    if name == "id":
        return ids[(table.name, tenant, variant)]

    for foreign_key in column.foreign_keys:
        parent = foreign_key.column.table.name
        parent_column = foreign_key.column.name
        if parent == "users" and parent_column == "id":
            return USER_A if tenant == TENANT_A else USER_B
        if parent == "tenants" and parent_column == "id":
            return tenant
        if parent_column == "id" and (parent, tenant, variant) in ids:
            return ids[(parent, tenant, variant)]

    named_values = {
        "action": "semantic_test",
        "adjustment_type": "late_inclusion",
        "category": "renta",
        "client_id": f"client-{token}",
        "currency": "MXN",
        "direction": "transfer",
        "document_kind": "operational_draft",
        "event_name": "landing_viewed",
        "factor_type": "rate",
        "fiscal_status": "not_issued",
        "frequency": "monthly",
        "fulfillment_type": "pickup",
        "ingest_source": "client",
        "individual_fiscal_status": "none",
        "method": "cash",
        "movement_type": "adjustment",
        "processing_status": "received",
        "refund_payment_method": "cash",
        "role": "owner",
        "source_channel": "counter",
        "status": {
            "account_deletion_requests": "pending",
            "customer_orders": "new",
            "fiscal_global_draft_batches": "closed",
            "fiscal_individual_invoice_events": "reopened",
            "inventory_reservations": "active",
            "membership_invitations": "pending",
            "orders": "completed",
            "shifts": "open",
            "subscriptions": "incomplete",
        }.get(table.name, "active"),
        "tax_code": "002",
        "tax_calculation_status": "not_calculated",
        "timezone": "America/Mexico_City",
    }
    if name in named_values:
        return named_values[name]
    if name in {"user_id", "created_by_user_id", "invited_by_user_id"}:
        return USER_A if tenant == TENANT_A else USER_B
    if name in {"batch_id", "original_batch_id"}:
        return ids[("fiscal_global_draft_batches", tenant, variant)]
    if name == "order_id":
        return ids[("orders", tenant, variant)]
    if name == "order_item_id":
        return ids[("order_items", tenant, variant)]
    if name == "product_id":
        return ids[("products", tenant, variant)]
    if name == "customer_order_id":
        return ids[("customer_orders", tenant, variant)]
    if name == "customer_order_item_id":
        return ids[("customer_order_items", tenant, variant)]
    if name == "modifier_group_id":
        return ids[("modifier_groups", tenant, variant)]
    if name == "modifier_option_id":
        return ids[("modifier_options", tenant, variant)]
    if name == "refund_id":
        return ids[("refunds", tenant, variant)]
    if name == "purge_after":
        return datetime.now(UTC) + timedelta(days=30)
    if name in {"period_start", "period_end", "expense_date"}:
        return date(2026, 1, min(variant + 1, 28))
    if name == "folio":
        return f"S{tenant_token[:4]}{variant:02d}"
    if name == "email":
        return f"semantic-{token}@example.com"
    if name in {"client_event_id", "stripe_event_id", "key", "token_hash"}:
        return f"semantic-{name}-{token}"

    python_type = column.type.python_type
    if python_type is str:
        maximum = getattr(column.type, "length", None) or 120
        return f"semantic-{name}-{token}"[:maximum]
    if python_type is bool:
        return name in {"is_active", "is_trusted"}
    if python_type is int:
        if name == "paper_width_mm":
            return 80
        if name == "weekly_close_day":
            return 7
        if name == "monthly_close_day":
            return 28
        if name in {"image_position_x", "image_position_y"}:
            return 50
        if name in {
            "process_attempts",
            "adjustment_count",
            "excluded_individually_confirmed_count",
        }:
            return 0
        return 1
    if python_type is float:
        return 1.0
    if python_type is Decimal:
        if name in {
            "discount_total_amount",
            "line_discount_amount",
            "order_discount_allocated_amount",
            "refund_total_amount",
            "tax_total_amount",
            "adjustment_total_amount",
        }:
            return Decimal("0")
        return Decimal("1")
    if python_type is datetime:
        return datetime.now(UTC)
    if python_type is date:
        return date(2026, 1, min(variant + 1, 28))
    if python_type is bytes or isinstance(column.type, LargeBinary):
        return b"x"
    if python_type in {dict, list} or isinstance(column.type, JSON):
        return [] if name == "data_quality_warnings" else {}
    if python_type is uuid.UUID:
        return _semantic_uuid(f"{table.name}.{name}", tenant, variant)
    raise AssertionError(f"no semantic fixture value for {table.name}.{name}: {column.type}")


def _semantic_payloads(engine):
    metadata = MetaData()
    metadata.reflect(bind=engine)
    protected = set(app_db.TENANT_SCOPED_TABLES)
    ids = {
        (table_name, tenant, variant): _semantic_uuid(table_name, tenant, variant)
        for table_name in protected
        for tenant in (TENANT_A, TENANT_B)
        for variant in (0, 1)
        if "id" in metadata.tables[table_name].c
    }
    payloads = {}
    for table in metadata.sorted_tables:
        if table.name not in protected:
            continue
        for tenant in (TENANT_A, TENANT_B):
            for variant in (0, 1):
                values = {}
                for column in table.columns:
                    if column.name == "tenant_id" or column.primary_key or (
                        not column.nullable
                        and column.server_default is None
                        and not (column.autoincrement is True and column.primary_key)
                    ):
                        values[column.name] = _semantic_value(
                            table, column, tenant, variant, ids
                        )
                if "tenant_id" in table.c:
                    values["tenant_id"] = tenant
                payloads[(table.name, tenant, variant)] = values
    return metadata, payloads


def _insert_semantic_graph(connection, tables, payloads, tenant: uuid.UUID) -> None:
    by_name = {table.name: table for table in tables}
    for table_name in _SEMANTIC_INSERT_ORDER:
        if table_name in by_name:
            table = by_name[table_name]
            connection.execute(table.insert().values(payloads[(table.name, tenant, 0)]))


def _database_url() -> URL:
    configured = (
        os.environ.get("MIGRATION_DATABASE_URL")
        or os.environ.get("DATABASE_URL")
        or "postgresql+psycopg://pos:pos@localhost:5432/pos"
    )
    return make_url(configured)


def _render(url: URL) -> str:
    return url.render_as_string(hide_password=False)


def _run_alembic(database_url: URL, revision: str, *, succeeds: bool = True) -> str:
    env = os.environ.copy()
    rendered = _render(database_url)
    env.update(
        {
            "APP_ENV": "ci",
            "DATABASE_URL": rendered,
            "APP_DATABASE_URL": rendered,
            "MIGRATION_DATABASE_URL": rendered,
        }
    )
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", revision],
        cwd=BACKEND_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    if succeeds:
        assert result.returncode == 0, result.stderr[-4000:]
    else:
        assert result.returncode != 0
    return result.stderr


@contextmanager
def _temporary_database():
    admin_url = _database_url()
    database_name = f"kova_tenant_hardening_{uuid.uuid4().hex}"
    test_url = admin_url.set(database=database_name)
    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    engine = None
    role_created = False
    managed_owner_role_created = False
    data_api_roles_created: list[str] = []
    try:
        with admin_engine.connect() as conn:
            role_created = not conn.scalar(
                text("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app')")
            )
            if role_created:
                conn.execute(
                    text(
                        "CREATE ROLE kova_app LOGIN PASSWORD 'kova_app' "
                        "NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE"
                    )
                )
            for role_name in ("anon", "authenticated", "service_role"):
                if not conn.scalar(
                    text("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :role)"),
                    {"role": role_name},
                ):
                    conn.execute(text(f"CREATE ROLE {role_name} NOLOGIN"))
                    data_api_roles_created.append(role_name)
            managed_owner_role_created = not conn.scalar(
                text("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin')")
            )
            if managed_owner_role_created:
                conn.execute(text("CREATE ROLE supabase_admin NOLOGIN"))
            conn.execute(text(f'CREATE DATABASE "{database_name}"'))
        engine = create_engine(test_url)
        with engine.begin() as conn:
            conn.execute(text("GRANT CREATE, USAGE ON SCHEMA public TO supabase_admin"))
            conn.execute(
                text(
                    "ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public "
                    "GRANT ALL ON TABLES TO anon, authenticated, service_role"
                )
            )
            conn.execute(
                text(
                    "ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public "
                    "GRANT ALL ON SEQUENCES TO anon, authenticated, service_role"
                )
            )
            conn.execute(
                text(
                    "ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin "
                    "GRANT EXECUTE ON FUNCTIONS TO PUBLIC"
                )
            )
            conn.execute(
                text(
                    "ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public "
                    "GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role"
                )
            )
        yield test_url, engine
    finally:
        if engine is not None:
            engine.dispose()
        with admin_engine.connect() as conn:
            conn.execute(
                text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = :database_name AND pid <> pg_backend_pid()"
                ),
                {"database_name": database_name},
            )
            conn.execute(text(f'DROP DATABASE IF EXISTS "{database_name}"'))
            if role_created:
                conn.execute(text("DROP ROLE IF EXISTS kova_app"))
            for role_name in reversed(data_api_roles_created):
                conn.execute(text(f"DROP ROLE IF EXISTS {role_name}"))
            if managed_owner_role_created:
                conn.execute(text("DROP ROLE IF EXISTS supabase_admin"))
        admin_engine.dispose()


def _app_engine(url: URL):
    return create_engine(url.set(username="kova_app", password="kova_app"))


def _seed_inconsistent_0064_data(engine) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO tenants (id, name, slug) VALUES "
                "(:a, 'Tenant A', :sa), (:b, 'Tenant B', :sb)"
            ),
            {
                "a": TENANT_A,
                "b": TENANT_B,
                "sa": f"tenant-{TENANT_A}",
                "sb": f"tenant-{TENANT_B}",
            },
        )
        conn.execute(
            text(
                "INSERT INTO products (id, tenant_id, name, price_amount) VALUES "
                "(:pa, :a, 'A', 10), (:pb, :b, 'B', 10)"
            ),
            {"pa": PRODUCT_A, "pb": PRODUCT_B, "a": TENANT_A, "b": TENANT_B},
        )
        conn.execute(
            text(
                "INSERT INTO users (id, email, hashed_password, is_email_verified) VALUES "
                "(:ua, 'tenant-a-0065@example.com', 'hash-a', true), "
                "(:ub, 'tenant-b-0065@example.com', 'hash-b', true)"
            ),
            {"ua": USER_A, "ub": USER_B},
        )
        conn.execute(
            text(
                "INSERT INTO memberships (tenant_id, user_id, role) VALUES "
                "(:a, :ua, 'owner'), (:b, :ub, 'owner')"
            ),
            {"a": TENANT_A, "b": TENANT_B, "ua": USER_A, "ub": USER_B},
        )
        conn.execute(
            text(
                "INSERT INTO orders (id, tenant_id, status, subtotal_amount, total_amount, "
                "occurred_at, created_at, updated_at) VALUES "
                "(:order_id, :tenant_id, 'completed', 10, 10, now(), now(), now())"
            ),
            {"order_id": ORDER_A, "tenant_id": TENANT_A},
        )
        # Legal under the old simple product FK, but not under tenant ownership.
        conn.execute(
            text(
                "INSERT INTO order_items (id, tenant_id, order_id, product_id, product_name, "
                "quantity, unit_price_amount, line_total_amount) VALUES "
                "(:item, :a, :order_id, :pb, 'cross tenant', 1, 10, 10)"
            ),
            {"item": ORDER_ITEM_A, "a": TENANT_A, "order_id": ORDER_A, "pb": PRODUCT_B},
        )


def _seed_refund_before_upgrade(engine) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE order_items SET product_id = :pa WHERE id = :item"),
            {"pa": PRODUCT_A, "item": ORDER_ITEM_A},
        )
        conn.execute(
            text(
                "INSERT INTO refunds (id, order_id, tenant_id, reason, refunded_amount, "
                "refund_payment_method, created_at) VALUES "
                "(:refund, :order_id, :tenant, 'customer_return', 10, 'cash', now())"
            ),
            {"refund": REFUND_A, "order_id": ORDER_A, "tenant": TENANT_A},
        )
        conn.execute(
            text(
                "INSERT INTO refund_items (id, refund_id, order_item_id, quantity, "
                "unit_price_amount, line_total_amount) VALUES "
                "(:id, :refund, :item, 1, 10, 10)"
            ),
            {"id": REFUND_ITEM_A, "refund": REFUND_A, "item": ORDER_ITEM_A},
        )


def _run_provision(url: URL) -> None:
    psql = shutil.which("psql")
    if psql is None and os.name == "nt":
        candidate = Path("C:/Program Files/PostgreSQL/17/bin/psql.exe")
        psql = str(candidate) if candidate.exists() else None
    if psql is None:
        pytest.skip("psql is required to validate provisioning idempotency")
    result = subprocess.run(
        [
            psql,
            _render(url.set(drivername="postgresql")),
            "-v",
            "ON_ERROR_STOP=1",
            "-v",
            "kova_app_password=kova_app",
            "-f",
            str(PROVISION_SCRIPT),
        ],
        cwd=BACKEND_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr[-4000:]


def _posture_errors(conn) -> list[str]:
    tables = list(app_db.RLS_PROTECTED_TABLES)
    posture_rows = conn.execute(
        text(
            "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, "
            "COALESCE(bool_or(p.polqual IS NOT NULL), false), "
            "COALESCE(bool_or(p.polwithcheck IS NOT NULL), false) "
            "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "LEFT JOIN pg_policy p ON p.polrelid = c.oid "
            "WHERE n.nspname = 'public' AND c.relname = ANY(:tables) "
            "GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity"
        ),
        {"tables": tables},
    ).all()
    policy_rows = conn.execute(
        text(
            "SELECT c.relname, p.polname, p.polpermissive, p.polcmd, p.polroles, "
            "p.polqual IS NOT NULL, p.polwithcheck IS NOT NULL, "
            "pg_get_expr(p.polqual, p.polrelid), "
            "pg_get_expr(p.polwithcheck, p.polrelid) "
            "FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid "
            "JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relname = ANY(:tables)"
        ),
        {"tables": tables},
    ).all()
    return app_db._rls_posture_errors(
        role_is_super=False,
        role_bypasses_rls=False,
        owned_tables=set(),
        table_posture={row[0]: tuple(bool(value) for value in row[1:]) for row in posture_rows},
        policy_catalog={
            table: [
                (
                    row[1],
                    bool(row[2]),
                    row[3],
                    tuple(row[4]),
                    bool(row[5]),
                    bool(row[6]),
                    row[7],
                    row[8],
                )
                for row in policy_rows
                if row[0] == table
            ]
            for table in tables
        },
    )


def _assert_tenant_relation_catalog(conn) -> None:
    rows = conn.execute(
        text(
            "SELECT constraint_row.conname, child.relname, parent.relname, "
            "ARRAY(SELECT attribute.attname FROM unnest(constraint_row.conkey) "
            "WITH ORDINALITY AS key(attnum, position) "
            "JOIN pg_attribute attribute ON attribute.attrelid = constraint_row.conrelid "
            "AND attribute.attnum = key.attnum ORDER BY key.position), "
            "ARRAY(SELECT attribute.attname FROM unnest(constraint_row.confkey) "
            "WITH ORDINALITY AS key(attnum, position) "
            "JOIN pg_attribute attribute ON attribute.attrelid = constraint_row.confrelid "
            "AND attribute.attnum = key.attnum ORDER BY key.position), "
            "constraint_row.convalidated "
            "FROM pg_constraint constraint_row "
            "JOIN pg_class child ON child.oid = constraint_row.conrelid "
            "JOIN pg_class parent ON parent.oid = constraint_row.confrelid "
            "WHERE constraint_row.conname = ANY(:names)"
        ),
        {"names": list(_TENANT_RELATIONS)},
    ).all()
    assert len(rows) == len(_TENANT_RELATIONS)
    for name, child, parent, child_columns, parent_columns, validated in rows:
        expected_child, expected_foreign_column, expected_parent = _TENANT_RELATIONS[name]
        assert child == expected_child
        assert parent == expected_parent
        branch_relations = {
            "fk_inventory_movements_tenant_order", "fk_refunds_tenant_order",
            "fk_voids_tenant_order", "fk_orders_tenant_shift",
            "fk_cash_movements_tenant_shift", "fk_customer_orders_tenant_sale",
            "fk_inventory_reservations_tenant_order",
        }
        scope_columns = ["tenant_id", "branch_id"] if name in branch_relations else ["tenant_id"]
        assert child_columns == [*scope_columns, expected_foreign_column]
        assert parent_columns == [*scope_columns, "id"]
        assert validated


def test_fresh_upgrade_and_reprovision_keep_internal_tables_private() -> None:
    with _temporary_database() as (url, engine):
        _run_alembic(url, "head")
        _run_provision(url)
        _run_provision(url)

        with engine.begin() as conn:
            public_tables = set(
                conn.execute(
                    text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
                ).scalars()
            )
            assert set(_RUNTIME_TABLE_PRIVILEGES) <= public_tables
            for role_name in ("kova_app", "anon", "authenticated"):
                for table in public_tables:
                    expected = (
                        _RUNTIME_TABLE_PRIVILEGES.get(table, set())
                        if role_name == "kova_app"
                        else set()
                    )
                    for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
                        actual = conn.scalar(
                            text("SELECT has_table_privilege(:role, :table, :privilege)"),
                            {"role": role_name, "table": table, "privilege": privilege},
                        )
                        assert actual is (privilege in expected), (
                            role_name,
                            table,
                            privilege,
                        )
            internal_rls = conn.execute(
                text(
                    "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity "
                    "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE n.nspname = 'public' AND c.relname = ANY(:tables)"
                ),
                {
                    "tables": [
                        "alembic_version",
                        "ops_incident_states",
                        "ops_mfa_factors",
                        "ops_mfa_recovery_codes",
                        "ops_notes",
                        "permissions",
                        "role_permissions",
                        "roles",
                        "verification_tokens",
                    ]
                },
            ).all()
            assert len(internal_rls) == 9
            assert all(row[1] and not row[2] for row in internal_rls)
            assert conn.scalar(
                text(
                    "SELECT has_column_privilege("
                    "'kova_app', 'fiscal_global_draft_batches', 'id', 'UPDATE')"
                )
            )
            # The owner remains able to operate internal tables.
            conn.execute(text("SELECT count(*) FROM ops_notes"))
            conn.execute(text("CREATE TABLE future_sensitive (id integer)"))
            assert not conn.scalar(
                text("SELECT has_table_privilege('kova_app', 'future_sensitive', 'SELECT')")
            )

            # Supabase owns provider-created objects as supabase_admin. Re-running
            # provisioning must neutralize its managed Data API defaults too.
            conn.execute(text("SET ROLE supabase_admin"))
            conn.execute(text("CREATE TABLE future_supabase_sensitive (id integer)"))
            conn.execute(
                text(
                    "CREATE FUNCTION future_supabase_sensitive_fn() RETURNS integer "
                    "LANGUAGE sql AS 'SELECT 1'"
                )
            )
            conn.execute(text("RESET ROLE"))
            for role_name in ("anon", "authenticated", "service_role"):
                assert not conn.scalar(
                    text(
                        "SELECT has_table_privilege("
                        ":role, 'future_supabase_sensitive', 'SELECT')"
                    ),
                    {"role": role_name},
                )
                assert not conn.scalar(
                    text(
                        "SELECT has_function_privilege("
                        ":role, 'future_supabase_sensitive_fn()', 'EXECUTE')"
                    ),
                    {"role": role_name},
                )

        runtime = _app_engine(url)
        try:
            for table in ("order_fiscal_snapshots", "fiscal_global_draft_batches"):
                with runtime.begin() as conn:
                    conn.execute(
                        text("SELECT set_config('app.tenant_id', :tenant, true)"),
                        {"tenant": str(TENANT_A)},
                    )
                    conn.execute(text(f"SELECT id FROM {table} WHERE false FOR UPDATE"))
                with runtime.connect() as conn:
                    transaction = conn.begin()
                    conn.execute(
                        text("SELECT set_config('app.tenant_id', :tenant, true)"),
                        {"tenant": str(TENANT_A)},
                    )
                    with pytest.raises(DBAPIError) as exc:
                        conn.execute(text(f"UPDATE {table} SET tenant_id = tenant_id WHERE false"))
                    assert exc.value.orig.sqlstate == "42501"
                    transaction.rollback()
        finally:
            runtime.dispose()


def test_populated_upgrade_rejects_mismatch_then_enforces_fks_and_rls() -> None:
    with _temporary_database() as (url, engine):
        _run_alembic(url, "0064_fiscal_contribution")
        _seed_inconsistent_0064_data(engine)
        error = _run_alembic(url, "head", succeeds=False)
        assert "tenant ownership mismatch: order_items.product_id" in error
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT version_num FROM alembic_version")) == (
                "0064_fiscal_contribution"
            )
            assert not conn.scalar(
                text(
                    "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = 'refund_items' AND column_name = 'tenant_id')"
                )
            )

        _seed_refund_before_upgrade(engine)
        _run_alembic(url, "head")
        with engine.begin() as conn:
            _assert_tenant_relation_catalog(conn)
            assert _posture_errors(conn) == []
            assert (
                conn.scalar(
                    text("SELECT tenant_id FROM refund_items WHERE id = :id"),
                    {"id": REFUND_ITEM_A},
                )
                == TENANT_A
            )
            conn.execute(
                text(
                    "INSERT INTO customer_orders "
                    "(id, tenant_id, folio, status, fulfillment_type, source_channel, "
                    "subtotal_amount, total_amount, version, created_at, updated_at) VALUES "
                    "(:id, :tenant, 'PED-00650001', 'new', 'pickup', 'counter', "
                    "10, 10, 1, now(), now())"
                ),
                {"id": CUSTOMER_ORDER_A, "tenant": TENANT_A},
            )

        for table, clause in (
            ("products", "USING (true) WITH CHECK (true)"),
            ("tenants", "FOR SELECT USING (true)"),
            ("users", "FOR SELECT USING (true)"),
            ("anonymous_telemetry_events", "FOR INSERT WITH CHECK (true)"),
        ):
            with engine.begin() as conn:
                conn.execute(text(f"CREATE POLICY unexpected_allow_all ON {table} {clause}"))
                errors = _posture_errors(conn)
                assert f"{table}: unexpected permissive policies unexpected_allow_all" in errors
                conn.execute(text(f"DROP POLICY unexpected_allow_all ON {table}"))

        runtime = _app_engine(url)
        try:
            product_new_id = uuid.uuid4()
            with runtime.begin() as conn:
                conn.execute(
                    text("SELECT set_config('app.tenant_id', :tenant, true)"),
                    {"tenant": str(TENANT_A)},
                )
                assert conn.scalars(text("SELECT id FROM tenants ORDER BY id")).all() == [TENANT_A]
                assert conn.scalars(text("SELECT id FROM users ORDER BY id")).all() == [USER_A]
                assert conn.scalars(text("SELECT id FROM products ORDER BY id")).all() == [
                    PRODUCT_A
                ]
                conn.execute(
                    text(
                        "INSERT INTO products (id, tenant_id, name, price_amount) "
                        "VALUES (:id, :tenant, 'A2', 10)"
                    ),
                    {"id": product_new_id, "tenant": TENANT_A},
                )
                assert (
                    conn.execute(
                        text("UPDATE products SET name = 'hidden' WHERE id = :id"),
                        {"id": PRODUCT_B},
                    ).rowcount
                    == 0
                )
            with runtime.connect() as conn:
                transaction = conn.begin()
                conn.execute(
                    text("SELECT set_config('app.tenant_id', :tenant, true)"),
                    {"tenant": str(TENANT_A)},
                )
                with pytest.raises(DBAPIError) as exc:
                    conn.execute(
                        text(
                            "INSERT INTO products (tenant_id, name, price_amount) "
                            "VALUES (:tenant, 'cross tenant', 10)"
                        ),
                            {"tenant": TENANT_B},
                        )
                    assert exc.value.orig.sqlstate == "42501"
                transaction.rollback()

            with runtime.connect() as conn:
                transaction = conn.begin()
                conn.execute(
                    text("SELECT set_config('app.tenant_id', :tenant, true)"),
                    {"tenant": str(TENANT_A)},
                )
                with pytest.raises(DBAPIError) as exc:
                    conn.execute(
                        text("UPDATE products SET tenant_id = :tenant WHERE id = :id"),
                        {"tenant": TENANT_B, "id": product_new_id},
                    )
                assert exc.value.orig.sqlstate == "42501"
                transaction.rollback()

            with runtime.connect() as conn:
                transaction = conn.begin()
                conn.execute(
                    text("SELECT set_config('app.tenant_id', :tenant, true)"),
                    {"tenant": str(TENANT_A)},
                )
                with pytest.raises(DBAPIError) as exc:
                    conn.execute(
                        text("DELETE FROM products WHERE id = :id"), {"id": product_new_id}
                    )
                assert exc.value.orig.sqlstate == "42501"
                transaction.rollback()

            for table in ("tenants", "users"):
                with runtime.connect() as conn:
                    transaction = conn.begin()
                    conn.execute(
                        text("SELECT set_config('app.tenant_id', :tenant, true)"),
                        {"tenant": str(TENANT_A)},
                    )
                    with pytest.raises(DBAPIError) as exc:
                        conn.execute(text(f"UPDATE {table} SET id = id WHERE false"))
                    assert exc.value.orig.sqlstate == "42501"
                    transaction.rollback()

            with runtime.begin() as conn:
                conn.execute(
                    text(
                        "INSERT INTO anonymous_telemetry_events "
                        "(id, event_name, client_id, client_event_id, properties, created_at) "
                        "VALUES (:id, 'landing_viewed', 'client-0065', :event, '{}', now())"
                    ),
                    {"id": uuid.uuid4(), "event": f"allowed-{uuid.uuid4()}"},
                )
            with runtime.connect() as conn:
                transaction = conn.begin()
                with pytest.raises(DBAPIError) as exc:
                    conn.execute(
                        text(
                            "INSERT INTO anonymous_telemetry_events "
                            "(id, event_name, client_id, client_event_id, properties, created_at) "
                            "VALUES (:id, 'signup_completed', 'client-0065', :event, '{}', now())"
                        ),
                        {"id": uuid.uuid4(), "event": f"denied-{uuid.uuid4()}"},
                    )
                assert exc.value.orig.sqlstate == "42501"
                transaction.rollback()

            with runtime.connect() as conn:
                transaction = conn.begin()
                conn.execute(
                    text("SELECT set_config('app.tenant_id', :tenant, true)"),
                    {"tenant": str(TENANT_A)},
                )
                with pytest.raises(DBAPIError) as exc:
                    conn.execute(
                        text(
                            "INSERT INTO customer_order_items "
                            "(id, tenant_id, customer_order_id, product_id, "
                            "product_name, quantity, "
                            "unit_price_amount, line_total_amount) VALUES "
                            "(:id, :a, :order_id, :pb, 'cross tenant', 1, 10, 10)"
                        ),
                        {
                            "id": CUSTOMER_ORDER_ITEM_A,
                            "a": TENANT_A,
                            "order_id": CUSTOMER_ORDER_A,
                            "pb": PRODUCT_B,
                        },
                    )
                assert exc.value.orig.sqlstate == "23503"
                transaction.rollback()

            with runtime.begin() as conn:
                conn.execute(
                    text("SELECT set_config('app.tenant_id', :tenant, true)"),
                    {"tenant": str(TENANT_A)},
                )
                item_id = conn.scalar(
                    text(
                        "INSERT INTO customer_order_items "
                        "(id, tenant_id, customer_order_id, product_id, product_name, quantity, "
                        "unit_price_amount, line_total_amount) VALUES "
                        "(:id, :a, :order_id, :pa, 'legit', 1, 10, 10) RETURNING id"
                    ),
                    {
                        "id": CUSTOMER_ORDER_ITEM_A,
                        "a": TENANT_A,
                        "order_id": CUSTOMER_ORDER_A,
                        "pa": PRODUCT_A,
                    },
                )
            with runtime.connect() as conn:
                transaction = conn.begin()
                conn.execute(
                    text("SELECT set_config('app.tenant_id', :tenant, true)"),
                    {"tenant": str(TENANT_A)},
                )
                with pytest.raises(DBAPIError) as exc:
                    conn.execute(
                        text("UPDATE customer_order_items SET product_id = :pb WHERE id = :item"),
                        {"pb": PRODUCT_B, "item": item_id},
                    )
                assert exc.value.orig.sqlstate == "42501"
                transaction.rollback()

            # Missing and explicit-empty context deny cleanly for every tenant table.
            for empty in (False, True):
                with runtime.connect() as conn:
                    if empty:
                        conn.execute(text("SELECT set_config('app.tenant_id', '', false)"))
                    readable_rls_tables = {
                        table
                        for table in app_db.TENANT_SCOPED_TABLES
                        if "SELECT" in _RUNTIME_TABLE_PRIVILEGES.get(table, set())
                    } | {"tenants", "users"}
                    for table in readable_rls_tables:
                        assert conn.scalar(text(f"SELECT count(*) FROM {table}")) == 0
                with runtime.connect() as conn:
                    with pytest.raises(DBAPIError) as exc:
                        conn.execute(text("SELECT count(*) FROM webhook_events"))
                    assert exc.value.orig.sqlstate == "42501"

            # Session context survives real transaction boundaries and rollback.
            with Session(runtime) as session:
                app_db.set_tenant_context(session, TENANT_A)
                assert session.scalar(text("SELECT count(*) FROM products")) == 2
                session.commit()
                assert session.scalar(text("SELECT count(*) FROM products")) == 2
                session.rollback()
                assert session.scalar(text("SELECT count(*) FROM products")) == 2
        finally:
            runtime.dispose()


def _assert_permission_denied(connection, statement, parameters=None) -> None:
    with pytest.raises(DBAPIError) as exc:
        connection.execute(statement, parameters or {})
    assert exc.value.orig.sqlstate == "42501"


def test_runtime_executes_exact_table_verb_matrix_against_two_tenants() -> None:
    """Exercise SQL, not only grants metadata, for every protected table and verb."""
    with _temporary_database() as (url, engine):
        _run_alembic(url, "head")
        _run_provision(url)
        metadata, payloads = _semantic_payloads(engine)
        protected = set(app_db.TENANT_SCOPED_TABLES)

        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO tenants (id, name, slug) VALUES "
                    "(:a, 'Semantic A', :sa), (:b, 'Semantic B', :sb)"
                ),
                {
                    "a": TENANT_A,
                    "b": TENANT_B,
                    "sa": f"semantic-{TENANT_A}",
                    "sb": f"semantic-{TENANT_B}",
                },
            )
            conn.execute(
                text(
                    "INSERT INTO users (id, email, hashed_password, is_email_verified) VALUES "
                    "(:a, 'semantic-a@example.com', 'hash-a', true), "
                    "(:b, 'semantic-b@example.com', 'hash-b', true)"
                ),
                {"a": USER_A, "b": USER_B},
            )
            protected_tables = [
                table for table in metadata.sorted_tables if table.name in protected
            ]
            _insert_semantic_graph(conn, protected_tables, payloads, TENANT_B)
            _insert_semantic_graph(
                conn,
                [
                    table
                    for table in protected_tables
                    if "INSERT" not in _RUNTIME_TABLE_PRIVILEGES.get(table.name, set())
                ],
                payloads,
                TENANT_A,
            )

        runtime = _app_engine(url)
        try:
            # Insert a valid tenant-A graph through the real runtime role in FK order.
            with runtime.begin() as conn:
                conn.execute(
                    text("SELECT set_config('app.tenant_id', :tenant, true)"),
                    {"tenant": str(TENANT_A)},
                )
                _insert_semantic_graph(
                    conn,
                    [
                        table
                        for table in metadata.sorted_tables
                        if table.name in protected
                        and "INSERT" in _RUNTIME_TABLE_PRIVILEGES.get(table.name, set())
                    ],
                    payloads,
                    TENANT_A,
                )

            # Every tenant table now has real A/B data. Verify this with the owner.
            with engine.begin() as conn:
                for table_name in protected:
                    assert conn.scalar(
                        text(f"SELECT count(*) FROM {table_name} WHERE tenant_id = :tenant"),
                        {"tenant": TENANT_A},
                    ) == 1
                    assert conn.scalar(
                        text(f"SELECT count(*) FROM {table_name} WHERE tenant_id = :tenant"),
                        {"tenant": TENANT_B},
                    ) == 1

            for table_name in sorted(protected):
                expected = _RUNTIME_TABLE_PRIVILEGES.get(table_name, set())

                with runtime.connect() as conn:
                    transaction = conn.begin()
                    conn.execute(
                        text("SELECT set_config('app.tenant_id', :tenant, true)"),
                        {"tenant": str(TENANT_A)},
                    )
                    if "SELECT" in expected:
                        assert conn.scalar(
                            text(f"SELECT count(*) FROM {table_name} WHERE tenant_id = :a"),
                            {"a": TENANT_A},
                        ) == 1
                        assert conn.scalar(
                            text(f"SELECT count(*) FROM {table_name} WHERE tenant_id = :b"),
                            {"b": TENANT_B},
                        ) == 0
                    else:
                        _assert_permission_denied(
                            conn, text(f"SELECT count(*) FROM {table_name}")
                        )
                    transaction.rollback()

                with runtime.connect() as conn:
                    transaction = conn.begin()
                    conn.execute(
                        text("SELECT set_config('app.tenant_id', :tenant, true)"),
                        {"tenant": str(TENANT_A)},
                    )
                    if "INSERT" in expected:
                        with pytest.raises(DBAPIError) as exc:
                            conn.execute(
                                metadata.tables[table_name]
                                .insert()
                                .values(payloads[(table_name, TENANT_B, 1)])
                            )
                        assert exc.value.orig.sqlstate == "42501"
                    else:
                        _assert_permission_denied(
                            conn, text(f"INSERT INTO {table_name} DEFAULT VALUES")
                        )
                    transaction.rollback()

                with runtime.connect() as conn:
                    transaction = conn.begin()
                    conn.execute(
                        text("SELECT set_config('app.tenant_id', :tenant, true)"),
                        {"tenant": str(TENANT_A)},
                    )
                    statement = text(
                        f"UPDATE {table_name} SET tenant_id = tenant_id WHERE tenant_id = :tenant"
                    )
                    if "UPDATE" in expected:
                        assert conn.execute(statement, {"tenant": TENANT_A}).rowcount == 1
                        assert conn.execute(statement, {"tenant": TENANT_B}).rowcount == 0
                    else:
                        _assert_permission_denied(conn, statement, {"tenant": TENANT_A})
                    transaction.rollback()

                with runtime.connect() as conn:
                    transaction = conn.begin()
                    conn.execute(
                        text("SELECT set_config('app.tenant_id', :tenant, true)"),
                        {"tenant": str(TENANT_A)},
                    )
                    statement = text(f"DELETE FROM {table_name} WHERE tenant_id = :tenant")
                    if "DELETE" in expected:
                        assert conn.execute(statement, {"tenant": TENANT_B}).rowcount == 0
                        assert conn.execute(statement, {"tenant": TENANT_A}).rowcount == 1
                    else:
                        _assert_permission_denied(conn, statement, {"tenant": TENANT_A})
                    transaction.rollback()

            # Special-policy tables and every privileged-only table also execute all verbs.
            with runtime.begin() as conn:
                conn.execute(
                    text("SELECT set_config('app.tenant_id', :tenant, true)"),
                    {"tenant": str(TENANT_A)},
                )
                assert conn.scalars(text("SELECT id FROM tenants ORDER BY id")).all() == [TENANT_A]
                assert conn.scalars(text("SELECT id FROM users ORDER BY id")).all() == [USER_A]
                conn.execute(
                    text(
                        "INSERT INTO anonymous_telemetry_events "
                        "(id, event_name, client_id, client_event_id, properties, created_at) "
                        "VALUES (:id, 'landing_viewed', 'semantic-client', :event, '{}', now())"
                    ),
                    {"id": uuid.uuid4(), "event": f"semantic-{uuid.uuid4()}"},
                )

            public_tables = set(metadata.tables)
            runtime_tables = set(_RUNTIME_TABLE_PRIVILEGES)
            privileged_only = public_tables - runtime_tables
            for table_name in sorted(privileged_only):
                first_column = metadata.tables[table_name].columns[0].name
                for statement in (
                    text(f"SELECT * FROM {table_name} WHERE false"),
                    text(f"INSERT INTO {table_name} DEFAULT VALUES"),
                    text(
                        f"UPDATE {table_name} SET {first_column} = {first_column} WHERE false"
                    ),
                    text(f"DELETE FROM {table_name} WHERE false"),
                ):
                    with runtime.connect() as conn:
                        transaction = conn.begin()
                        _assert_permission_denied(conn, statement)
                        transaction.rollback()

            for table_name in _SPECIAL_RUNTIME_TABLES:
                expected = _RUNTIME_TABLE_PRIVILEGES[table_name]
                first_column = metadata.tables[table_name].columns[0].name
                for verb, statement in (
                    ("SELECT", text(f"SELECT * FROM {table_name} WHERE false")),
                    ("INSERT", text(f"INSERT INTO {table_name} DEFAULT VALUES")),
                    (
                        "UPDATE",
                        text(
                            f"UPDATE {table_name} SET {first_column} = {first_column} WHERE false"
                        ),
                    ),
                    ("DELETE", text(f"DELETE FROM {table_name} WHERE false")),
                ):
                    if verb in expected:
                        continue
                    with runtime.connect() as conn:
                        transaction = conn.begin()
                        _assert_permission_denied(conn, statement)
                        transaction.rollback()
        finally:
            runtime.dispose()
